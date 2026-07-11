// Guarded production migration (Production Hardening Phase 1, requirement 3):
// `pnpm db:migrate:prod` now takes a database backup BEFORE `prisma migrate
// deploy`, and in production the migration NEVER runs unless that backup
// succeeded and was verified in R2.
//
// Modes (resolveMigrateGuardMode, unit-tested):
//   require — backup must succeed or we abort           (NODE_ENV=production default)
//   attempt — backup if R2 is configured; otherwise warn and proceed (non-prod default)
//   skip    — break-glass only: BACKUP_BEFORE_MIGRATE=skip (take a manual dump first!)
//
// In `attempt` mode a CONFIGURED backup that fails still aborts — if you had
// the means to back up and it broke, migrating anyway is never the right call.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMigrateGuardMode, isBackupUploadConfigured } from '../src/shared/backup/backup-core';
import { performBackup, log } from './backup-runtime';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function runPrismaMigrateDeploy(): Promise<number> {
  // Resolve the workspace-local prisma binary; fall back to npx for odd setups.
  const local = path.join(HERE, '..', 'node_modules', '.bin', 'prisma');
  const [cmd, baseArgs] = existsSync(local) ? [local, [] as string[]] : ['npx', ['prisma']];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...baseArgs, 'migrate', 'deploy'], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  const mode = resolveMigrateGuardMode(process.env);

  if (mode === 'skip') {
    log('WARN  BACKUP_BEFORE_MIGRATE=skip — migrating WITHOUT a fresh backup (break-glass). Take a manual dump first: pnpm db:backup -- --label manual');
  } else if (mode === 'attempt' && !isBackupUploadConfigured(process.env)) {
    log('WARN  backup upload not configured (BACKUP_R2_BUCKET / R2 credentials) — proceeding WITHOUT a pre-migration backup. Fine for dev; never for production.');
  } else {
    log(`INFO  taking pre-migration backup (mode: ${mode})…`);
    try {
      const result = await performBackup({ label: 'pre-migration' });
      log(`INFO  pre-migration backup secured: ${result.key}`);
    } catch (err) {
      log(`FATAL pre-migration backup failed — MIGRATION ABORTED: ${err instanceof Error ? err.message : String(err)}`);
      log('      Fix the backup (or, break-glass with a manual dump in hand: BACKUP_BEFORE_MIGRATE=skip). See docs/DISASTER_RECOVERY.md.');
      process.exit(1);
    }
  }

  log('INFO  running prisma migrate deploy…');
  const code = await runPrismaMigrateDeploy();
  process.exit(code);
}

main().catch((err) => {
  log(`FATAL ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
