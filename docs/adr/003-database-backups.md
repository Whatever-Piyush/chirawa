# ADR 003 — Database Backup & Restore Architecture

**Date:** 2026-07-02
**Status:** Accepted
**Deciders:** Founders + production-hardening audit (docs/ENGINEERING_AUDIT_2026-07.md, P0-4)

## Context

PostgreSQL holds the only unrebuildable state (orders, payments, ledger). Before this ADR
there were **no backups at all** — a disk failure or a destructive migration meant permanent
loss. The platform runs on a single Hetzner VPS with Postgres in Docker; the repo already
depends on Cloudflare R2 (`@aws-sdk/client-s3`) for image storage.

## Decision

Nightly `pg_dump --format=custom` + a mandatory pre-migration dump in production, verified
with `pg_restore --list`, uploaded to a **separate private R2 bucket** with size verification,
30-day retention pruning, and a dead-man's-switch healthcheck ping. Restore tooling defaults
to a **non-destructive scratch-database drill** with an automated validation checklist;
restoring over the live DB requires an interactive typed confirmation.

## Rationale (choices and trade-offs)

1. **`pg_dump` custom format, not plain SQL + gzip.** Custom format is natively compressed,
   supports `--list` (cheap archive-integrity verification before upload), selective and
   parallel restore. One tool fewer than piping through gzip.
2. **Dump streams to stdout → host file.** Works identically for native `pg_dump` and
   `docker exec … pg_dump` (a `--file` flag would write *inside* the container). The same
   reasoning feeds restores via stdin (`docker exec -i`). Trade-off: stdout-produced custom
   archives lack data offsets, so parallel restore (`-j`) is unavailable — irrelevant at our
   dump sizes; sequential restore was measured in seconds.
3. **TypeScript scripts reusing `@aws-sdk/client-s3`, not `aws` CLI/rclone/bash.** The server
   already runs the workspace via tsx; no new system dependency, no second credential path,
   and the orchestration logic became unit-testable (`src/shared/backup/backup-core.ts`,
   30 tests with injected fakes). Trade-off: scripts require the node_modules checkout —
   acceptable because deploys already do.
4. **Separate private bucket, refused-by-code.** `R2_BUCKET_NAME` is served publicly; the env
   reader *throws* if the backup bucket equals it. Credentials fall back to the existing R2
   keys but support `BACKUP_R2_*` overrides for a least-privilege token.
5. **Retention deletes only keys matching our exact naming pattern.** Foreign objects in the
   bucket are never candidates — a mis-set prefix cannot mass-delete unrelated data. Pruning
   failures never fail a successful backup (the backup is the point; pruning is hygiene).
6. **Pre-migration guard defaults by environment** (`resolveMigrateGuardMode`): production
   `require` (migration aborts unless a verified backup exists), elsewhere `attempt`
   (dev/CI without R2 keeps working), `skip` as documented break-glass. In `attempt` mode a
   *configured-but-failing* backup still aborts — having the means and skipping is never right.
7. **Healthcheck ping over log-scraping.** Backups fail silently in practice by *not running*;
   a dead-man's switch catches both failure and absence.
8. **Nightly dump (RPO ≤ 24 h), not WAL archiving.** At the current order volume the simple,
   drillable mechanism wins. WAL archiving (`wal-g`) is the designated follow-up if the
   business needs minutes-level RPO; it layers on top without changing this design.

## Consequences

- `pnpm db:migrate:prod` now runs the guard (deploy pipeline unchanged — it already calls
  that script name). Break-glass documented in docs/DISASTER_RECOVERY.md.
- Ops must provision the bucket + cron once (checklist in the DR guide).
- Restore is a rehearsed, scripted path with an automated checklist — verified end-to-end
  against the development database on 2026-07-02 (46 tables, 25 migrations, 0 orphans).
