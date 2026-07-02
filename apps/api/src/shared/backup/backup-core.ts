// ─── Database backup core (Production Hardening Phase 1 — Data Safety) ───────
//
// Pure/injectable logic shared by scripts/db-backup.ts, scripts/db-restore.ts
// and scripts/migrate-with-backup.ts. Everything with a side effect is passed
// in (exec, S3 client, clock, logger) so the orchestration is unit-testable
// without Postgres or R2. See docs/adr/003-database-backups.md for the
// architectural decisions.
//
// Deliberately does NOT import src/config/env.ts: the API's env schema
// hard-requires JWT keys etc. and process.exit()s on failure — an ops script
// must be runnable with only the variables it actually needs.

// ── Environment ───────────────────────────────────────────────────────────────

export interface BackupEnv {
  databaseUrl: string;
  // R2 (S3-compatible) target. Credentials default to the API's R2_* vars but
  // every one can be overridden with a BACKUP_R2_* variable so ops can use a
  // least-privilege token scoped to the backup bucket only.
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  /** REQUIRED and must differ from the public assets bucket (see readBackupEnv). */
  r2Bucket: string;
  prefix: string;
  retentionDays: number;
  localDir: string;
  pgDumpCommand: string[];
  pgRestoreCommand: string[];
  psqlCommand: string[];
  healthcheckUrl: string;
}

const PLACEHOLDER_RE = /placeholder/i;

/** Split "docker exec -i chirawa_postgres pg_dump" → argv. Paths with spaces unsupported (documented). */
export function splitCommand(cmd: string): string[] {
  return cmd.trim().split(/\s+/).filter(Boolean);
}

export function isBackupUploadConfigured(env: Record<string, string | undefined>): boolean {
  const val = (k: string): string => env[`BACKUP_${k}`] ?? env[k] ?? '';
  return (
    !!(env['BACKUP_R2_BUCKET']) &&
    !PLACEHOLDER_RE.test(val('R2_ACCOUNT_ID')) && val('R2_ACCOUNT_ID') !== '' &&
    !PLACEHOLDER_RE.test(val('R2_ACCESS_KEY_ID')) && val('R2_ACCESS_KEY_ID') !== '' &&
    !PLACEHOLDER_RE.test(val('R2_SECRET_ACCESS_KEY')) && val('R2_SECRET_ACCESS_KEY') !== ''
  );
}

/**
 * Read + validate backup configuration from process.env (or a test double).
 * Throws with an actionable message on misconfiguration.
 *
 * Guard rail: BACKUP_R2_BUCKET must NOT be the public assets bucket
 * (R2_BUCKET_NAME) — that bucket is served publicly via R2_PUBLIC_URL, and a
 * database dump inside it would be a full customer-data leak.
 */
export function readBackupEnv(env: Record<string, string | undefined>): BackupEnv {
  const databaseUrl = env['DATABASE_URL'] ?? '';
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const pick = (backupKey: string, fallbackKey: string): string =>
    env[backupKey] ?? env[fallbackKey] ?? '';

  const r2Bucket = env['BACKUP_R2_BUCKET'] ?? '';
  const assetsBucket = env['R2_BUCKET_NAME'] ?? '';
  if (r2Bucket && assetsBucket && r2Bucket === assetsBucket) {
    throw new Error(
      `BACKUP_R2_BUCKET must not be the public assets bucket ("${assetsBucket}") — ` +
      'database dumps in a publicly served bucket are a customer-data leak. ' +
      'Create a separate PRIVATE bucket (e.g. chirawa-db-backups).',
    );
  }

  const retentionDays = Number(env['BACKUP_RETENTION_DAYS'] ?? '30');
  if (!Number.isFinite(retentionDays) || retentionDays < 0 || !Number.isInteger(retentionDays)) {
    throw new Error(`BACKUP_RETENTION_DAYS must be a non-negative integer, got: ${env['BACKUP_RETENTION_DAYS']}`);
  }

  return {
    databaseUrl,
    r2AccountId:       pick('BACKUP_R2_ACCOUNT_ID', 'R2_ACCOUNT_ID'),
    r2AccessKeyId:     pick('BACKUP_R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID'),
    r2SecretAccessKey: pick('BACKUP_R2_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY'),
    r2Bucket,
    prefix:        env['BACKUP_PREFIX'] ?? 'db-backups',
    retentionDays,
    localDir:      env['BACKUP_LOCAL_DIR'] ?? '',
    pgDumpCommand:    splitCommand(env['BACKUP_PG_DUMP_COMMAND'] ?? 'pg_dump'),
    pgRestoreCommand: splitCommand(env['BACKUP_PG_RESTORE_COMMAND'] ?? 'pg_restore'),
    psqlCommand:      splitCommand(env['BACKUP_PSQL_COMMAND'] ?? 'psql'),
    healthcheckUrl:   env['BACKUP_HEALTHCHECK_URL'] ?? '',
  };
}

// ── Backup object naming ──────────────────────────────────────────────────────
// Key layout: {prefix}/{dbName}/{dbName}-{ISO-basic-UTC}[-{label}].dump
// The timestamp is parseable back out of the key — retention NEVER deletes an
// object whose key doesn't match this exact pattern (unknown objects are kept).

const KEY_TS_RE = /-(\d{8}T\d{6}Z)(?:-[a-z0-9-]+)?\.dump$/;

export function formatBackupTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function dbNameFromUrl(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  const name = parsed.pathname.replace(/^\//, '').split('?')[0] ?? '';
  if (!name) throw new Error(`Could not parse database name from DATABASE_URL`);
  return name;
}

export function buildBackupKey(prefix: string, dbName: string, date: Date, label?: string): string {
  const safeLabel = label ? `-${label.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40)}` : '';
  return `${prefix}/${dbName}/${dbName}-${formatBackupTimestamp(date)}${safeLabel}.dump`;
}

/** Parse the UTC timestamp out of a backup key; null when the key isn't ours. */
export function parseBackupKeyDate(key: string): Date | null {
  const m = KEY_TS_RE.exec(key);
  if (!m) return null;
  const ts = m[1]!; // YYYYMMDDTHHMMSSZ
  const iso = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Which keys the retention pass should delete. retentionDays 0 = keep forever.
 * Only keys matching our naming pattern are ever candidates — anything else in
 * the bucket/prefix is left untouched.
 */
export function selectExpiredKeys(keys: string[], now: Date, retentionDays: number): string[] {
  if (retentionDays <= 0) return [];
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return keys.filter((k) => {
    const d = parseBackupKeyDate(k);
    return d !== null && d.getTime() < cutoff;
  });
}

// ── Retry helper ──────────────────────────────────────────────────────────────

export interface RetryOpts {
  attempts: number;       // total attempts (>=1)
  baseDelayMs: number;    // doubled each retry
  label: string;
  log: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export async function withRetries<T>(fn: () => Promise<T>, opts: RetryOpts): Promise<T> {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < opts.attempts) {
        const delay = opts.baseDelayMs * 2 ** (attempt - 1);
        opts.log(`WARN  ${opts.label} failed (attempt ${attempt}/${opts.attempts}): ${msg} — retrying in ${delay}ms`);
        await sleep(delay);
      } else {
        opts.log(`ERROR ${opts.label} failed (attempt ${attempt}/${opts.attempts}): ${msg} — giving up`);
      }
    }
  }
  throw lastErr;
}

// ── Backup orchestration (side effects injected) ──────────────────────────────

export interface BackupDeps {
  /** pg_dump to a local file; throws on failure; returns byte size. */
  dump: (localPath: string) => Promise<number>;
  /** Integrity check of the dump archive (pg_restore --list); throws when unreadable. */
  verifyDump: (localPath: string) => Promise<void>;
  /** Upload the file; throws on failure. */
  upload: (localPath: string, key: string, sizeBytes: number) => Promise<void>;
  /** HEAD the uploaded object; returns remote size (throws if missing). */
  headObject: (key: string) => Promise<number>;
  /** List existing backup keys under the prefix (full pagination). */
  listKeys: () => Promise<string[]>;
  /** Batch-delete keys. */
  deleteKeys: (keys: string[]) => Promise<void>;
  /** Optional dead-man's-switch ping; never throws. */
  ping: (ok: boolean) => Promise<void>;
  removeLocal: (localPath: string) => Promise<void>;
  log: (msg: string) => void;
  now: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface BackupRunOpts {
  env: BackupEnv;
  localPath: string;
  key: string;
  /** Skip upload/retention — local dump only (testing / air-gapped break-glass). */
  localOnly?: boolean;
  /** Keep the local file after a successful upload. */
  keepLocal?: boolean;
}

export interface BackupResult {
  key: string;
  localPath: string;
  sizeBytes: number;
  uploaded: boolean;
  prunedCount: number;
}

/**
 * The nightly backup pipeline: dump → verify archive → upload (retried) →
 * verify remote size → prune expired (non-fatal) → cleanup. Throws on any
 * failure that means "we do NOT have a durable backup"; retention/cleanup
 * problems are logged but never fail a successful backup.
 */
export async function runBackup(deps: BackupDeps, opts: BackupRunOpts): Promise<BackupResult> {
  const { env } = opts;
  const t0 = deps.now().getTime();

  deps.log(`INFO  dumping ${dbNameFromUrl(env.databaseUrl)} → ${opts.localPath}`);
  const sizeBytes = await withRetries(() => deps.dump(opts.localPath), {
    attempts: 2, baseDelayMs: 2000, label: 'pg_dump', log: deps.log, ...(deps.sleep ? { sleep: deps.sleep } : {}),
  });
  if (sizeBytes <= 0) throw new Error('pg_dump produced an empty file');
  deps.log(`INFO  dump complete (${(sizeBytes / 1024 / 1024).toFixed(2)} MiB)`);

  await deps.verifyDump(opts.localPath);
  deps.log('INFO  dump archive verified (pg_restore --list)');

  let uploaded = false;
  let prunedCount = 0;

  if (!opts.localOnly) {
    await withRetries(async () => {
      await deps.upload(opts.localPath, opts.key, sizeBytes);
      const remoteSize = await deps.headObject(opts.key);
      if (remoteSize !== sizeBytes) {
        throw new Error(`remote size mismatch: local=${sizeBytes} remote=${remoteSize}`);
      }
    }, { attempts: 3, baseDelayMs: 1000, label: 'upload to R2', log: deps.log, ...(deps.sleep ? { sleep: deps.sleep } : {}) });
    uploaded = true;
    deps.log(`INFO  uploaded + size-verified: ${opts.key}`);

    // Retention pruning — best-effort: never fail a successful backup over it.
    try {
      const keys = await deps.listKeys();
      const expired = selectExpiredKeys(keys, deps.now(), env.retentionDays);
      if (expired.length > 0) {
        await deps.deleteKeys(expired);
        prunedCount = expired.length;
        deps.log(`INFO  retention: deleted ${expired.length} backup(s) older than ${env.retentionDays}d`);
      } else {
        deps.log(`INFO  retention: nothing older than ${env.retentionDays}d`);
      }
    } catch (err) {
      deps.log(`ERROR retention pruning failed (backup itself is safe): ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!opts.keepLocal) {
      await deps.removeLocal(opts.localPath).catch(() => {});
    }
  } else {
    deps.log('WARN  --local-only: skipping upload and retention (this is NOT a durable backup)');
  }

  deps.log(`INFO  backup finished in ${((deps.now().getTime() - t0) / 1000).toFixed(1)}s`);
  return { key: opts.key, localPath: opts.localPath, sizeBytes, uploaded, prunedCount };
}

// ── Pre-migration guard decision (pure) ───────────────────────────────────────

export type MigrateGuardMode = 'require' | 'attempt' | 'skip';

/**
 * How db:migrate:prod treats the pre-migration backup:
 *  - require: backup MUST succeed or the migration is aborted (production default)
 *  - attempt: try to back up; proceed with a loud warning if upload isn't configured
 *  - skip:    documented break-glass only (BACKUP_BEFORE_MIGRATE=skip)
 */
export function resolveMigrateGuardMode(env: Record<string, string | undefined>): MigrateGuardMode {
  const explicit = (env['BACKUP_BEFORE_MIGRATE'] ?? '').toLowerCase();
  if (explicit === 'skip') return 'skip';
  if (explicit === 'require') return 'require';
  if (explicit === 'attempt') return 'attempt';
  if (explicit !== '' && explicit !== 'auto') {
    throw new Error(`BACKUP_BEFORE_MIGRATE must be auto|require|attempt|skip, got: ${explicit}`);
  }
  // auto: production must never migrate without a durable backup.
  return env['NODE_ENV'] === 'production' ? 'require' : 'attempt';
}
