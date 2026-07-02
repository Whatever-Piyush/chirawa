// PostgreSQL restore workflow (Production Hardening Phase 1, requirement 2).
//
//   List backups:        pnpm --filter @chirawa/api db:restore -- --list
//   Verification restore pnpm --filter @chirawa/api db:restore -- --from latest
//   (scratch DB)         pnpm --filter @chirawa/api db:restore -- --from <r2-key|/local/file.dump> [--target-db name]
//   Restore over LIVE:   pnpm --filter @chirawa/api db:restore -- --from <key> --over-live   (interactive confirmation)
//
// Default is NON-DESTRUCTIVE: the dump is restored into a scratch database
// (<db>_restore_verify), integrity checks run there, and the live DB is never
// touched. --over-live restores INTO the live database (pg_restore --clean
// --if-exists) and requires typing the confirmation phrase on a TTY. Full
// procedure + validation checklist: docs/DISASTER_RECOVERY.md.
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import {
  readBackupEnv, dbNameFromUrl, parseBackupKeyDate,
  type BackupEnv,
} from '../src/shared/backup/backup-core';
import { makeR2Client, listBackupKeys, downloadBackup, pgRestoreList, execPipe, log } from './backup-runtime';

const CONFIRM_PHRASE = 'RESTORE OVER LIVE';

function flag(name: string): boolean { return process.argv.includes(name); }
function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function urlForDb(databaseUrl: string, dbName: string): string {
  const u = new URL(databaseUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

/** psql against the maintenance DB (CREATE/DROP DATABASE can't run in a tx or in the target DB). */
async function psqlAdmin(env: BackupEnv, sql: string): Promise<void> {
  await execPipe([...env.psqlCommand, urlForDb(env.databaseUrl, 'postgres'), '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql]);
}

/** Run a scalar query against a DB and return trimmed stdout. */
function psqlScalar(env: BackupEnv, dbUrl: string, sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const [cmd, ...base] = env.psqlCommand;
    const child = spawn(cmd!, [...base, dbUrl, '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = []; const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8').trim());
      else reject(new Error(`psql failed: ${Buffer.concat(err).toString('utf8').trim().split('\n').slice(-3).join('\n')}`));
    });
  });
}

async function confirmOverLive(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    log('FATAL --over-live requires an interactive terminal (typed confirmation). Refusing.');
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`\n⚠️  This OVERWRITES the LIVE database. Stop the API/worker first (pm2 stop api worker).\nType "${CONFIRM_PHRASE}" to continue: `, resolve);
  });
  rl.close();
  return answer.trim() === CONFIRM_PHRASE;
}

// Post-restore integrity verification — prints the validation checklist values.
// Row counts intentionally aren't asserted against fixed numbers (they vary);
// the checks assert structure + presence, and surface figures for the human
// running the drill to eyeball against expectations.
async function verifyRestoredDb(env: BackupEnv, dbUrl: string): Promise<boolean> {
  const checks: Array<{ name: string; sql: string; assert?: (v: string) => boolean }> = [
    { name: 'tables present',            sql: `SELECT count(*) FROM information_schema.tables WHERE table_schema='public'`, assert: (v) => Number(v) > 10 },
    { name: 'migrations applied',        sql: `SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL`,      assert: (v) => Number(v) > 0 },
    { name: 'latest migration',          sql: `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1` },
    { name: 'users rows',                sql: `SELECT count(*) FROM users` },
    { name: 'orders rows',               sql: `SELECT count(*) FROM orders` },
    { name: 'payments rows',             sql: `SELECT count(*) FROM payments` },
    { name: 'ledger (transactions) rows',sql: `SELECT count(*) FROM transactions` },
    { name: 'latest order at',           sql: `SELECT COALESCE(max(created_at)::text, 'none') FROM orders` },
    { name: 'orphan order items',        sql: `SELECT count(*) FROM order_items oi LEFT JOIN orders o ON o.id = oi.order_id WHERE o.id IS NULL`, assert: (v) => v === '0' },
  ];

  let ok = true;
  log('INFO  ── restored-database validation checklist ──');
  for (const check of checks) {
    try {
      const value = await psqlScalar(env, dbUrl, check.sql);
      const passed = check.assert ? check.assert(value) : true;
      if (!passed) ok = false;
      log(`${passed ? 'PASS ' : 'FAIL '} ${check.name}: ${value}`);
    } catch (err) {
      ok = false;
      log(`FAIL  ${check.name}: ${(err as Error).message}`);
    }
  }
  return ok;
}

async function main(): Promise<void> {
  const env = readBackupEnv(process.env);
  const liveDbName = dbNameFromUrl(env.databaseUrl);
  const client = makeR2Client(env);

  // ── --list: show available backups, newest first ───────────────────────────
  if (flag('--list')) {
    const keys = await listBackupKeys(client, env);
    const dated = keys
      .map((k) => ({ k, d: parseBackupKeyDate(k) }))
      .filter((x): x is { k: string; d: Date } => x.d !== null)
      .sort((a, b) => b.d.getTime() - a.d.getTime());
    if (dated.length === 0) { log('INFO  no backups found'); return; }
    for (const { k, d } of dated) log(`INFO  ${d.toISOString()}  ${k}`);
    return;
  }

  // ── Source: local file, explicit R2 key, or "latest" ──────────────────────
  const from = argValue('--from') ?? 'latest';
  let localPath: string;
  if (from !== 'latest' && existsSync(from)) {
    localPath = from;
    log(`INFO  using local dump ${localPath}`);
  } else {
    let key = from;
    if (from === 'latest') {
      const keys = await listBackupKeys(client, env);
      const newest = keys
        .map((k) => ({ k, d: parseBackupKeyDate(k) }))
        .filter((x): x is { k: string; d: Date } => x.d !== null)
        .sort((a, b) => b.d.getTime() - a.d.getTime())[0];
      if (!newest) { log('FATAL no backups found in R2 — nothing to restore'); process.exit(1); }
      key = newest.k;
    }
    const dir = path.join(env.localDir || tmpdir(), 'chirawa-db-restore');
    await mkdir(dir, { recursive: true });
    localPath = path.join(dir, path.basename(key));
    log(`INFO  downloading ${key} …`);
    const size = await downloadBackup(client, env, key, localPath);
    log(`INFO  downloaded ${(size / 1024 / 1024).toFixed(2)} MiB → ${localPath}`);
  }

  // ── Archive integrity before touching any database ─────────────────────────
  await pgRestoreList(env, localPath);
  log('INFO  dump archive verified (pg_restore --list)');

  const overLive = flag('--over-live');
  if (overLive) {
    if (!(await confirmOverLive())) process.exit(1);
    log(`WARN  restoring OVER LIVE database "${liveDbName}" (pg_restore --clean --if-exists)…`);
    await execPipe(
      [...env.pgRestoreCommand, '--clean', '--if-exists', '--no-owner', '--no-privileges', '--dbname', env.databaseUrl],
      { stdinFromFile: localPath },
    );
    const ok = await verifyRestoredDb(env, env.databaseUrl);
    log(ok ? 'OK    live restore complete — restart services (pm2 restart api worker) and run the app smoke test'
           : 'FATAL live restore completed WITH FAILING CHECKS — do not reopen traffic; investigate now');
    process.exit(ok ? 0 : 1);
  }

  // ── Default: non-destructive verification restore into a scratch DB ────────
  const targetDb = argValue('--target-db') ?? `${liveDbName}_restore_verify`;
  if (targetDb === liveDbName) {
    log('FATAL --target-db equals the live database; use --over-live for that (with confirmation).');
    process.exit(1);
  }
  log(`INFO  restoring into scratch database "${targetDb}" (live DB untouched)`);
  await psqlAdmin(env, `DROP DATABASE IF EXISTS "${targetDb}"`);
  await psqlAdmin(env, `CREATE DATABASE "${targetDb}"`);
  const targetUrl = urlForDb(env.databaseUrl, targetDb);
  await execPipe(
    [...env.pgRestoreCommand, '--no-owner', '--no-privileges', '--dbname', targetUrl],
    { stdinFromFile: localPath },
  );

  const ok = await verifyRestoredDb(env, targetUrl);
  log(`INFO  scratch DB kept for inspection. Drop with: psql <admin-url> -c 'DROP DATABASE "${targetDb}"'`);
  log(ok ? 'OK    restore drill PASSED' : 'FATAL restore drill FAILED — see checks above');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  log(`FATAL restore failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
