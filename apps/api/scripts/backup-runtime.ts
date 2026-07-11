// Real-world wiring for the backup pipeline (Production Hardening Phase 1).
// Thin CLIs (db-backup.ts, migrate-with-backup.ts, db-restore.ts) import from
// here; all logic/ordering lives in src/shared/backup/backup-core.ts where it
// is unit-tested with fakes.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  S3Client, PutObjectCommand, HeadObjectCommand,
  ListObjectsV2Command, DeleteObjectsCommand, GetObjectCommand,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  readBackupEnv, buildBackupKey, dbNameFromUrl, runBackup, formatBackupTimestamp,
  type BackupEnv, type BackupDeps, type BackupResult,
} from '../src/shared/backup/backup-core';

export function log(msg: string): void {
  console.log(`${new Date().toISOString()} [db-backup] ${msg}`);
}

// ── Process execution ─────────────────────────────────────────────────────────

export interface ExecIo {
  stdoutToFile?: string;  // stream stdout into this file
  stdinFromFile?: string; // stream this file into stdin (docker-exec friendly)
}

/** Run argv (no shell). Throws with the stderr tail on a non-zero exit. */
export function execPipe(argv: string[], io: ExecIo = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = argv;
    if (!cmd) return reject(new Error('empty command'));
    const child = spawn(cmd, args, {
      stdio: [io.stdinFromFile ? 'pipe' : 'ignore', io.stdoutToFile ? 'pipe' : 'ignore', 'pipe'],
    });

    const stderr: Buffer[] = [];
    child.stderr?.on('data', (c: Buffer) => { stderr.push(c); });

    const pipes: Promise<unknown>[] = [];
    if (io.stdoutToFile) pipes.push(pipeline(child.stdout!, createWriteStream(io.stdoutToFile)));
    if (io.stdinFromFile) {
      // Swallow EPIPE-style stream errors here — the child's exit code decides.
      pipes.push(pipeline(createReadStream(io.stdinFromFile), child.stdin!).catch(() => {}));
    }

    child.on('error', reject);
    child.on('close', (code) => {
      void Promise.allSettled(pipes).then(() => {
        if (code === 0) return resolve();
        const tail = Buffer.concat(stderr).toString('utf8').trim().split('\n').slice(-5).join('\n');
        reject(new Error(`${cmd} exited with code ${code}${tail ? `:\n${tail}` : ''}`));
      });
    });
  });
}

// ── R2 (S3-compatible) client ─────────────────────────────────────────────────

export function makeR2Client(env: BackupEnv): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.r2AccessKeyId, secretAccessKey: env.r2SecretAccessKey },
  });
}

export async function listBackupKeys(client: S3Client, env: BackupEnv): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: env.r2Bucket,
      Prefix: `${env.prefix}/`,
      ...(token ? { ContinuationToken: token } : {}),
    }));
    for (const obj of page.Contents ?? []) if (obj.Key) keys.push(obj.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function deleteKeys(client: S3Client, env: BackupEnv, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    await client.send(new DeleteObjectsCommand({
      Bucket: env.r2Bucket,
      Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
    }));
  }
}

export async function downloadBackup(client: S3Client, env: BackupEnv, key: string, toFile: string): Promise<number> {
  const res = await client.send(new GetObjectCommand({ Bucket: env.r2Bucket, Key: key }));
  if (!res.Body) throw new Error(`empty body downloading ${key}`);
  await pipeline(res.Body as Readable, createWriteStream(toFile));
  return (await stat(toFile)).size;
}

// ── Dead-man's-switch ping (healthchecks.io-style; never throws) ──────────────

async function pingHealthcheck(url: string, ok: boolean): Promise<void> {
  if (!url) return;
  const target = ok ? url : `${url.replace(/\/$/, '')}/fail`;
  try {
    await fetch(target, { method: 'GET' });
  } catch (err) {
    log(`WARN  healthcheck ping failed (non-fatal): ${(err as Error).message}`);
  }
}

// ── pg_dump / pg_restore wrappers (native or docker-exec via env commands) ────

// Dump to stdout and stream to a HOST file — works identically for a native
// pg_dump and "docker exec <container> pg_dump" (a --file flag would write
// inside the container). --format=custom is compressed and pg_restore-able
// with --list verification and selective/parallel restore.
async function pgDumpToFile(env: BackupEnv, localPath: string): Promise<number> {
  await execPipe(
    [...env.pgDumpCommand, '--format=custom', '--no-owner', '--no-privileges', '--dbname', env.databaseUrl],
    { stdoutToFile: localPath },
  );
  return (await stat(localPath)).size;
}

// Read the archive TOC — fails loudly on a truncated/corrupt dump. Fed via
// stdin so the same call works when pg_restore runs inside a container that
// cannot see the host path (requires "docker exec -i").
export async function pgRestoreList(env: BackupEnv, localPath: string): Promise<void> {
  await execPipe([...env.pgRestoreCommand, '--list'], { stdinFromFile: localPath });
}

// ── Public entry: perform one full backup ─────────────────────────────────────

export interface PerformBackupOpts {
  label?: string;
  localOnly?: boolean;
  keepLocal?: boolean;
}

export async function performBackup(opts: PerformBackupOpts = {}): Promise<BackupResult> {
  const env = readBackupEnv(process.env);
  // Fail fast with an actionable message instead of burning upload retries
  // against a missing bucket.
  if (!opts.localOnly && !env.r2Bucket) {
    throw new Error('BACKUP_R2_BUCKET is not set — configure the private backup bucket, or pass --local-only for a non-durable local dump');
  }
  const dbName = dbNameFromUrl(env.databaseUrl);
  const now = new Date();

  const localDir = env.localDir || path.join(tmpdir(), 'chirawa-db-backups');
  await mkdir(localDir, { recursive: true });
  const fileName = `${dbName}-${formatBackupTimestamp(now)}${opts.label ? `-${opts.label}` : ''}.dump`;
  const localPath = path.join(localDir, fileName);
  const key = buildBackupKey(env.prefix, dbName, now, opts.label);

  const client = makeR2Client(env);
  const deps: BackupDeps = {
    dump:        (p) => pgDumpToFile(env, p),
    verifyDump:  (p) => pgRestoreList(env, p),
    upload:      async (p, k, size) => {
      await client.send(new PutObjectCommand({
        Bucket: env.r2Bucket, Key: k,
        Body: createReadStream(p), ContentLength: size,
        ContentType: 'application/octet-stream',
      }));
    },
    headObject:  async (k) => {
      const head = await client.send(new HeadObjectCommand({ Bucket: env.r2Bucket, Key: k }));
      return head.ContentLength ?? -1;
    },
    listKeys:    () => listBackupKeys(client, env),
    deleteKeys:  (keys) => deleteKeys(client, env, keys),
    ping:        (ok) => pingHealthcheck(env.healthcheckUrl, ok),
    removeLocal: (p) => rm(p, { force: true }),
    log,
    now: () => new Date(),
  };

  try {
    const result = await runBackup(deps, {
      env, localPath, key,
      ...(opts.localOnly ? { localOnly: true } : {}),
      ...(opts.keepLocal ? { keepLocal: true } : {}),
    });
    await deps.ping(true);
    return result;
  } catch (err) {
    await deps.ping(false);
    throw err;
  }
}
