# Disaster Recovery — Database Backups & Restore

**Scope:** PostgreSQL (orders, payments, ledger — the only state that cannot be rebuilt).
Redis holds carts/OTPs/cache (expendable), R2 assets are already durable object storage.

**Objectives:** RPO ≤ 24 h (nightly dump) + a fresh dump immediately before every production
migration. RTO ≈ 15–30 min (download + restore + verify on the same VPS). If the business
later needs a tighter RPO, add WAL archiving (`wal-g`) on top — the nightly dump stays as the
simple, testable baseline. Decisions and trade-offs: `docs/adr/003-database-backups.md`.

---

## 1. Architecture

```
cron (03:00 IST nightly)                       GitHub Actions deploy
        │                                              │
        ▼                                              ▼
pnpm db:backup ──────────────┐            pnpm db:migrate:prod
        │                    │                         │
        │              same pipeline ◄── pre-migration backup (REQUIRED in prod;
        ▼                    │           migration aborts if it fails)
  pg_dump --format=custom    │                         │
  → pg_restore --list check  │                         ▼
  → upload to R2 (retried)   │              prisma migrate deploy
  → HEAD size verification   │
  → retention prune (30 d)   │
  → healthcheck ping         ▼
             r2://chirawa-db-backups/db-backups/<db>/<db>-<UTC>.dump
```

- **Code:** logic in `apps/api/src/shared/backup/backup-core.ts` (unit-tested with fakes);
  real wiring in `apps/api/scripts/backup-runtime.ts`; CLIs `db-backup.ts`, `db-restore.ts`,
  `migrate-with-backup.ts`.
- **Bucket:** a **separate, PRIVATE** R2 bucket. The tooling refuses to write dumps into the
  public assets bucket (`R2_BUCKET_NAME`) — a dump there would be a full customer-data leak.
- **Naming:** `db-backups/<db>/<db>-YYYYMMDDTHHMMSSZ[-label].dump`. Retention only ever
  deletes keys matching this exact pattern; foreign objects in the bucket are never touched.
- **Failure alerting:** set `BACKUP_HEALTHCHECK_URL` (healthchecks.io or similar, free tier).
  The script pings it on success and `<url>/fail` on failure — so you get paged both when a
  backup *fails* and when it *silently stops running* (the classic backup failure mode).

## 2. Server setup (one-time)

1. Create the private bucket in Cloudflare R2: `chirawa-db-backups`. Recommended: an R2 API
   token scoped to only this bucket → set `BACKUP_R2_*` overrides; otherwise the existing
   `R2_*` credentials are used.
2. Add to `/opt/chirawa/apps/api/.env` (see `.env.example`): `BACKUP_R2_BUCKET`,
   `BACKUP_RETENTION_DAYS`, `BACKUP_HEALTHCHECK_URL`, and — because production Postgres runs
   in Docker —
   ```
   BACKUP_PG_DUMP_COMMAND=docker exec chirawa_postgres pg_dump
   BACKUP_PG_RESTORE_COMMAND=docker exec -i chirawa_postgres pg_restore
   BACKUP_PSQL_COMMAND=docker exec -i chirawa_postgres psql
   ```
   (Native `pg_dump`/`pg_restore`/`psql` also work if the postgres client tools are installed
   on the host — the defaults assume that.)
3. Install the cron job (03:00 IST = 21:30 UTC; server runs UTC):
   ```cron
   30 21 * * * cd /opt/chirawa && flock -n /tmp/chirawa-db-backup.lock \
     pnpm --filter @chirawa/api db:backup >> /var/log/chirawa/db-backup.log 2>&1
   ```
   `flock -n` prevents overlapping runs; make sure `/var/log/chirawa/` exists and is rotated
   (`logrotate` or `pm2-logrotate` already used for app logs).
4. Run one manual backup and confirm the object in the R2 dashboard:
   `pnpm --filter @chirawa/api db:backup -- --label first-manual`

## 3. Restore procedures

List what's available (newest first):
```bash
pnpm --filter @chirawa/api db:restore -- --list
```

### 3a. Verification drill (non-destructive — run monthly and before launch)
```bash
pnpm --filter @chirawa/api db:restore -- --from latest
```
Downloads the newest dump, verifies the archive (`pg_restore --list`), restores it into a
**scratch database** `<db>_restore_verify` (live DB untouched), and runs the validation
checklist (§4). The scratch DB is kept for inspection; drop it afterwards with the printed
command.

### 3b. Full restore over the LIVE database (real disaster / bad migration)
1. **Stop writers:** `pm2 stop api worker` (nginx will serve 502s; that is correct — do not
   take writes into a database you are about to overwrite).
2. Restore (interactive confirmation phrase required):
   ```bash
   pnpm --filter @chirawa/api db:restore -- --from <r2-key-or-latest> --over-live
   ```
   Uses `pg_restore --clean --if-exists` into the live DB, then runs the validation checklist.
3. If the checklist passes: `pm2 restart api worker`, then run the app smoke test (place a COD
   order end-to-end on a test account).
4. If it fails: **do not reopen traffic** — try the previous backup; escalate.

### 3c. Rolling back a bad migration
Every `db:migrate:prod` run stored a `-pre-migration` dump seconds before the migration.
Restore it with §3b (`--from` the pre-migration key shown in the deploy logs / `--list`),
then revert the offending commit so the deploy pipeline doesn't re-apply the migration.
Note: any orders placed between migration and rollback are lost with the restore — decide
consciously (usually the window is seconds/minutes).

### Break-glass: migrating when R2 is down
`BACKUP_BEFORE_MIGRATE=skip pnpm --filter @chirawa/api db:migrate:prod` bypasses the guard.
Only after taking a manual local dump: `pnpm db:backup -- --local-only --keep-local`.

## 4. Restore validation checklist (automated by `db:restore`)

| Check | Pass condition |
|---|---|
| Tables present | > 10 public tables (typically ~46) |
| Migrations applied | `_prisma_migrations` has finished rows; latest name printed — compare to `prisma/migrations/` |
| Row counts | `users` / `orders` / `payments` / `transactions` printed — eyeball against expectations |
| Latest order timestamp | Within your RPO window of the incident |
| Referential integrity | 0 orphan `order_items` |
| Manual (post over-live restore) | API `/ready` returns 200; a test COD order completes end-to-end |

## 5. Deployment checklist (Data Safety phase)

- [ ] Private `chirawa-db-backups` bucket created (NOT public, NOT the assets bucket)
- [ ] `BACKUP_*` vars set in `/opt/chirawa/apps/api/.env` (docker command overrides on prod)
- [ ] Manual `db:backup` run succeeds; object visible in R2 dashboard
- [ ] Cron installed (§2.3); next-morning log + healthcheck ping verified
- [ ] `BACKUP_HEALTHCHECK_URL` configured and alerting to founders' phones/email
- [ ] Verification restore drill (§3a) run against the real production dump — checklist PASSED
- [ ] `db:migrate:prod` on the server takes a pre-migration backup (visible in deploy logs)
- [ ] Log rotation covers `/var/log/chirawa/db-backup.log`
- [ ] This document linked from the team runbook; both founders have run §3a once
