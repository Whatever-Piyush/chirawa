# Load-test suite (Phase 6)

Drives the compiled API + worker with production-shaped traffic and writes a
JSON evidence file per run. Findings and interpretation:
`docs/PERFORMANCE_REPORT.md`.

## Prerequisites

- docker-compose Postgres + Redis up, DB migrated and seeded
  (`pnpm --filter @chirawa/api db:seed` — needs products to browse)
- API built: `pnpm --filter @chirawa/api build`
- Nothing else running on the chosen port (default 3100)

## Run

```bash
node scripts/loadtest/run.mjs                          # all scenarios, 30 s each
node scripts/loadtest/run.mjs --scenario=search        # one scenario
node scripts/loadtest/run.mjs --duration=60 --users=80 # longer / more identities
```

Results land in `scripts/loadtest/results/<runId>/` (gitignored): `results.json`
plus the API/worker logs for the run.

## What it does

1. Spawns `dist/index.js` + `dist/worker/index.js` with the non-production
   test enablers (`RATE_LIMIT_DISABLED`, `OPERATING_HOURS_DISABLED`,
   `LOG_LEVEL=info LOG_PRETTY=false`, `BATCH_WINDOW_MS=2000`) — these are
   ignored by production builds, see `app.ts` / `operating-hours.ts`.
2. Provisions identities through the REAL flows: N customers via OTP dev
   bypass + one address each; the 3 seeded riders go online.
3. Scenarios (closed-loop workers, 5 s warmup discarded, per-op P50/P95/P99):
   - **browse** — feed / category products / product detail / categories / shops mix
   - **search** — rotating Hinglish terms, 20% `sort=rating`
   - **checkout** — add-to-cart → get cart → pricing preview
   - **orders** — add-to-cart → COD place; then measures **rider assignment**
     (order `confirmed_at` → `delivery_assignments.assigned_at`) straight from
     Postgres; a churn loop flips the 3 riders back online every 2 s so rider
     *capacity* (a business limit) doesn't starve the *pipeline* measurement
   - **sockets** — ramp 300 authenticated Socket.IO connections (websocket
     transport), handshake percentiles + 10 s idle hold
4. Samples once per second while each scenario runs: API/worker CPU% + RSS
   (`ps`), Redis ops/s + memory (`INFO`), Postgres commits/s + cache-hit ratio +
   active backends (`pg_stat_*`). Aggregates ride along in `results.json`.

## Caveats

- Run it on a DEV database — it creates real users, addresses, and hundreds of
  orders. Re-seed (`db:seed`) or reset to clean up.
- A dev laptop is not the production host: treat absolute numbers as
  best-case, comparisons and bottleneck shapes as transferable. The report
  documents the derating logic.
