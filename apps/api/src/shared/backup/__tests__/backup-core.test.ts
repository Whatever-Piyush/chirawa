import { describe, it, expect, vi } from 'vitest';
import {
  splitCommand, readBackupEnv, isBackupUploadConfigured,
  formatBackupTimestamp, buildBackupKey, parseBackupKeyDate, selectExpiredKeys,
  withRetries, runBackup, resolveMigrateGuardMode, dbNameFromUrl,
  type BackupDeps, type BackupEnv,
} from '../backup-core';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://chirawa:pw@localhost:5432/chirawa_development',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'chirawa-assets',
  BACKUP_R2_BUCKET: 'chirawa-db-backups',
};

describe('readBackupEnv', () => {
  it('applies defaults and falls back to the API R2 credentials', () => {
    const env = readBackupEnv(BASE_ENV);
    expect(env.r2Bucket).toBe('chirawa-db-backups');
    expect(env.r2AccountId).toBe('acct');
    expect(env.prefix).toBe('db-backups');
    expect(env.retentionDays).toBe(30);
    expect(env.pgDumpCommand).toEqual(['pg_dump']);
  });

  it('prefers BACKUP_R2_* overrides (least-privilege token)', () => {
    const env = readBackupEnv({ ...BASE_ENV, BACKUP_R2_ACCESS_KEY_ID: 'scoped' });
    expect(env.r2AccessKeyId).toBe('scoped');
  });

  it('REFUSES the public assets bucket as the backup target', () => {
    expect(() => readBackupEnv({ ...BASE_ENV, BACKUP_R2_BUCKET: 'chirawa-assets' }))
      .toThrow(/public assets bucket/);
  });

  it('rejects a negative/garbage retention', () => {
    expect(() => readBackupEnv({ ...BASE_ENV, BACKUP_RETENTION_DAYS: '-1' })).toThrow(/RETENTION/);
    expect(() => readBackupEnv({ ...BASE_ENV, BACKUP_RETENTION_DAYS: 'soon' })).toThrow(/RETENTION/);
  });

  it('requires DATABASE_URL', () => {
    expect(() => readBackupEnv({ ...BASE_ENV, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('splits multi-word pg_dump commands (docker exec mode)', () => {
    const env = readBackupEnv({ ...BASE_ENV, BACKUP_PG_DUMP_COMMAND: 'docker exec -i chirawa_postgres pg_dump' });
    expect(env.pgDumpCommand).toEqual(['docker', 'exec', '-i', 'chirawa_postgres', 'pg_dump']);
  });
});

describe('isBackupUploadConfigured', () => {
  it('true with real creds + bucket', () => {
    expect(isBackupUploadConfigured(BASE_ENV)).toBe(true);
  });
  it('false when the bucket is missing or creds are placeholders', () => {
    expect(isBackupUploadConfigured({ ...BASE_ENV, BACKUP_R2_BUCKET: undefined })).toBe(false);
    expect(isBackupUploadConfigured({ ...BASE_ENV, R2_ACCESS_KEY_ID: 'placeholder' })).toBe(false);
  });
});

describe('backup key naming + retention selection', () => {
  const now = new Date('2026-07-02T21:30:00Z');

  it('key embeds a parseable UTC timestamp (roundtrip)', () => {
    const key = buildBackupKey('db-backups', 'chirawa_production', now);
    expect(key).toBe('db-backups/chirawa_production/chirawa_production-20260702T213000Z.dump');
    expect(parseBackupKeyDate(key)?.toISOString()).toBe('2026-07-02T21:30:00.000Z');
  });

  it('label is sanitized and preserved in the key, and still parseable', () => {
    const key = buildBackupKey('db-backups', 'db', now, 'Pre-Migration!!');
    expect(key).toMatch(/-pre-migration--\.dump$|-pre-migration-{2}\.dump$/);
    expect(parseBackupKeyDate(key)).not.toBeNull();
  });

  it('selects only keys older than the cutoff', () => {
    const old = buildBackupKey('p', 'db', new Date('2026-05-30T00:00:00Z'));
    const fresh = buildBackupKey('p', 'db', new Date('2026-06-30T00:00:00Z'));
    expect(selectExpiredKeys([old, fresh], now, 30)).toEqual([old]);
  });

  it('NEVER selects keys that do not match our naming pattern', () => {
    const foreign = ['p/db/manual-copy.sql', 'p/db/db-not-a-timestamp.dump', 'random.txt'];
    expect(selectExpiredKeys(foreign, now, 1)).toEqual([]);
  });

  it('retentionDays 0 keeps everything', () => {
    const old = buildBackupKey('p', 'db', new Date('2020-01-01T00:00:00Z'));
    expect(selectExpiredKeys([old], now, 0)).toEqual([]);
  });

  it('formatBackupTimestamp is ISO-basic UTC', () => {
    expect(formatBackupTimestamp(new Date('2026-01-05T03:04:05.678Z'))).toBe('20260105T030405Z');
  });

  it('dbNameFromUrl parses the database name', () => {
    expect(dbNameFromUrl('postgresql://u:p@h:5432/mydb?schema=public')).toBe('mydb');
  });
});

describe('withRetries', () => {
  it('retries then succeeds', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return 'ok';
    });
    const result = await withRetries(fn, {
      attempts: 3, baseDelayMs: 1, label: 't', log: () => {}, sleep: async () => {},
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after the attempt budget and rethrows the last error', async () => {
    const fn = vi.fn(async () => { throw new Error('hard down'); });
    await expect(withRetries(fn, {
      attempts: 2, baseDelayMs: 1, label: 't', log: () => {}, sleep: async () => {},
    })).rejects.toThrow('hard down');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ── runBackup orchestration ────────────────────────────────────────────────────

function fakeEnv(): BackupEnv {
  return readBackupEnv(BASE_ENV);
}

function fakeDeps(overrides: Partial<BackupDeps> = {}): { deps: BackupDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: BackupDeps = {
    dump:        vi.fn(async () => { calls.push('dump'); return 1024; }),
    verifyDump:  vi.fn(async () => { calls.push('verify'); }),
    upload:      vi.fn(async () => { calls.push('upload'); }),
    headObject:  vi.fn(async () => { calls.push('head'); return 1024; }),
    listKeys:    vi.fn(async () => { calls.push('list'); return []; }),
    deleteKeys:  vi.fn(async () => { calls.push('delete'); }),
    ping:        vi.fn(async () => { calls.push('ping'); }),
    removeLocal: vi.fn(async () => { calls.push('rm'); }),
    log:         () => {},
    now:         () => new Date('2026-07-02T21:30:00Z'),
    sleep:       async () => {},
    ...overrides,
  };
  return { deps, calls };
}

describe('runBackup', () => {
  const opts = { env: fakeEnv(), localPath: '/tmp/x.dump', key: 'db-backups/db/db-20260702T213000Z.dump' };

  it('happy path: dump → verify → upload → head → retention → cleanup', async () => {
    const { deps, calls } = fakeDeps();
    const res = await runBackup(deps, opts);
    expect(res.uploaded).toBe(true);
    expect(res.sizeBytes).toBe(1024);
    expect(calls).toEqual(['dump', 'verify', 'upload', 'head', 'list', 'rm']);
  });

  it('aborts BEFORE upload when the dump archive fails verification', async () => {
    const { deps } = fakeDeps({ verifyDump: vi.fn(async () => { throw new Error('corrupt archive'); }) });
    await expect(runBackup(deps, opts)).rejects.toThrow('corrupt archive');
    expect(deps.upload).not.toHaveBeenCalled();
  });

  it('fails when the remote size does not match the local dump', async () => {
    const { deps } = fakeDeps({ headObject: vi.fn(async () => 999) });
    await expect(runBackup(deps, opts)).rejects.toThrow(/size mismatch/);
  });

  it('retries a transient upload failure and succeeds', async () => {
    let attempts = 0;
    const { deps } = fakeDeps({
      upload: vi.fn(async () => { attempts++; if (attempts === 1) throw new Error('socket reset'); }),
    });
    const res = await runBackup(deps, opts);
    expect(res.uploaded).toBe(true);
    expect(attempts).toBe(2);
  });

  it('an empty dump is a failure', async () => {
    const { deps } = fakeDeps({ dump: vi.fn(async () => 0) });
    await expect(runBackup(deps, opts)).rejects.toThrow(/empty/);
  });

  it('retention failure never fails a successful backup', async () => {
    const { deps } = fakeDeps({ listKeys: vi.fn(async () => { throw new Error('list denied'); }) });
    const res = await runBackup(deps, opts);
    expect(res.uploaded).toBe(true);
    expect(res.prunedCount).toBe(0);
  });

  it('prunes expired keys after a successful upload', async () => {
    const oldKey = buildBackupKey('db-backups', 'db', new Date('2026-01-01T00:00:00Z'));
    const { deps } = fakeDeps({ listKeys: vi.fn(async () => [oldKey]) });
    const res = await runBackup(deps, opts);
    expect(res.prunedCount).toBe(1);
    expect(deps.deleteKeys).toHaveBeenCalledWith([oldKey]);
  });

  it('--local-only skips upload/retention and keeps the file', async () => {
    const { deps, calls } = fakeDeps();
    const res = await runBackup(deps, { ...opts, localOnly: true });
    expect(res.uploaded).toBe(false);
    expect(calls).toEqual(['dump', 'verify']);
  });

  it('--keep-local skips the local cleanup after upload', async () => {
    const { deps } = fakeDeps();
    await runBackup(deps, { ...opts, keepLocal: true });
    expect(deps.removeLocal).not.toHaveBeenCalled();
  });
});

describe('resolveMigrateGuardMode', () => {
  it('production defaults to require', () => {
    expect(resolveMigrateGuardMode({ NODE_ENV: 'production' })).toBe('require');
  });
  it('non-production defaults to attempt', () => {
    expect(resolveMigrateGuardMode({ NODE_ENV: 'development' })).toBe('attempt');
    expect(resolveMigrateGuardMode({})).toBe('attempt');
  });
  it('explicit overrides win, including the skip break-glass', () => {
    expect(resolveMigrateGuardMode({ NODE_ENV: 'production', BACKUP_BEFORE_MIGRATE: 'skip' })).toBe('skip');
    expect(resolveMigrateGuardMode({ NODE_ENV: 'development', BACKUP_BEFORE_MIGRATE: 'require' })).toBe('require');
  });
  it('rejects unknown values', () => {
    expect(() => resolveMigrateGuardMode({ BACKUP_BEFORE_MIGRATE: 'yolo' })).toThrow(/auto\|require\|attempt\|skip/);
  });
});
