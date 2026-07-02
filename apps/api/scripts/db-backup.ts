// Nightly PostgreSQL backup → Cloudflare R2 (Production Hardening Phase 1).
//
// Usage:  pnpm --filter @chirawa/api db:backup [-- --label nightly] [--local-only] [--keep-local]
// Cron:   see docs/DISASTER_RECOVERY.md (flock + log redirection + healthcheck)
//
// Pipeline (see src/shared/backup/backup-core.ts): pg_dump --format=custom →
// pg_restore --list integrity check → retried upload to the PRIVATE backup
// bucket → remote size verification → retention pruning (default 30 days) →
// local cleanup → healthcheck ping. Exit code 0 only when a durable backup
// exists (or --local-only was explicitly requested).
import { performBackup, log } from './backup-runtime';

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const label = argValue('--label');
  const result = await performBackup({
    ...(label ? { label } : {}),
    ...(flag('--local-only') ? { localOnly: true } : {}),
    ...(flag('--keep-local') ? { keepLocal: true } : {}),
  });
  log(`OK    ${result.uploaded ? `uploaded ${result.key}` : `local dump at ${result.localPath}`} (${(result.sizeBytes / 1024 / 1024).toFixed(2)} MiB)`);
}

main().catch((err) => {
  log(`FATAL backup failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
