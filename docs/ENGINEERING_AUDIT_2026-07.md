# Bringly (Chirawa) — Production Readiness Audit

**Date:** 2026-07-02 · **Scope:** full monorepo (`apps/api`, 3 Expo apps, `packages/*`, deploy/CI)
**Verified against:** `main` @ `68bede5` · 344/344 unit tests passing · `tsc --noEmit` **failing** (see P0-6)

This audit was performed by reading every core module (auth, orders, payments, catalog, delivery,
sockets, workers), the Prisma schema + migrations, the deploy pipeline (Dockerfile, GitHub Actions,
nginx, PM2), and the mobile network/auth layers. Every finding cites the file it was observed in.

---

## 1. Executive Summary

Bringly is a **well-engineered modular monolith with one architectural landmine and a deployment
pipeline that doesn't match its own design.** The application code is markedly above typical
seed-stage quality: the money paths (payments, refunds, settlements) use atomic claim-before-
external-call patterns with revert-on-failure; order status changes go through a single
compare-and-set state machine; webhooks are idempotent with raw-body HMAC verification; OTP auth
has layered rate limits and refresh-token rotation with theft detection; all money is integer
paise; 344 unit tests cover the critical paths.

**The landmine:** the cross-process event bus (`shared/events/event-bus.ts`) re-emits every event
to **every** API process, and every API process runs side-effectful listeners (FCM push, socket
emit, dispatch batching). PM2 is configured with `instances: 4` (`ecosystem.config.js`). In the
current production topology, **every order event fires 4× — customers and sellers receive 4
duplicate push notifications, 4 duplicate socket events, and the batching logic races against
itself 4 ways.** The system is only correct with exactly one API process. This blocks the stated
5,000-concurrent-user goal and must be fixed before launch.

**The pipeline mismatch:** CI builds and pushes a Docker image that is **never deployed**. The
server actually runs TypeScript from a git checkout via `tsx` under PM2. There is no rollback
mechanism, no database backup automation (planned in Task 11.2 of the production plan, never
implemented), and Socket.IO's polling fallback cannot work behind PM2 cluster mode without sticky
sessions.

Fix the P0 list (≈ 1–2 engineering weeks) and this system can credibly serve the target load on a
single CX32-class VPS with headroom for horizontal growth.

---

## 2. Scorecard

| Dimension | Score | One-line justification |
|---|---:|---|
| **Production Readiness** | **62/100** | Excellent app code; deploy/backup/observability gaps gate launch. |
| Security | 74/100 | Strong auth + payments crypto; socket `rider:location` authz gap, per-user rate-limit key trusts unverified JWTs, env foot-guns. |
| Performance | 68/100 | Good caching + indexes; search has per-row correlated subquery, rider-picker N+1, `tsx` runtime overhead, 2 missing hot-path indexes. |
| Scalability | **45/100** | Event fan-out is N-times-duplicated across PM2 instances; polling transport breaks in cluster mode. Horizontal scaling is currently *incorrect*, not just untested. |
| Reliability | 60/100 | Idempotent money paths are excellent; no rollback, no backups, no DLQ/alerting, worker is console-log-only. |
| Maintainability | 78/100 | Clean module boundaries, single state-machine enforcement point, exceptional comment discipline, 344 tests. |
| Developer Experience | 72/100 | Good scripts/CI/docs; `pnpm typecheck` broken on main; no lint in CI. |
| Cost Optimization | 70/100 | Single-VPS design is cost-appropriate; unused Docker registry pushes and a dev-dependency-laden image waste CI minutes and disk. |
| **Launch Readiness** | **58/100** | Gated entirely by the P0 list below — the code quality itself is launch-worthy. |

---

## 3. What is genuinely good (keep doing this)

- **Payments** (`payments.service.ts`): refunds claim the `Payment` row atomically
  (`updateMany WHERE status='captured'`) *before* calling Razorpay, and revert the claim on
  failure. Capture-after-cancel auto-refunds. Webhooks verify HMAC over the **raw body** (custom
  content-type parser in a scoped plugin — the classic Fastify pitfall, avoided), dedupe by
  `eventId` with process-first-record-after semantics.
- **Order state machine** (`order-status.ts`): one enforcement point, `assertTransition` + atomic
  CAS (`updateMany WHERE status=from`) + history row, in caller transactions. `codCollected` and
  `markDelivered` are idempotent at terminal states; COD amount is server-derived.
- **Auth**: RS256 JWTs, refresh rotation with reuse-detection revoking all sessions, bcrypt-12
  PINs with lockout, crypto-random OTPs with per-phone/per-IP Redis limits, tokens in SecureStore
  on device.
- **Checkout idempotency** (`shared/utils/idempotency.ts` + `orders.routes.ts`): SETNX lock +
  24 h replay, with a server-derived fallback key (`auto:{cartId}`) so keyless clients are still
  protected.
- **Settlements** (`settlement.job.ts`): payout idempotency keys, in-flight status set, ledger
  written only on `processed`, reconcile sweep for stuck payouts, `needsAttention` flags instead
  of fake success.
- **Aggregated feed cache** (`aggregation.service.ts`): single-flight lock + TTL jitter — actual
  stampede protection.
- **Socket order rooms**: fail-closed IDOR guard (`isAuthorizedForOrderRoom`) mirroring REST
  authorization, unit-tested.
- Integer paise everywhere; address snapshots on orders; seller-ownership checks on every
  inventory mutation; parameterized raw SQL (`Prisma.sql`) in search — no injection surface found.

---

## 4. Findings

Severity: **P0** = must fix before production · **P1** = before scaling · **P2** = can wait · **P3** = future.
Effort: S < ½ day · M ≈ 1–2 days · L ≈ 3–5 days.

### P0 — must fix before production

| # | Finding | Evidence | Impact | Effort |
|---|---|---|---|---|
| **P0-1** | **Event-bus side effects run once per API process.** `dispatch()` publishes every event to Redis; every API instance's bridge re-emits it locally; listeners in `realtime.plugin.ts`, `notifications.plugin.ts`, `dispatch.plugin.ts` all fire. With PM2 `instances: 4`: 4× FCM pushes, 4× socket emits (each reaches all clients via the Redis adapter), 4× `addConfirmedOrderToBatch` racing (its `order.batchId` guard is check-then-act, not atomic). | `shared/events/event-bus.ts:61-98`, `ecosystem.config.js:9` | Duplicate seller alarms/customer pushes on every order; batch races; makes horizontal scaling *wrong*, not just slow. | M — exactly-once claim per event id (Redis `SET NX`), all instances receive, one wins. **Fixed in this pass — see §6, change 2.** |
| **P0-2** | **Socket.IO polling transport breaks under PM2 cluster.** 4 workers share port 3000 with round-robin; Engine.IO long-polling requires session affinity. Clients on networks that block WebSocket (rural India — the target market) will get `Session ID unknown` 400s and never connect. | `realtime.plugin.ts:44` (`transports: ['websocket','polling']`), `ecosystem.config.js` | Live tracking/alarms silently broken for a slice of real users; hard to reproduce in dev. | S — force websocket-only on server + apps (acceptable: RN supports WS natively), or move to sticky routing. **Server+apps fixed in this pass — see §6, change 5.** |
| **P0-3** | **Deploy pipeline is incoherent; no rollback.** `deploy.yml` builds+pushes a Docker image that is never run; the server does `git pull` + `pnpm install` + `pm2 reload` running `tsx` on source. `deploy.sh` contains placeholder host/registry names. Rollback = undocumented manual git surgery while prod is down. | `.github/workflows/deploy.yml:52-92`, `scripts/deploy.sh:7,13`, `ecosystem.config.js:6` | Failed deploys unrecoverable under pressure; CI wastes ~3-4 min/deploy building unused images; two sources of truth drift. | M — pick ONE: (a) deploy the image you build (compose/systemd on the VPS), or (b) drop the image build and add `git tag`-based rollback + `pm2 reload` script. Recommendation: (a) — you already pay for the build. |
| **P0-4** | **No database backups exist.** Production plan Task 11.2 specifies daily `pg_dump` + 30-day retention + tested restore; no such script exists in `scripts/`, no cron config anywhere in repo. | `docs/BRINGLY_PRODUCTION_PLAN.md:923-930`, absence in `scripts/` | A single disk failure or bad migration = unrecoverable loss of orders/ledger. This is the single largest business risk in the repo. | S — backup script + cron + off-box copy (R2 bucket you already have) + documented restore drill. |
| **P0-5** | **`rider:location` socket event is unauthenticated against the order.** Any authenticated rider can broadcast arbitrary coordinates into ANY order room and insert unlimited `RiderLocation` rows (no assignment check, no lat/lng bounds, no throttle). | `realtime.plugin.ts:129-163` | Order-tracking map spoofable across all orders by any rider account; DB write amplification. | S — verify active `DeliveryAssignment` (cached), validate ranges. **Fixed in this pass — see §6, change 4.** |
| **P0-6** | **`pnpm typecheck` fails on `main` — 37 errors across 14 files** (stale generated Prisma client, dependency type drift, Fastify route-generic misuse). Worse: **`deploy.yml` triggers on push to main independently of `ci.yml`** — a red CI does not block deploys, so the gate was decorative. The types also masked a real bug (admins always asked to set a PIN). | `tsc --noEmit` on `main`; `.github/workflows/deploy.yml:3-5` vs `ci.yml` | Type regressions ship; CI signal distrusted. | S-M. **Typecheck fixed in this pass — see §6, change 1.** Gating deploy on CI (workflow `needs`/`workflow_run`) remains open. |

### P1 — fix before scaling

| # | Finding | Evidence | Impact | Effort |
|---|---|---|---|---|
| P1-1 | **Per-user rate-limit key trusts an unverified JWT.** `userOrIpKey` decodes the token without signature check; an attacker fabricates unlimited `sub` values (or adds a fake Bearer to unauthenticated routes) to dodge per-route limits. | `shared/middleware/rate-limit.ts:8-20` | Rate limiting on checkout/payment routes is advisory against a deliberate attacker (nginx zones still cap per-IP). | S — verify signature in the key fn (cheap RS256 verify, or HMAC the sub+IP), fall back to IP on failure. |
| P1-2 | **Missing hot-path indexes**: `Payment.razorpayOrderId` (every webhook + verify does `findMany` on it — table scan as payments grow) and `Order.batchId` (batch order lookups + `releaseOrderAssignment` count). | `schema.prisma:652-670, 506-597`; queries in `payments.service.ts:94,185` | Webhook latency grows linearly with payment count; batch ops ditto. | S — two-index migration. **Fixed in this pass — see §6, change 3.** |
| P1-3 | **Notification identity mismatch — rider/seller pushes silently dropped.** FCM tokens are keyed by `User.id`, but `updateOrderStatus` emits `riderId: order.riderId` (= `RiderProfile.id`) and `sellerId: ''`. The `cancelled` branch then looks up tokens with a profile-id (miss) or skips the seller entirely. Riders never get cancellation pushes; sellers never get cancel/delivered pushes. | `orders.service.ts:510-514`, `notifications.plugin.ts:19,148-163` | Riders drive to cancelled orders; sellers prepare cancelled orders. | M — make the event payload carry user ids explicitly (`riderUserId`, `sellerUserId`), fix emit sites; add a type-level distinction between profile ids and user ids. |
| P1-4 | **`computeIsOpen` uses server-local time against IST shop hours.** On a UTC server every shop's open/closed badge is shifted +5:30. (Checkout is safe — `operating-hours.ts` converts properly; this is the catalog display + resolver path.) | `catalog.service.ts:121-128` vs `shared/config/operating-hours.ts` | Shops shown closed during business hours (or open at 2 AM) once deployed to a UTC host. | S — reuse the IST conversion from `operating-hours.ts`. |
| P1-5 | **nginx config breaks its own app**: default `client_max_body_size` (1 MB) rejects the 5 MB image uploads the API accepts; `zone=api rate=30r/m` (0.5 req/s sustained per IP) will 503 normal browsing (NAT'd users share IPs!); no HSTS. | `scripts/nginx/chirawa.conf:6,84-95`, `app.ts:87-89` | Admin uploads 413; legitimate users throttled; downgrade attacks. | S — `client_max_body_size 6m;`, raise api zone to ~300r/m + burst, add HSTS header. |
| P1-6 | **Docker image ships dev deps and runs `tsx` in production.** No `tsc` build stage, full workspace `node_modules` (vitest, prisma CLI, TS) copied into the runner. | `Dockerfile:36-55` | ~3-4× image size; slower cold start; larger attack surface; TS errors can surface at *runtime*. | M — build to `dist/`, `pnpm deploy --prod` (or `--filter ... --prod install`) for the runtime layer. Pairs with P0-3. |
| P1-7 | **Refresh-token rotation is check-then-act.** Two concurrent refreshes with the same token both pass `usedAt === null` and both mint new sessions (the reuse-detection path is racy in the exact scenario it defends against). | `token.service.ts:107-177` | Token-theft detection can be raced past; extra live sessions. | S — claim with `updateMany WHERE tokenHash AND usedAt IS NULL`, treat count=0 as reuse. |
| P1-8 | **No BullMQ retry/backoff/DLQ policy.** Jobs are added with defaults (`attempts: 1`); assignment retries are hand-rolled; failed daily settlement or reconcile runs just log to console and wait for the next cycle; `removeOnFail: true` on auto-accept/assignment destroys failure evidence. No queue metrics/alerts. | `scheduler.ts`, `dispatch.plugin.ts:35`, `seller-timeout.plugin.ts:24` | Transient Redis/DB blips turn into lost auto-accepts and unassigned batches with no trace. | M — standard job options (attempts 3–5, exp backoff), keep failed jobs, add a queue-depth/failed-count check to `/ready` or a metrics endpoint. |
| P1-9 | **Worker process is observability-dark.** Entire worker + several services log via `console.log` (no pino, no levels, no structure); worker has no health endpoint; Sentry captures exist but nothing pages on job failure. | `worker/index.ts:106-131`, `settlement.job.ts` | Settlement failures discovered by sellers calling you. | M — pino in worker, uptime heartbeat (e.g. healthchecks.io ping in scheduler), Sentry alert rules. |
| P1-10 | **Mobile API client: failed refresh hangs queued requests forever; no fetch timeouts.** Subscribers pushed while `isRefreshing` are dropped without resolution on failure (`refreshSubscribers = []`), leaving in-flight screens awaiting a promise that never settles. No `AbortController` timeout on any request — dead radios hang UI. | `packages/api-client/src/index.ts:131-163` | Frozen screens on token expiry under poor connectivity — the common case in the target market. | S — resolve subscribers with `null` on failure; add 15 s abort timeout. **Fixed in this pass — see §6, change 6.** |
| P1-11 | **Rider-picker N+1** — `findBestRiderForPoint` runs 2 queries per online rider. | `batching.service.ts:97-105` | 100 riders → ~200 queries per assignment. | S — one `groupBy` on active assignments + one `findMany`. |
| P1-12 | **`assignBatch` status check is not atomic** (find → check `status !== 'open'` → transact). Two workers (concurrency 3 + manual admin trigger) can double-assign a batch to two riders. | `batching.service.ts:110-131` | Two riders dispatched to the same orders. | S — CAS: `updateMany WHERE id AND status='open' SET status='assigning'` as the claim. |
| P1-13 | **Search query computes a correlated `AVG(rating)` subquery per candidate row** and re-runs the full trigram filter for the count query on every search. | `catalog.service.ts:404-408,446-451` | Search P95 will degrade with orders-table growth; it's the hottest read path. | M — precompute shop rating (column updated on rating write, or 5-min Redis cache); drop count query or cache it. |
| P1-14 | **`NODE_ENV` defaults to `development`** in the env schema; the production hard-fail for placeholder Razorpay secrets and webhook-signature enforcement all key off it. PM2 only injects `NODE_ENV=production` when `--env production` is passed. One forgotten flag = webhook verification can be skipped with placeholder secrets. | `env.schema.ts:22,96-107`, `razorpay.service.ts:63-67` | Low-probability, catastrophic-impact misconfig. | S — require explicit NODE_ENV (no default) + bake it into the runtime (Dockerfile already does; PM2 path doesn't). |

### P2 — can wait (schedule within first quarter)

| # | Finding | Evidence |
|---|---|---|
| P2-1 | Promo `maxUsesTotal`/`maxUsesPerUser` checks are read-then-increment — concurrent checkouts can over-redeem a capped code. Claim via conditional `updateMany` on `currentUses`. | `promotions.service.ts:59-68`, `orders.service.ts:307-310` |
| P2-2 | Pinned (non-aggregated) cart lines are not re-validated for price/stockStatus at checkout — stale Redis cart prices are honored. Decide policy: re-price at checkout with a "price changed" response. | `orders.service.ts:147-187` |
| P2-3 | `Order.riderId` / `Batch.riderId` have no FK relations; `DateTime` columns are `timestamp` not `timestamptz`. Add relations + plan a timestamptz migration. | `schema.prisma:539,750` |
| P2-4 | Invalid FCM tokens are logged but never evicted from Redis — dead tokens are retried forever. Delete on `registration-token-not-registered`. | `fcm.service.ts:100-105` |
| P2-5 | `OrderTrackingScreen.tsx` is 1,788 lines with **two** always-on `setInterval`s (1 s + 10 s) driving full-component re-renders — battery + jank. Split; drive the countdown with a memoized child. | `screens/orders/OrderTrackingScreen.tsx:133,764-765` |
| P2-6 | Cache-aside without locks on `shopList`/`shopDetail`/`bestsellers` (the agg feed has single-flight; these don't). Add jitter or reuse the agg helper. | `catalog.service.ts:132-174` |
| P2-7 | Settlement "day" boundary uses server-local midnight, not IST business day. Consistent but confusing for sellers; align with IST like `operating-hours.ts`. | `settlement.job.ts:50-55` |
| P2-8 | Referral unlock is a dead path: `enqueueReferralUnlock` is a console-log stub and nothing enqueues `UNLOCK_REFERRAL`; the worker processor exists but never runs. Wire it on `delivered` or delete the feature scaffolding. | `orders.service.ts:915-926` |
| P2-9 | CI has no lint step — and `pnpm --filter @chirawa/api lint` currently **errors** (no ESLint config resolves inside `apps/api`; only `.eslintrc.base.json` exists at the root, unreferenced). Deploy workflow re-runs tests already gating CI; no coverage threshold. | `.github/workflows/ci.yml`, `apps/api` (no `.eslintrc`) |
| P2-10 | Webhook nginx location is fully unlimited; app-level global limiter (100/min/IP) is the only cap. Add a generous nginx zone (e.g. 300r/m) to blunt floods. | `scripts/nginx/chirawa.conf:62-70` |
| P2-11 | `runIdempotent` lock TTL is 60 s; a checkout that stalls >60 s (Razorpay order create against a flaky gateway) lets a retry run concurrently. Consider extending the lock while in flight. | `shared/utils/idempotency.ts:6` |
| P2-12 | Android Maps API key is committed in `app.json` (client keys ship in the APK anyway, but the committed key must be restricted in Google Cloud console to the Android package + SDK). `google-services.json` files are committed — same treatment. | `apps/customer-app/app.json` |
| P2-13 | `getMyOrders` is a fixed `take: 50` with no pagination; order history truncates silently. | `orders.service.ts:441-447` |
| P2-14 | The `notification` BullMQ queue is created and never consumed; `SEND_PUSH`/`SEND_SMS` job names are dead. Either move FCM/SMS sends into it (retries for free — good idea anyway) or delete it. | `shared/plugins/queue.plugin.ts:37`, `worker/queues.ts:24-26` |
| P2-15 | PostGIS setup (`scripts/setup-postgis-indexes.sql`) is a manual out-of-band step, not a migration — new environments will silently miss it (currently unused by queries, so latent). | `scripts/setup-postgis-indexes.sql` |

### P3 — future improvements

- **Observability stack**: request-id propagation to mobile (`x-request-id` response header), RED
  metrics endpoint (fastify + prom-client), Grafana dashboards for queue depth / Redis / PG.
- **Load testing**: k6 script for the checkout + tracking hot paths; verify the 150 ms P95 target.
- **API docs**: Fastify's schema support is unused — adding zod-to-JSON-schema on the top 10
  routes gives request validation *and* OpenAPI for free (replacing hand-rolled `safeParse`).
- **Integration tests**: supertest is installed but unused; add a docker-compose-backed suite for
  auth → cart → order → webhook end-to-end.
- **Repository layer**: services call Prisma directly (fine at this size); if modules keep
  growing, extract per-module data access to keep transaction boundaries visible.
- **Mobile**: adopt TanStack Query for caching/retries/offline; FlashList for long product lists;
  OTA updates via `expo-updates` for hotfixes without store review.

---

## 5. Roadmap

**Week 1 (P0):** P0-6 typecheck → P0-1 exactly-once events → P0-2 websocket-only → P0-5 rider
location authz → P0-4 backups + restore drill → P0-3 single deploy path with rollback.
**Weeks 2–3 (P1):** indexes → notification identity fix → nginx fixes → NODE_ENV hardening →
refresh rotation CAS → rate-limit key fix → BullMQ retry policy + worker logging → Docker build
stage → mobile client timeout/refresh fix → IST fix → rider-picker N+1 + assignBatch CAS.
**Quarter (P2):** as listed. **Later (P3):** as listed.

Risk ranking if launched today, unchanged: (1) no backups, (2) 4× duplicate notifications
on every order (immediate seller/customer trust damage), (3) no rollback under a bad deploy,
(4) spoofable rider location, (5) throttled/blocked real users via nginx + polling issues.

---

## 6. Phase 4 — changes implemented in this pass

Each change is a single engineering concern, committed separately on branch `eng/p0-hardening`
(**local only — review, then push/PR; a push to `main` auto-deploys, so merge deliberately**).
Full problem/solution/risk/rollback/testing notes are in each commit message.

| # | Commit | Concern | Verification |
|---|---|---|---|
| 1 | `fix(types)` | P0-6 — 37 typecheck errors → 0; includes real admin-PIN bug fix; 17 routes moved to canonical Fastify v4 route generics; stale Prisma client regenerated. | `tsc --noEmit` clean; 344/344 tests |
| 2 | `fix(events)` | P0-1 — exactly-once event delivery via per-event Redis `SET NX` claim; at-least-once fallback when Redis misbehaves; worker/tests keep legacy local emit. | +7 unit tests (351/351) |
| 3 | `perf(db)` | P1-2 — indexes on `payments.razorpay_order_id`, `orders.batch_id` (additive migration, generated via `prisma migrate diff`). | `prisma validate`; tests green |
| 4 | `fix(realtime)` | P0-5 — `rider:location` now requires an active `DeliveryAssignment` (30 s per-socket memo, fail-closed), validates lat/lng bounds, throttles DB persists to 1 row/order/10 s. | +12 unit tests (363/363) |
| 5 | `fix(realtime)` | P0-2 — server transports `['websocket']`; verified all 3 apps + dev script already pin websocket. | tests green; call-site sweep |
| 6 | `fix(api-client)` | P1-10 — failed refresh settles queued requests (null → session-expired path, not a hang); 15 s abort timeout on all fetches. | api-client + api typecheck clean |

Still open from the P0 list (need infra decisions/server access, not just code):
**P0-3** single deploy path + rollback, **P0-4** backups + restore drill, and the
`deploy.yml`-not-gated-on-CI gap from P0-6.
*(Update: P0-4 closed by the Data Safety pass — see §7 of git history / docs/DISASTER_RECOVERY.md.
P0-3 and the CI gap closed by Production Hardening Phase 2 — see §7 below.)*

## 7. Production Hardening Phase 2 — Deployment & Rollback (implemented)

Closes **P0-3**, the CI-gating gap from **P0-6**, and **P1-6**. Committed separately on
`eng/p0-hardening` (same review-then-merge-deliberately rule as §6). Full flow:
`docs/DEPLOYMENT.md`; rollback runbook: `docs/ROLLBACK_DRILL.md`; decision record:
`docs/adr/004-deploy-pipeline.md`. **Requires the one-time server migration in
docs/DEPLOYMENT.md §4 before the first deploy.**

| # | Commit | Concern | Verification |
|---|---|---|---|
| 1 | `feat(env)` | NODE_ENV required (no silent `development` default); prod hard-fails placeholder Fast2SMS/R2 creds, localhost URLs, template JWT keys; warn-only for designed degradations (FCM/Mappls/RazorpayX/Sentry); `env:check` preflight. | 24 schema tests (409/409 total); `env:check` exercised in dev + prod modes |
| 2 | `feat(runtime)` | PM2 runs compiled `dist/` (P1-6: no more tsx-on-source in prod); Dockerfile compiles TS, prunes dev deps, non-root + HEALTHCHECK (1.23 GB → 540 MB); `packageManager` pinned pnpm\@9.15.9 (latest pnpm crashes on Node 20 — corepack was unpinned). | compiled API + worker booted locally (health 200, PG+Redis connect, clean shutdown); image booted: /health 200, HEALTHCHECK healthy, non-root, 0 dev deps |
| 3 | `feat(deploy)` | Deploy gated on the real CI workflow (`workflow_call` + `needs`); exact-SHA checkout instead of `git pull`; single `scripts/server-release.sh` (install → generate → build → env:check → guarded migrate → reload → health → history); one-click `rollback.yml` + one-command `scripts/rollback.sh` (migrations skipped); dead ghcr push removed; `deploy.sh` placeholder-host Docker script replaced. | workflows YAML-validated; scripts `bash -n`; rollback target resolution tested against fixture histories |
| 4 | `docs(deploy)` | DEPLOYMENT.md (flow + gates + one-time server migration + validation checklist), ROLLBACK_DRILL.md (runbook + quarterly drill), ADR 004, github-secrets.md updated. | — |

## 8. Production Hardening Phase 3 — critical runtime bugs (implemented)

Closes **P1-3, P1-4, P1-5, P1-7, P1-8, P1-12** plus **P2-8** and **P2-10**. Committed
separately on `eng/p0-hardening` (same review-then-merge-deliberately rule). Each commit
message carries the full root-cause / solution / regression-prevention narrative.

| # | Commit | Concern | Verification |
|---|---|---|---|
| 1 | `fix(notifications)` | P1-3 — seller/rider pushes silently dropped (payloads carried '' / RiderProfile.id where User.id was needed). Status-changed payload no longer carries party ids; consumers resolve USER ids via one helper; remaining fields renamed `*UserId`. | 4 resolver tests; excess-property checks flushed all 10 emit sites; 2 tests that canonized the bug corrected |
| 2 | `fix(catalog)` | P1-4 — shop open/closed badge used server-local time against IST shop hours. `currentISTTimeHHMM()` in operating-hours.ts; computeIsOpen exported + injectable now. | 8 tests, run under local TZ and TZ=UTC |
| 3 | `fix(nginx)` | P1-5 + P2-10 — 1 MB body cap 413'd 5 MB uploads; api zone 0.5 r/s 503'd CGNAT users; no HSTS; webhook zone defined but never applied. 6m body, 300r/m api, 60r/m auth, webhook zone wired, HSTS 1y. | real `nginx -t` (dockerized) passes; **manual copy to server + reload required** |
| 4 | `fix(auth)` | P1-7 — refresh rotation was check-then-act; concurrent refreshes double-minted sessions past reuse detection. Conditional updateMany claim; count=0 ⇒ revoke session family. | 6 tests incl. exactly-one-mints concurrency + alarm-over-expired precedence |
| 5 | `fix(delivery)` | P1-12 — assignBatch could dispatch two riders to one batch. CAS claim (status='open') inside the assignment transaction, ordered before any write. | 6 tests incl. zero-writes-on-lost-claim + exactly-one-assignment |
| 6 | `fix(worker)` | P1-8 — attempts:1 everywhere, removeOnFail:true destroyed evidence, Sentry fired per attempt. One DEFAULT_JOB_OPTIONS on all 14 queues (5 attempts, exp backoff, 7d failure retention); retry-vs-final logging; auto-accept keeps removeOnComplete:true so its deterministic jobId re-arms. | 4 policy-invariant tests; compiled worker boots clean |
| 7 | `chore(referral)` | P2-8 — unlock path was dead scaffolding behind a stub that logged "queued" while queueing nothing (and the processor had non-atomic money bugs). Removed runtime scaffolding; kept schema + signup recording; features.ts documents the rebuild path. | typecheck + full suite; worker boots with 5 workers |

Still open from P1 after this pass: P1-1 (rate-limit key trusts unverified JWT), P1-9
(worker observability/pino/heartbeat), P1-11 (rider-picker N+1), P1-13 (search hot-path
SQL), P1-14 (closed by Phase 2's env work — NODE_ENV is now required, no default).

## 9. Production Hardening Phase 4 — remaining P1s (implemented)

Closes **P1-1, P1-9, P1-11, P1-13** — with §7 (Phase 2) and §8 (Phase 3), **every P1 finding
in this audit is now closed.** Committed separately on `eng/p0-hardening`; full narratives in
the commit messages.

| # | Commit | Concern | Verification |
|---|---|---|---|
| 1 | `fix(security)` | P1-1 — rate-limit bucket key trusted an UNVERIFIED JWT (fabricated `sub` = fresh bucket per request). Key fn now runs the same verifyAccessToken as auth; unverifiable tokens share the per-IP bucket. | 5 tests incl. forged-sub fallback + same-bucket property |
| 2 | `perf(delivery)` | P1-11 — 2 queries PER online rider in BOTH assignment paths (audit cited one; the loop was duplicated). One shared loadRiderCandidates: findMany + groupBy = 2 queries at any rider count. | tests assert the query-count invariant (2 queries for 100 riders) |
| 3 | `perf(search)` | P1-13 — every search paid a per-candidate-row correlated AVG(rating) subquery (only used by sort=rating) + re-ran the trigram WHERE for the count label. Rating now zero-cost unless sort=rating (then one grouped join backed by a new orders(shop_id, rating) index); count Redis-cached 5 min. | exercised live against local PG+Redis: both sorts correct, count cache key observed; additive migration applied |
| 4 | `feat(worker)` | P1-9 — money-moving worker was console.log-only, no liveness signal. pino structured logs (43 calls converted), WORKER_HEARTBEAT_URL dead-man's switch (warns at prod boot when unset), Sentry alert setup documented (DEPLOYMENT.md §8). | 447/447 tests; compiled worker booted — structured logs + heartbeat ping observed |

## 10. Production Operations pass — observability & runbook (implemented)

The "Phase 4 — Production Operations" spec (observability & operations, 8 items). Most of it
had already landed in earlier passes — this pass closed the remainder and consolidated the
operational documentation. Committed separately on `eng/p0-hardening`.

Spec item → where it lives:

| Spec item | Status | Where |
|---|---|---|
| 1. Structured logging | ✅ this pass completed it | API request logging was already Fastify/pino (§6); non-request services now share one pino config (`shared/observability/logger.ts`) with per-service `svc` bindings |
| 2. Worker logging | ✅ already done (§9, P1-9) | `worker/logger.ts`, now a child of the shared base |
| 3. Remove console.log from production paths | ✅ this pass | 25 calls across 9 files converted (event-bus, payments, razorpay, otp, sms, fcm, orders, distance, off-source, off-live). `config/env.ts` keeps console deliberately — it runs before any logger can exist |
| 4. Sentry (backend/worker/alerts) | ✅ already done (§6/§8/§9) | init + error-handler capture in both processes; alert rules documented in RUNBOOK.md §2 (was DEPLOYMENT.md §8) |
| 5. Health endpoints | ✅ already done (Phase 2) | `/health` liveness + `/ready` DB/Redis readiness, both with monitor-friendly rate-limit carve-outs |
| 6. Uptime monitoring readiness | ✅ this pass (docs) | RUNBOOK.md §2 — exact monitors to create (health, ready, worker heartbeat) |
| 7. Log rotation | ✅ this pass | `scripts/logrotate/chirawa` (daily/100 MB, 14 kept, copytruncate; deploy-history excluded) + one-time install (DEPLOYMENT.md §9) |
| 8. Operational runbook | ✅ this pass | `docs/RUNBOOK.md` — topology, monitoring, restarts, deploy/rollback pointers, payments ops, worker recovery, incident response, ops calendar, log cheat-sheet |

| # | Commit | Concern | Verification |
|---|---|---|---|
| 1 | `feat(observability)` | Console sweep: one shared pino config for every non-request log line; 9 files converted to structured logs with `svc` + correlation fields (orderId/status/code). Worker logger rebased onto the shared base. | typecheck clean; 447/447 tests; worker booted live — structured logs observed end-to-end |
| 2 | `feat(ops)` | Log rotation for PM2-captured logs (`/var/log/chirawa` grew unbounded). Also fixes DEPLOYMENT.md §4's pnpm pin (said 11.3.0; the repo pins 9.15.9 — newer pnpm crashes on Node 20, §7). **One-time server step: install the logrotate config (DEPLOYMENT.md §9).** | real `logrotate -d` dry run (dockerized Alpine): config parses, all 4 logs matched, policy as specced |
| 3 | `docs(ops)` | RUNBOOK.md — the single entry point for production operations; cross-linked from DEPLOYMENT.md. | commands cross-checked against ecosystem.config.js, scheduler.ts cadences, package.json scripts |

Operational docs are now complete as a set: DEPLOYMENT.md (how code ships) → ROLLBACK_DRILL.md
(how to un-ship it) → DISASTER_RECOVERY.md (database) → RUNBOOK.md (everything day-2).

## 11. Production Hardening Phase 5 — Infrastructure & Production Configuration (implemented)

The "Phase 5 — Infrastructure & Security" spec (12 items), shaped by two founder decisions:
**COD-only at launch** (Razorpay stays wired + properly configured, but not selectable —
"coming soon" in the app, rejected by the API) and **Mappls, never Google** (backend now has
zero Google call sites; one client-side Android *tile* key remains, env-injected). Committed
separately on `eng/p0-hardening` ("Infra 1–7"); full narratives in the commit messages.
**Deliverable: `docs/PRODUCTION_READINESS_CHECKLIST.md`** — every remaining console/server
action, with the code-enforced parts marked done.

| # | Commit | Concern | Verification |
|---|---|---|---|
| 1 | `feat(payments)` | COD-only launch flag `PAYMENTS_ONLINE_ENABLED` (default false): placeOrder rejects non-COD first-check; payment-order creation refuses; verify/webhook/refund stay open (in-flight money survives a flag flip); Razorpay env hard-fail now conditional on the flag; webhook dev-skip FAILS CLOSED in production (was reachable once the hard-fail relaxed). | 465/465 at the time; 12 new tests (guard-before-IO, fail-closed matrix, env shapes) |
| 2 | `feat(customer-app)` | "Pay Online" visible but dimmed + "Coming soon" badge + toast; COD only selectable method; `FEATURES.onlinePayments` beside the other launch flags. | app tsc clean; badge styles + i18n existed unwired — now wired |
| 3 | `feat(pricing)` | Distance via Mappls Distance Matrix (biking profile, lng-first coords) — last backend Google call removed; `GOOGLE_MAPS_API_KEY` deleted from env schema + examples; MAPPLS_* documented (was missing from apps/api/.env.example entirely). Contract verified against the official mappls-api spec (doc v1.0.0, 2025-06). | 7 new tests pin URL shape/parsing/fallbacks; 472/472 |
| 4 | `fix(security)` | REAL Google Maps key was hardcoded in customer-app/app.json (compromised — git history). Now env-injected at build time via app.config.js (`GOOGLE_MAPS_ANDROID_API_KEY`); rotation + Android-restriction tracked in the checklist. | `expo config --type prebuild` resolved with and without the env var |
| 5 | `feat(db)` | Seeds refuse production (NODE_ENV or non-local DATABASE_URL; explicit SEED_FORCE sentence to override) — they create OTP-loginable well-known phones. Founder admin via `admin:create -- --phone <n>` (validated, idempotent, OTP-auth only — no PIN to leak). | guard + script exercised live: refused ×2, seeded dev, created + promoted idempotently |
| 6 | `docs(launch)` | PRODUCTION_READINESS_CHECKLIST.md — all 12 spec items: Razorpay live-cred + webhook setup (captured/failed events), RazorpayX payout activation, Fast2SMS + DLT registration workflow (verified bulkV2 `route=dlt` contract documented in sms.service.ts; OTP route needs no DLT), FCM service account + google-services key restrictions, Mappls console setup + Google key rotation, secret-audit findings, placeholder-consequence table, env-separation verification, final pre-launch gate. | secrets sweep run (AIza/rzp_live/PEM): one finding, fixed in #4 |
| 7 | `docs(audit)` | This section. | — |

Spec-item → status: 1 Razorpay ✅ (#1+checklist §1), 2 webhooks ✅ (#1 fail-closed + §2),
3 RazorpayX ✅ (audited; config-only, §3), 4 Fast2SMS ✅ (§4), 5 DLT ✅ (readiness: contract
in code, workflow §5), 6 Firebase ✅ (§6), 7 maps keys ✅ (#3+#4+§7 — Mappls, per decision),
8 secret audit ✅ (§8), 9 placeholders ✅ (#3 removal + §9 sweep), 10 seed guard ✅ (#5),
11 founder admin ✅ (#5), 12 env separation ✅ (verified; §12).

## 12. Production Hardening Phase 6 — Performance Validation (implemented)

The "Phase 6 — Performance & Scalability" spec: load-test suite, six scenario
measurements (P50/P95/P99 + CPU/memory/DB/Redis/worker), bottleneck analysis,
recommendations. **Deliverable: `docs/PERFORMANCE_REPORT.md`** with raw evidence in
`docs/perf/` and a rerunnable suite in `scripts/loadtest/`. Committed as "Perf 1–4".

| # | Commit | Concern | Verification |
|---|---|---|---|
| 1 | `feat(api)` | Non-production test enablers: LOG_LEVEL/LOG_PRETTY (prod-shaped logs from a dev-mode process), RATE_LIMIT_DISABLED, OPERATING_HOURS_DISABLED — the latter two impossible in production (2 tests pin it). | 474/474 |
| 2 | `feat(loadtest)` | Closed-loop generator + 1s resource sampler + orchestrator that boots dist API+worker, provisions identities through real flows, drives browse/search/checkout/orders/assignment/sockets, emits JSON evidence. | full run: zero errors across all scenarios |
| 3 | `docs(perf)` | The report. Headline numbers (dev-host best-case): browse 1,179 rps, checkout 1,073 rps, ~100 COD orders/s at P95 136 ms, assignment pipeline overhead ~0.2–0.5 s beyond the batch window, 300/300 sockets at P99 27 ms. **Launch-relevant finding: search trigram scoring is unindexed** — measured collapse 347 rps/78 ms → 8 rps/5.7 s when the catalog was inflated 285 → 14,250 products; GIN + operator-form fix validated live (158 → 18 ms). Categories endpoint shares the O(catalog) pathology; Prisma pool defaults bound DB paths (22 active backends = ceiling). | evidence JSON committed; EXPLAIN plans + paired timings in report §5 |
| 4 | `docs(audit)` | This section. | — |

Top recommendations (report §6): R1 GIN trgm + operator rewrite BEFORE the catalog
passes ~1–2k products; R2 SQL-side counts + cache for /catalog/categories; R3 explicit
Prisma connection_limit in the production DATABASE_URL; R6 re-run the suite on the CX32
pre-launch to replace the derated estimate with a measurement.

## 13. Production Hardening Phase 7 — End-to-End Launch Validation (implemented)

The "Phase 7 — Launch Validation" spec: complete smoke of every customer/seller/rider/admin
journey plus notifications, payments, retries, logging, monitoring, and DB integrity —
"no assumptions, every validation reproducible." **Deliverable: `docs/LAUNCH_VALIDATION.md`**
(signed checklist) over `docs/validation/smoke-2026-07-03.json` (26/26, sha256-pinned),
produced by the rerunnable suite `scripts/smoke/run.mjs`. Committed as "Validate 1–4".

| # | Commit | Concern | Verification |
|---|---|---|---|
| 1 | `fix(observability)` | shared logger ignored LOG_LEVEL/LOG_PRETTY (only app.ts honored them, Perf 1/4) — service logs stayed pretty where Fastify's went JSON. Found BY the smoke suite's logging validation. | 474/474; smoke V4 pins every stdout line as JSON with correlation fields |
| 2 | `feat(smoke)` | Assertion-based E2E suite: boots dist API+worker twice (launch config, then PAYMENTS_ONLINE_ENABLED=true), drives all 26 validations through real HTTP/WebSocket incl. full COD lifecycle, dev-mock online payment→refund, forged webhook, poisoned-job retry exhaustion, heartbeat listener, 7 SQL integrity invariants. Preflight refuses to run beside foreign event-bus subscribers (a live dev API steals exactly-once claims — root cause of the one flake seen). | 26/26; suite exits non-zero on any failure |
| 3 | `docs(validation)` | LAUNCH_VALIDATION.md — spec-item → validation-ID → proof matrix, reproduce commands, what a dev run deliberately cannot prove, the production sign-off gate (§5), and the sign-off table (automated row signed; human rows after the prod gate). | evidence JSON committed + hashed |
| 4 | `docs(audit)` | This section. | — |

Notable validated behaviors beyond the happy paths: COD amount tampering ignored
(server-derived), forged webhook = zero side effects, refund claim atomicity, per-phone
OTP abuse caps, real-FCM send failure not breaking order flow, non-admin 403 on admin
surfaces. With §6–§13, all seven hardening phases are implemented and evidenced.
