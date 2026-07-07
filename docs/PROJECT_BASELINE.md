# Bringly — Project Status Baseline

**Date:** 2026-07-07 · **Role:** Principal Product Architect · **Status:** Official engineering baseline — master reference for all future sprints.
**Source of truth:** the repository at branch `eng/p0-hardening` (HEAD `82b2cd7` + uncommitted working tree), its `docs/` audit trail, and git history. Every claim below was verified against code this session.
**Verification evidence (this session, working tree):** `pnpm typecheck` → green across all workspaces · `pnpm --filter @chirawa/api test` → **525/525 tests passing (64 files)** · Postgres 15 (PostGIS) + Redis 7 healthy in Docker.

---

## 1. Executive Summary

Bringly is a production-grade hyperlocal quick-commerce platform for **Chirawa, Rajasthan** (pop. ~80,000, ~3 km delivery radius): a Fastify/PostgreSQL/Redis backend plus three Expo (React Native) apps — Customer, Seller, Rider — presented at launch as **one unified storefront**, **COD-only**, operating **9 AM–8 PM IST**, with salaried riders and 0% seller commission. Total code: ~44,600 lines of TypeScript across the monorepo.

The project has passed through three distinct eras, all visible in git history:

1. **Feature build-out** ("Chunks 0–8" of `docs/BRINGLY_PRODUCTION_PLAN.md`): full order lifecycle — catalog, search (incl. Hindi voice search), GPS/Mappls addresses, cart/checkout/pricing, Razorpay integration, rider dispatch/batching, live tracking with server-computed ETA, promotions, seller portal.
2. **Production hardening** (7 phases on `eng/p0-hardening`): every P0/P1 from a full engineering audit closed — exactly-once event delivery, atomic CAS on all money/state races, verified backups to R2, CI-gated exact-SHA deploys with one-command rollback, structured logging, worker heartbeat, Sentry, load-test + 26/26 end-to-end launch validation. **Final audit: 88/100, GO — conditional only on the operational launch gate.**
3. **Product completion sprints** (current era): Seller Sprints 0–4 committed (pause-store toggle, product images, inventory search, category sections, bulk stock). In-flight uncommitted: customer milestones A1–A4 (active-order strip, login/OTP resend, pricing transparency, post-order fixes), R1 (rider live location + assignment honesty), and Seller Sprint 5 Phase A (recovery-engine foundation).

**The single most important fact in this baseline:** the code is launch-ready, but **53 commits — the entire hardening effort and all seller sprints — exist only on this machine.** `origin/main` still points at pre-hardening commit `68bede5`. Nothing hardened has been deployed. The remaining distance to launch is not engineering; it is (a) merge/ship the local branch, (b) run the documented operational gate (credentials, key rotation, monitors, production sign-off), and (c) validate rider location on a physical device.

---

## 2. Product Overview

### 2.1 The five surfaces

| Surface | What it is | State |
|---|---|---|
| **Customer App** | Expo/RN (SDK 54). OTP login → browse unified storefront (home rails, categories, search with filters/voice, product detail) → multi-shop cart → COD checkout with fee/discount transparency → live tracking (socket + poll, ETA hero, timeline, refund/OOS-substitute cards) → rating, reorder, order history. Addresses: GPS map-pin + Mappls geocoding, address sharing/requesting via deep links. Hindi/English, dark mode, night "closed" theme. | Shipped-quality core loop; A1–A4 fixes in working tree |
| **Seller App** | Expo/RN. OTP+PIN login → live order queue (socket + continuous alarm) → accept/reject → preparing → ready. Inventory: add/edit products, camera/gallery images, barcode-scanner add against master catalog, CSV bulk import, per-category sections, search, bulk stock updates, stock quantities. Store open/close toggle. Settlement screen (today/week/month, 0% commission). Hinglish UI. | Functional; Sprints 0–4 committed |
| **Rider App** | Expo/RN. OTP+PIN login → online/offline toggle → assignment notification (order is pre-assigned by dispatch; no fake accept/decline anymore) → batch view (pickup-first gating) → navigate (Google Maps link-out), call customer, COD collect with server-derived amount → delivered. Foreground-service live location publishing (in tree, device-unvalidated). Earnings screen is a stub. | Core path works; R1 in tree pending device validation |
| **Admin Panel** | **JSON API only — there is no admin UI.** Endpoints exist for: dispatch live-ops snapshot, metrics, coverage, catalog moderation (master status, image reports, takedowns, price outliers), search-alias management, category image upload, and (in tree) recovery-need orchestration. No order cancel/refund/user-management endpoints exist at all. Founder ops today = WhatsApp + these endpoints + DB console. | ~15% (API-only) |
| **Backend API** | Fastify 4 modular monolith (ADR-001): 15 live modules + BullMQ worker process. PostgreSQL 15 + PostGIS via Prisma 5 (49 models, 31 migrations), Redis 7 (cache, queues, event bus, socket adapter). Socket.io (websocket-only) for realtime. RS256 JWT auth with rotating refresh tokens; OTP via Fast2SMS; push via FCM; Razorpay/RazorpayX wired but COD-gated; Mappls for all geo APIs. | Hardened, validated 26/26 E2E |

### 2.2 How they work together

```
Customer app ──REST──▶ /api/v1/* (auth, catalog, cart, pricing, orders, payments, geo)
      ▲  ▲                    │
      │  └──Socket.io─────────┤  order rooms (IDOR-guarded), ETA + status + rider location
      │                       ▼
Seller app ◀──socket `order:new` + FCM push ── event bus (Redis pub/sub, exactly-once claim)
      │ accept/reject/preparing/ready               │
      ▼                                             ▼
Order state machine (single CAS enforcement point, `order-status.ts`)
      │ confirmed                                   │
      ▼                                             ▼
Dispatch plugin → BullMQ → batching service (zone/proximity grouping) → DeliveryAssignment
      │                                             │
      ▼                                             ▼
Rider app ◀── socket `order:assigned` + FCM ── worker (assignment, seller auto-accept
      │ pickup → out_for_delivery → COD collect     timeout, settlements, reconciliation,
      ▼                                             ETA, heartbeat)
Delivered → settlement ledger (integer paise) → RazorpayX payout (self-disabling until configured)
```

- **One order, multi-shop:** the cart splits into per-shop orders under an `OrderGroup`; batching can hand nearby same-zone orders to one rider.
- **State changes** all pass through one compare-and-set state machine with history rows; COD amounts are server-derived (client values ignored).
- **Events** are published once to Redis; each API/worker process competes on a `SET NX` claim so side effects (push, socket, dispatch) run exactly once across the PM2 cluster.
- **Money** is integer paise end-to-end (ADR-002); settlements, refunds, and payouts are atomic claim-before-external-call with revert-on-failure.

### 2.3 Production topology (designed; not yet deployed)

Hetzner CX32 VPS (4 vCPU): nginx (TLS, rate zones, HSTS) → PM2 cluster ×4 running compiled `dist/` API + 1 worker process → local PostgreSQL 15 + Redis 7. GitHub Actions: CI (tests + typecheck, real PG/Redis services) gates deploy; deploy ships the exact tested SHA via `scripts/server-release.sh` (install → build → `env:check` → backup-guarded migrate → reload → health gate); `rollback.yml` / `scripts/rollback.sh` provide one-command rollback (`docs/DEPLOYMENT.md`, `docs/ROLLBACK_DRILL.md`, ADR-004). Nightly verified `pg_dump` → Cloudflare R2 with retention + restore drill (`docs/DISASTER_RECOVERY.md`, ADR-003). Day-2 operations: `docs/RUNBOOK.md`.

---

## 3. Completed Work

### 3.1 Backend — completed systems

| System | Content |
|---|---|
| Auth | OTP login (Fast2SMS; dev bypass compiled out of prod), RS256 JWTs with `alg` allowlist, rotating refresh tokens with atomic CAS claim + family revocation on reuse, bcrypt-12 PINs with lockout, per-phone/per-IP OTP rate limits, verified-signature rate-limit bucket keys |
| Catalog | Shops, categories (default-category invariant, one per shop), products, variants, images (R2 + image pipeline), master catalog + barcode lookup, product requests, image reports, moderation, bestsellers, aggregated feed cache with single-flight, Hinglish search aliases, trigram search with filters/sort + suggest endpoint |
| Cart & Pricing | Multi-shop cart (Redis), fee rules: ₹25 below ₹100 cart, ₹10 standard, ₹15 Chirawa Special; FIRSTORDER auto-promo (free delivery, first order); promo validation engine; pricing preview endpoint whose equation is E2E-pinned (total = subtotal + fee − discount, integer paise) |
| Orders | Idempotent placement (Redis SETNX + replay), central CAS state machine + history, multi-shop groups, cancel with reasons + rider/batch release, item-unavailable flow with per-line refund + substitute suggestion, receiver/address change pre-pickup, server-computed milestone ETA, ratings, paginated history (in tree) |
| Payments | Razorpay create/verify/webhook (raw-body HMAC, fail-closed in prod, idempotent by eventId, process-then-record), atomic refund claims, capture-after-cancel auto-refund, **COD-only launch gate** (`PAYMENTS_ONLINE_ENABLED=false` rejects non-COD server-side), COD collect idempotent with server-derived amount |
| Delivery | Dispatch plugin → order batching (zone + proximity), atomic batch claim (one rider per batch), 2-query rider candidate loading at any fleet size, assignment lifecycle endpoints, rider availability/zones, `rider:location` socket ingest (assignment-verified, bounds-checked, persist-throttled) with customer relay |
| Sellers | Shop profile, **open/close toggle**, sales summary, settlements (0% commission), 3-min auto-accept timeout safety net, missed-acceptance tracking |
| Promotions | Promo codes with caps/windows, redemptions, preview/checkout parity (test-pinned in tree) |
| Notifications | Event-driven FCM push (identity-resolved per order party), in-app notification rows, SMS templates (delivered/cancelled/refund/settlement; pre-DLT route), socket events throughout |
| Worker | BullMQ queues with uniform retry/backoff/retention policy, scheduler (settlements, reconciliation sweeps, payout reconcile, enrichment), structured pino logs, dead-man's-switch heartbeat |
| Recovery (in tree) | Seller Sprint 5 Phase A foundation: `RecoveryNeed`/`Lines`/`Offer`/`Event` tables, race-safe per-order numbering, state machine (open → searching → offered → accepted → ready → picked_up → fulfilled / exhausted / refunded / cancelled), immutable audit events, admin-gated internal routes. Explicitly foundation-only: no queues/timeouts/partner-selection/settlement yet |
| Admin API | Dispatch snapshot, metrics, coverage, moderation suite, alias management, category images (no UI; no order-ops endpoints) |

### 3.2 Backend — completed infrastructure & production improvements (hardening phases 1–7)

- **Correctness:** exactly-once cross-process event delivery; websocket-only transport (polling can't work behind PM2 cluster); notification identity fixes; IST-correct open/closed; refresh-rotation CAS; assignBatch CAS; BullMQ retry policy; typecheck restored and kept green.
- **Data safety:** nightly verified `pg_dump` → R2 + retention; restore workflow with integrity validation; mandatory pre-migration backup guard.
- **Deploy safety:** fail-fast production env validation (`env:check`; NODE_ENV required, placeholders hard-fail); compiled-`dist` runtime under PM2; CI-gated exact-SHA deploys; one-command rollback; slimmed non-root Docker image.
- **Security:** rider-location socket authz; verified-JWT rate-limit keys; nginx production-real limits + HSTS + webhook zone; Google Maps key out of git (env-injected; **rotation still pending** — it lives in history); seeds refuse production; founder-admin creation script; secret sweep clean otherwise.
- **Observability:** structured pino logs everywhere (JSON with correlation fields, E2E-pinned), Sentry API+worker, `/health` + `/ready`, worker heartbeat, logrotate policy, `RUNBOOK.md`.
- **Performance:** load-test suite + report — browse 1,179 RPS, checkout 1,073 RPS, ~100 COD orders/s at P95 136 ms, 300/300 sockets, ~100× launch headroom everywhere **except** a measured search scalability cliff (fix designed + validated, not yet landed).
- **Validation:** reproducible 26/26 E2E smoke suite against compiled artifacts (full COD lifecycle, payment/refund, forged webhook, retry exhaustion, SQL integrity invariants); signed `LAUNCH_VALIDATION.md`; final audit **88/100 GO-conditional**.

### 3.3 Customer app — completed milestones

- Blinkit-style catalog & home (rails, category sections, two-pane categories, Chirawa Special), product detail with variants/gallery, search (recent, suggest, filters, sort, **Hindi voice search**), cart capsule, single-page checkout with savings nudge and cancellation policy, celebration → tracking auto-advance.
- Address system v4: GPS map-pin + Mappls place search/reverse geocode, Chirawa geofence, receiver details, address cards, **address sharing/requesting via deep links + WhatsApp** (a genuine differentiator).
- Tracking V2: ETA hero with clock-skew-safe countdown, collapsible 5-phase timeline, socket + 15 s poll fallback, reconnect banner, refund card, OOS-at-pickup alert **with substitute suggestion**, rider card + call, COD amount card, change address/receiver pre-pickup, cancel with reasons, WhatsApp help with order ref.
- Night theme + closed banner (9 AM–8 PM), Hindi/English i18n, dark/light/system, notification deep links incl. cold start, profile/account-privacy screens.
- **In working tree (A1–A4, R-support):** active-orders strip on Home (restart-safe, multi-order); OTP resend with countdown + SMS autofill + auth error handling; discount line + promo parity in checkout bill; order-history pagination (server honors page/limit + client infinite scroll), ₹NaN money-line fix, unified last-6 order references, finished-order detail state, localized offline strings, tab renamed "Orders"; centralized real support number (`916350076685`).

### 3.4 Seller app — completed milestones (Sprints 0–4, committed)

Sprint 0 launch blockers (incl. **store open/close toggle** + profile/store status); Sprint 1 product images (camera/gallery, upload-on-pick, retry/cancel, primary-image replacement); Sprint 2 inventory search; Sprint 3 category sections (SectionList, collapse persistence, backend default-category invariant + backfill); Sprint 4 bulk stock selection (multi-select UI + `PATCH /catalog/products/bulk-stock` with parity tests). Plus earlier: order queue with alarm + cold-start deep link, barcode add, CSV import, settlements.

### 3.5 Rider app — completed milestones

Full delivery path (assignment alert with vibration, batch pickup-first flow, navigate/call, COD collect, delivered); Hinglish UI. **In working tree (R1):** foreground-service location publisher (`useRiderLocationPublisher`: watchPosition → authenticated socket emits, survives backgrounding for Google Maps navigation, stops on delivery/offline; `blockedPermissions` keeps background-location out of the manifest) and **assignment honesty** (fake accept/decline removed — the notification now truthfully says the order is assigned). Real-device validation checklist exists and is **unexecuted** (`docs/R1_RIDER_LOCATION_DEVICE_VALIDATION.md`).

---

## 4. Current State — completion estimates

Estimates are against the **v1 launch product** (single town, COD, founder-operated), not against Blinkit feature parity. "Code-complete" ≠ shipped: nothing on `eng/p0-hardening` is deployed.

| Area | Estimate | Reasoning |
|---|---|---|
| **Backend** | **~92%** | Every launch-scope module is built, hardened, and E2E-validated (26/26); final audit found no code-level blocker. Missing: admin order-ops endpoints (cancel/refund/user actions), search GIN index (validated, not landed), Redis-backed app rate limiter, explicit DB pool limit, dependency bumps, promo-cap CAS, DLT SMS route swap, recovery orchestrator phases (S5.1+ — new scope, foundation only). `analytics/` and `ledger/` module directories are empty placeholders. |
| **Customer app** | **~85%** | Core loop (browse → order → track → reorder) is competitive and polished; the July product audit's P0 trust list is now fixed in the working tree (support number, OTP resend, discount line, pagination/NaN, active-order strip, references). Missing for v1-complete: promo-code entry UI, product-ratings display, notification inbox, invoice/bill share, order-issue flow, analytics/crash reporting, force-update gate. Deliberately hidden (not counted as missing): loyalty/referral/wallet, online payment. |
| **Seller app** | **~75%** | Order + inventory + settlement flows are real and sprint-hardened; pause-store exists (Sprint 0). Missing: per-shop business hours, store profile editing (name/photo/contact), payout account setup UI, downloadable reports, rider visibility on ready orders, any in-app support entry. |
| **Rider app** | **~65%** | The delivery path works end-to-end and R1 (location + honesty) is code-complete in tree — but device-unvalidated, and it gates the customer-facing map. Earnings screen is a stub with a hardcoded salary figure; no COD cash ledger ("how much do I owe tonight?" — a daily COD flashpoint); no proof-of-delivery; no support entry. |
| **Admin** | **~15%** | Useful read/moderation JSON endpoints + recovery primitives, 403-guarded. But no UI at all, and no endpoints for the day-one ops verbs: cancel order, refund, ban user, create promo, send notification. Founder ops run on WhatsApp + DB console — workable to ~20–50 orders/day, then a hard ceiling. |
| **Overall product** | **~78%** | Weighted by surface size and launch criticality (backend and customer app dominate). Framed differently: **launch-scope code is ~95% done** (what remains to open the doors is operational, not engineering), while the **v1-complete backlog** (admin tooling, growth surface, rider/seller completeness) is ~60–70% done. |

---

## 5. Remaining Work

Grouped by priority. Items marked ⛔ also appear in §6 as launch blockers.

### Critical (before launch)

1. ⛔ **Push, review, and merge `eng/p0-hardening`** — 53 local-only commits + ~1,250 lines uncommitted. Includes committing the in-flight A1–A4/R1/Sprint-5A work as reviewable commits. A push to `main` auto-deploys; merge deliberately after server prep.
2. ⛔ **Operational launch gate** (`PRODUCTION_READINESS_CHECKLIST.md`): rotate the compromised Google Maps key + restrict replacement; real credentials on the server (Fast2SMS, R2, JWT, Firebase, Mappls, Razorpay-configured-but-off) with `env:check` green; one-time server migration (`DEPLOYMENT.md` §4); logrotate install; uptime monitors + Sentry alert rules; founder admin created.
3. ⛔ **Production sign-off** (`LAUNCH_VALIDATION.md` §5): real OTP on a real phone, real push on a real device, one real COD order end-to-end on production, worker heartbeat kill drill, backup restore drill.
4. ⛔ **R1 real-device validation** (`R1_RIDER_LOCATION_DEVICE_VALIDATION.md`): the customer map must not ship unless location survives the rider navigating in Google Maps on a physical Android device. If it fails: ship with the map removed (decision documented in the checklist).
5. ⛔ **Legal/compliance surface:** verify `chirawa.in/privacy|terms` resolve (Play Store review risk); delete-account path must reach a live support number (fixed in tree — verify end-to-end); Play Console foreground-service-location disclosure prepared for the rider app submission.

### High (week 1 – month 1)

6. Redis-back the app-tier rate limiter (M1 — currently 4× weaker than configured under PM2 ×4; ~5 lines).
7. Explicit `connection_limit`/`pool_timeout` in production `DATABASE_URL` (M3).
8. Dependency bumps: fastify / ws / fast-uri / form-data advisories (M5); re-run smoke.
9. **DLT registration** (multi-day lead time — start immediately): entity, `BRNGLY` header, four templates, then swap `sms.service.ts` to `route: 'dlt'`.
10. **Minimal admin dashboard** (the growth ceiling): dispatch board over existing endpoint + new order-cancel/refund/user endpoints + moderation UI. Web app; Chunk 9 of the production plan.
11. Promo-code entry UI in checkout (backend engine + i18n strings already exist) — required before any coupon-based marketing.
12. Analytics + crash reporting (Chunk 10: PostHog/Sentry in apps) + a force-update gate (no `expo-updates`/version check today — old builds live forever).
13. Rider COD cash ledger + real earnings source (remove hardcoded ₹7,500).
14. Seller per-shop business hours (open/close toggle exists; hours don't).
15. Finish A4-impl-2 remainder: reorder robustness (per-item tolerance + summary), Active/Past order sections, share-bill via OS sheet, reorder button on finished-order view.

### Medium (quarter)

16. Search GIN trigram index + operator-form rewrite (M2) — **hard deadline: before catalog reaches ~1–2k products** (validated fix: 158→18 ms).
17. `/catalog/categories` SQL-side counts + cache (P-2).
18. Promo redemption cap CAS (M4 — financial race under viral promos).
19. FCM dead-token eviction (L1); cache single-flight on shop/bestsellers (L2); idempotency-lock TTL extension (L4 — matters once online payments enable).
20. Product ratings displayed on PDP/listings (already collected); notification inbox screen; structured order-issue flow (missing/damaged item).
21. CI lint job (ESLint config currently unresolvable in `apps/api`) ; Fastify schema validation → OpenAPI on top routes.
22. Seller Sprint 5 continuation (S5.1+): recovery orchestrator — offer timeouts, partner selection, reservations, notifications, settlement integration (**spec: MISSING FROM SOURCE ARTIFACT** — see §Handoff → Known Constraints).
23. Localize remaining hardcoded Hindi strings; remove the `/api/v1/loyalty` stub route (L5).

### Low (backlog / post-launch)

24. Online payments GA: flip `PAYMENTS_ONLINE_ENABLED` + `FEATURES.onlinePayments`, RazorpayX payout activation, ₹1 live-order test; pair with PDF/GST invoices + refund center.
25. Growth loops: referral UI + unlock worker rebuild (scaffolding was deliberately removed; rebuild path documented in `features.ts`), loyalty UI, wallet.
26. Wishlist, recently-viewed, product reviews (text), tips, delivery instructions, scheduled slots, proof-of-delivery photo, seller self-serve promotions.
27. Schema hygiene: `Order.riderId`/`Batch.riderId` FK relations, `timestamptz` migration (L7); PostGIS index script → migration (P2-15); dead `notification` queue decision (L8); `OrderTrackingScreen` refactor (1,800 lines, two always-on intervals — battery debt).
28. Multi-town model, universal links (`bringly.in` hosting), web storefront, own-store (dark-store) phase, Mappls RN SDK migration decision.

---

## 6. Production Blockers

Everything preventing launch **today**, and why:

| # | Blocker | Why it blocks launch |
|---|---|---|
| B1 | **The launch-ready code is unmerged and undeployed** (53 local commits + uncommitted tree; `origin/main` = pre-hardening `68bede5`) | Production would run the *pre-hardening* code: 4× duplicate notifications, no backups pipeline on server, no rollback, broken cluster transport. Also a single-laptop disaster risk: one disk failure loses the entire hardening + sprint era. |
| B2 | **Compromised Google Maps key not rotated** (in git history forever; CR-1/S1) | Anyone can extract it from history and bill the account. Code-side fix (env injection) is done; the console rotation is not. |
| B3 | **Placeholder credentials on the server** (Fast2SMS, R2, JWT, FCM, Mappls; CR-2) | The deploy pipeline *by design* refuses to boot production with placeholders (`env:check` hard-fails). OTP login — the front door — cannot work without real Fast2SMS credit. |
| B4 | **One-time server migration + monitors not done** (DEPLOYMENT §4; RUNBOOK §2) | The new PM2/dist/nginx/logrotate topology must be installed once by hand; without monitors + Sentry rules, the team is blind on day one — the final audit withheld points specifically for this. |
| B5 | **Production sign-off gate never run** (CR-3; LAUNCH_VALIDATION §5) | The 26/26 E2E ran on a dev host. Real SMS delivery, real push to physical devices, TLS at `api.chirawa.in`, PM2-cluster behavior, and a real COD order have never been proven in the production environment. |
| B6 | **R1 device validation unexecuted** | The customer tracking map's producer only proves itself on a physical Android device (foreground service through Google Maps navigation). Shipping the map without this risks the product audit's "broken promise" verdict — every customer watching a permanently rider-less map. |
| B7 | **Legal pages unverified; store compliance** | `chirawa.in/privacy|terms` 404s are a Play review rejection risk; delete-account must work (now points at the real number in tree — must be verified live); rider app needs the foreground-service-location disclosure at submission. |
| B8 | *(Conditional)* **No admin ops verbs** | Not a hard blocker for a founder-operated soft launch (~20 orders/day, DB console fallback) — but it blocks *scaling* the launch: no tool exists to cancel/refund an order or manage a user when volume rises. Listed here because the founder should launch knowing this ceiling exists. |

---

## 7. Recommended Roadmap

Continue from the existing product — no redesigns. Order chosen so each milestone de-risks the next:

- **M0 — Preserve & merge (immediate, days).** Commit the in-flight work as clean reviewable commits (A1, A2, A3, A4-impl, R1, Sprint 5A are separable); **push `eng/p0-hardening` to origin today** (pushing the branch does not trigger deploy — only `main` does); PR → CI green → hold the merge until M2's server prep is ready (merge = auto-deploy).
- **M1 — R1 device validation (parallel, founder + one physical Android).** Run the checklist; decide map-on or map-off for launch. Either outcome unblocks B6.
- **M2 — Launch operational gate (founder + engineer, ~days of console work).** Work `PRODUCTION_READINESS_CHECKLIST.md` top to bottom (credentials, key rotation, webhook config, server migration, logrotate, monitors, founder admin). Start **DLT registration** now (multi-day external lead time). Then merge M0 → deploy fires → run `LAUNCH_VALIDATION.md` §5 production sign-off. **→ SOFT LAUNCH (COD, one town, no marketing push).**
- **M3 — Week-1 fast-follows (small, scheduled, from the final audit).** Redis rate limiter (M1), DB pool param (M3), dependency bumps (M5), re-run smoke on production.
- **M4 — Operate & grow (first month).** Minimal admin dashboard (dispatch board + order cancel/refund + user + moderation) — this is the growth unlock; promo-code entry UI; analytics + crash reporting + force-update gate; rider COD ledger + real earnings; seller business hours; A4-impl-2 remainder; notification inbox; ratings display. **Do not scale marketing before this milestone lands** (the product audit's explicit warning).
- **M5 — Scale protections (before catalog/volume growth).** Search GIN index + rewrite (hard gate: ~1–2k products), categories counts, promo CAS, cache single-flight, FCM eviction, CI lint.
- **M6 — Seller Sprint 5 continuation.** Recovery orchestrator phases (S5.1+) on the Phase A foundation — requires obtaining the Architecture spec (see Missing Artifacts).
- **M7 — Online payments GA + money surface.** Flip the double flag, RazorpayX activation, ₹1 live test; invoices/GST + refund center ship together. Then growth loops (referral worker rebuild, loyalty UI, wallet).

---

## 8. Risks

### Technical
- **Unmerged/unpushed work (B1)** — highest-probability, highest-impact loss scenario until M0 completes.
- **Search cliff (M2):** measured collapse 347→8 RPS as catalog grows; fix validated but unlanded. Deadline-driven, not launch-driven.
- **Single-VPS SPOF:** PG, Redis, API, worker on one Hetzner box. Accepted for launch scale (backups + restore drill mitigate); revisit at growth.
- **WebSocket-only realtime:** correct behind PM2, but networks that block WS fall back to 15 s polling for tracking (acceptable, known).
- **Runtime dependency CVEs** (fastify/ws/fast-uri/form-data) until M3 bumps land.
- **Promo over-redemption race (M4)** — financial exposure only when marketing promos start; fix before flyer campaigns.
- **Foreground-service location on low-end Android fleet:** battery/doze behavior unproven until R1 validation; Play policy surface (disclosure form) at submission.
- **In-flight migration discipline:** `20260707000000_seller_sprint5_phaseA_recovery` is additive-only (verified) — keep the pre-migration backup guard in the path.

### Business
- **Revenue = delivery fees only** at 0% commission; unit economics depend on density + later Chirawa-Special commission and own-store phase. *(Financial plan: MISSING FROM SOURCE ARTIFACT.)*
- **COD cash handling:** salaried riders carrying cash with no in-app ledger — shrinkage/dispute risk until M4's COD ledger.
- **Brand split:** app says Bringly, domains/legal say chirawa.in, deep links say bringly.in — user-visible trust wobble and a store-listing consistency risk. Needs a one-time decision.
- **Marketing before tooling:** printing coupon codes before the promo UI + admin dashboard exist would burn the one first-impression the town gives.
- **Seller/rider adoption:** seller app has no support channel; rider incentives/earnings are opaque — churn risk in the exact workforce the model depends on.

### Operational
- **Founder-operated everything:** support (WhatsApp), dispatch exceptions, refunds (DB console) — workable to ~20–50 orders/day, then the admin-tooling ceiling (B8) hits.
- **No analytics/crash reporting at launch:** flying blind on funnels and app crashes until M4 (final audit accepted this for soft launch; it is still a risk).
- **SMS deliverability:** pre-DLT transactional route is increasingly operator-filtered; OTP rides Fast2SMS's approved template (fine), but order SMSes may silently degrade until DLT (M2 start, M3/M4 land).
- **Manual nginx step:** config is copied to the server by hand (`nginx -t && reload`) — drift risk; documented but human-dependent.
- **Restore-drill discipline:** backups are only as real as the last drill (monthly cadence in the checklist; calendar it).
- **Key/credential hygiene:** one key already burned into git history; the checklist's rotation habit must become routine.

---

## 9. Launch Checklist

### Engineering
- [ ] In-flight work committed as reviewable commits (A1/A2/A3/A4-impl/R1/Sprint-5A separable)
- [ ] `eng/p0-hardening` pushed to origin (same day — B1)
- [ ] PR to `main`: CI green (tests + typecheck + image build)
- [ ] `pnpm typecheck` and full test suite green at the merge SHA (baseline: 525/525)
- [ ] Smoke suite 26/26 at the merge SHA (`node scripts/smoke/run.mjs`)
- [ ] R1 device validation executed; map ship/no-ship decision recorded
- [ ] Merge performed deliberately (auto-deploy acknowledged), server prepped first

### QA
- [ ] Real OTP received on a real phone (Fast2SMS production path)
- [ ] Real FCM push on physical devices — all three apps, order-lifecycle events
- [ ] One real COD order end-to-end on production: place → seller accept → prepare → ready → assign → pickup → deliver → COD collect; verified in `/admin/dispatch` + logs
- [ ] Non-COD order attempt rejected (`BUSINESS_RULE_VIOLATION`); "Pay Online" shows coming-soon and cannot be selected
- [ ] Checkout bill shows discount line; totals sum exactly (A3)
- [ ] Order history paginates past 20; money lines render (no ₹NaN) (A4)
- [ ] OTP resend + countdown works; wrong-number recovery works (A2)
- [ ] Active-order strip appears on Home after app restart mid-order (A1)
- [ ] Support links from Profile / Account & Privacy / Tracking all open WhatsApp to `916350076685`
- [ ] Hindi and English sweep of every new screen; dark + night themes render
- [ ] Delete-account request path works end-to-end (Play compliance)

### Operations
- [ ] `PRODUCTION_READINESS_CHECKLIST.md` boxes all closed (Razorpay §1–2, RazorpayX §3, Fast2SMS §4, DLT started §5, Firebase §6, Mappls + key rotation §7, secrets §8, placeholders §9, seed guard §10, founder admin §11, env separation §12)
- [ ] Logrotate installed; `/var/log/chirawa` rotating
- [ ] Backup job on server; **restore drill executed this month**
- [ ] Worker heartbeat monitor live; kill-the-worker drill fires an alert
- [ ] `RUNBOOK.md` reviewed by whoever holds the pager (founder)
- [ ] Rider fleet devices: dev-client/preview builds installed; location permission granted "while using"
- [ ] COD float/cash-handling process agreed with riders (manual until M4 ledger)

### Business
- [ ] `chirawa.in/privacy` + `/terms` resolve; brand decision (Bringly vs chirawa) recorded
- [ ] Sellers onboarded: real catalog, prices, images; payout UPI IDs on profiles
- [ ] Rider salaries/shifts confirmed; support number staffed 9–20 IST
- [ ] Refund/cancellation policy text final (shown pre-order)
- [ ] Play Console: listings, data-safety forms, foreground-service-location disclosure (rider app)
- [ ] No coupon marketing until promo UI + admin dashboard exist (M4)

### Deployment
- [ ] One-time server migration done (DEPLOYMENT §4: PM2 dist config, pnpm pin, env, nginx)
- [ ] `NODE_ENV=production pnpm --filter @chirawa/api env:check` → zero ❌ on the server
- [ ] Deploy workflow green end-to-end; exact SHA verified in deploy history
- [ ] `curl https://api.chirawa.in/health` + `/ready` 200 from outside
- [ ] Rollback drill: `scripts/rollback.sh` exercised once against the previous release
- [ ] Nginx config copied, `nginx -t` clean, reloaded; webhook zone active

### Monitoring
- [ ] Uptime monitors: `/health`, `/ready`, worker heartbeat (three monitors, RUNBOOK §2)
- [ ] Sentry DSNs set for API + worker; the two alert rules created
- [ ] Log shape verified on server: JSON lines with `svc`/`reqId`/`jobName`
- [ ] First-night watch: dispatch snapshot, queue depths, Redis memory, PG connections
- [ ] Daily ops calendar armed (RUNBOOK): settlement check, backup verification, disk space

---

## 10. Engineering Principles

The non-negotiables all future milestones must follow — distilled from the ADRs, seven hardening phases, and the standards visible in every commit:

1. **Correctness over cleverness; money is sacred.** All money in integer paise (ADR-002). Every money/state mutation is an atomic claim (CAS `updateMany`) before any external call, with revert-on-failure. Server derives amounts; client values are never trusted.
2. **One enforcement point per invariant.** Order status changes go through the state machine (`order-status.ts`); operating hours through `operating-hours.ts`; env through the schema. New rules join the existing point — never a second copy.
3. **Fail closed in production.** Webhooks with placeholder secrets reject; placeholder credentials refuse to boot; seeds refuse production; dev bypasses are compiled out. A new feature that degrades must degrade *loudly* (boot warning) and safely.
4. **Exactly-once where it matters, idempotent everywhere.** Cross-process events are claimed via Redis `SET NX`; checkout, webhooks, COD collect, payouts are idempotent and safely retryable.
5. **Additive, guarded migrations.** Schema changes are additive with explicit backfill steps; the pre-migration backup guard stays in the deploy path; destructive changes need a documented rollback.
6. **Evidence, not assertion.** Behavior claims are pinned by tests (525 unit), the smoke suite (26 E2E), or a committed evidence file. "Done" for device-dependent features means the device checklist passed (R1 rule). Audits re-verify, never trust.
7. **The deploy is the tested SHA.** CI gates every deploy; production runs compiled `dist/`; rollback is one command; `main` auto-deploys, so merges are deliberate acts.
8. **Ship honestly.** Never present a capability the system doesn't have (no fake decline buttons, no dead "coming soon" traps on critical paths, no bill lines that don't sum). Hiding an unfunded feature (`FEATURES.*=false`) is correct; simulating one is not.
9. **Hindi + English always.** Every user-facing string enters `packages/i18n` with both languages; Hinglish for the rider/seller voice where established. No hardcoded display strings.
10. **Small-town pragmatism.** Single VPS, WhatsApp support, COD-first are deliberate choices — optimize for the 3 km radius that exists, not the platform that might. No feature creep; no redesign of approved work; scale work is deadline-triggered (e.g., search index before ~1–2k products).
11. **Observability is part of the feature.** Structured pino logs with correlation fields, Sentry capture, heartbeats. `console.log` does not ship.
12. **Auditability.** Conventional Commits, one concern per commit, full problem/solution/risk narratives in commit messages; decisions land in `docs/adr/`; every milestone updates the docs that operators depend on. Never stage `.env` files.
13. **No guessing.** Anything not derivable from the repo or the provided artifact is marked **MISSING FROM SOURCE ARTIFACT** and resolved with the founder — never invented.

---
---

# PROJECT BASELINE HANDOFF PACKAGE

*Permanent context for every future Reviewer/Builder session. Assume the reader has nothing else.*

## Project Summary

**Bringly** (repo name `chirawa`, monorepo at `~/Batman/chirawa`, GitHub `Whatever-Piyush/chirawa`) is a production-grade hyperlocal quick-commerce platform for the single town of **Chirawa, Rajasthan** (~80k people, ~3 km radius, center 28.2388 / 75.4247). One Fastify backend + three Expo apps (Customer, Seller, Rider) + an admin JSON API (no UI). ~44,600 lines of TypeScript. Goal: production launch, COD-only, founder-operated. The codebase passed a final production audit at **88/100 — GO, conditional on the operational launch gate**.

## Business Model

- **Marketplace-first:** local shops (kiranas, grocery, beauty, "Chirawa Special" sweet shops) list products; Bringly's **salaried riders** deliver. Own-inventory ("own store" / dark-store) is a later phase. v1 presents everything as **one unified storefront** (`FEATURES.shopBrowsing=false`).
- **Revenue at launch:** delivery fees only. **0% seller commission** (per-category commission field planned for later manual introduction; Chirawa Special commission after 1–2 months).
- **Fees (integer paise, `pricing.service.ts`):** cart < ₹100 → ₹25 fee; otherwise ₹10 standard / ₹15 if the cart contains a Chirawa Special (featured) shop. **FIRSTORDER** promo auto-applies free delivery on a customer's first order.
- **Payments:** COD-only at launch. Razorpay (UPI) fully wired but double-gated: server `PAYMENTS_ONLINE_ENABLED=false` + app `FEATURES.onlinePayments=false`. Both must flip together to launch online payments.
- **Hours:** 9:00–20:00 IST (`OPERATING_HOURS`, env-overridable). Browsing allowed when closed; checkout blocked; night-theme UI.
- **Support:** WhatsApp to `916350076685` (centralized in `apps/customer-app/src/config/support.ts`). Founder-operated.
- **Languages:** Hindi + English everywhere (`packages/i18n`); Hinglish tone in rider/seller apps.
- **Growth features** (referral/loyalty/wallet): built server-side, deliberately hidden (`FEATURES.growthLoops=false`); referral unlock worker was removed — rebuild required before relaunch (path documented in `features.ts`).

## Current Progress

- **Branch state (the critical fact):** `main`@`68bede5` = `origin/main` (pre-hardening). **`eng/p0-hardening` holds 53 unpushed commits** (all hardening phases + Seller Sprints 0–4) **plus an uncommitted working tree** (~36 modified files, 13 new paths, +1,256/−330) containing milestones A1–A4, R1, and Seller Sprint 5 Phase A. Nothing hardened is deployed anywhere.
- **Working-tree health (verified 2026-07-07):** typecheck green all workspaces; **525/525 API unit tests** (64 files); 26/26 E2E smoke previously validated at `d829c4f`+; Docker PG+Redis healthy.
- **Completion estimates:** Backend ~92% · Customer ~85% · Seller ~75% · Rider ~65% · Admin ~15% · **Overall ~78%** (launch-scope code ~95%; v1-complete backlog ~60–70%). Reasoning in Baseline §4.

## Existing Milestones

**Committed eras:** Feature chunks 0–8 (foundation, images/PDP, GPS addresses, Razorpay, search filters/ratings, dispatch/batching, live-map plumbing, promotions, seller portal) → customer product polish (Blinkit-style catalog, address v4 + sharing, voice search, night theme, tracking V2, ETA) → **Hardening Phases 1–7** (P0/P1 closure, Data Safety, Deploy Safety, runtime bugs, ops/observability, infra/config, perf validation, 26/26 launch validation, final audit 88/100) → **Seller Sprints 0–4** (pause-store + launch blockers, product images, inventory search, category sections, bulk stock).
**In-flight (uncommitted):** **A1** active-order strip · **A2** login/OTP resend + profile hydration · **A3** pricing/discount transparency · **A4-impl** post-order trust fixes (pagination, ₹NaN, last-6 refs, finished-order state, "Orders" tab, localized strings) · **R1** rider location publisher + assignment honesty (device validation pending) · **Seller Sprint 5 Phase A** recovery-engine foundation (4 tables + state machine + admin routes; orchestrator = later phases).
**Not started:** admin dashboard UI (Chunk 9), analytics/crash reporting (Chunk 10), DLT swap, online-payments GA, growth loops.

## Known Constraints

- Single town only; no multi-city logic. Single Hetzner CX32 VPS (PM2 api ×4 + worker ×1, nginx, local PG/Redis). Push to `main` auto-deploys — merges are deliberate.
- COD-only until the founder flips both payment flags; RazorpayX payouts self-disable until configured (settlements accrue as `pending`).
- Transactional SMS rides the pre-DLT route (OTP is fine); DLT registration is a multi-day external dependency.
- Maps: Mappls for all API calls; one Google key only for Android map tiles, env-injected at EAS build time (`GOOGLE_MAPS_ANDROID_API_KEY`); the old committed key is compromised and awaits console rotation.
- Apps are EAS dev-client builds (native modules) — Expo Go cannot run them; rider location requires a physical device to validate.
- Team rules (`.claude-rules`): Conventional Commits after every fix; never modify/stage `.env` files.
- **MISSING FROM SOURCE ARTIFACT:** ① the Seller Sprint 5 "Architecture" specification (recovery code cites "Architecture §10–§12, §17, §21" — the document is not in the repo; only Phase A code + comments define the domain so far); ② the original Seller Sprint 0–4 spec (only commit messages record scope); ③ A1/A2/A3 milestone specs (work exists in tree; specs referenced by `A4_POST_ORDER_AUDIT` but not committed); ④ business financials (rider payroll, funding, revenue targets — the ₹7,500 salary in the rider app is a hardcoded placeholder); ⑤ launch date / go-live target; ⑥ actual production-server state (whether any deploy/server-migration has ever run — not derivable from the repo). Obtain from the founder before work that depends on them.

## Architecture Summary

- **Monorepo (pnpm ≥9, Node ≥20):** `apps/api` (Fastify 4.27, Prisma 5.13/PostgreSQL 15+PostGIS, ioredis, BullMQ 5.7, Socket.io 4.7 websocket-only + Redis adapter, Zod, pino 9), `apps/{customer,seller,rider}-app` (Expo SDK 54, RN 0.81.5), `packages/{api-client,types,i18n}`.
- **Modular monolith** (ADR-001): 15 live modules — auth, users, catalog, cart, pricing, orders, payments, delivery, sellers, promotions, notifications, geo, loyalty(stub route), admin, recovery; `analytics/` + `ledger/` are empty placeholders. One worker process (BullMQ queues, scheduler, heartbeat).
- **Data:** 49 Prisma models, 13 enums, 31 migrations. Money integer paise (ADR-002). Order snapshots (names/addresses) preserved on order rows.
- **Order state machine:** `pending_payment → confirmed → preparing → ready_for_pickup → picked_up → out_for_delivery → delivered`, with `cancelled` branch; single CAS enforcement point + `OrderStatusHistory`. Multi-shop carts split into per-shop orders under an `OrderGroup`; batching groups nearby orders to one rider. Seller auto-accept after 3-min timeout.
- **Recovery state machine (Sprint 5A, in tree):** `open → searching → offered → accepted → ready → picked_up → fulfilled | exhausted | refunded | cancelled`, immutable `RecoveryEvent` audit trail, race-safe per-parent-order numbering.
- **Eventing:** Redis pub/sub event bus with per-event `SET NX` exactly-once claims across the PM2 cluster; listeners drive FCM, sockets, dispatch.
- **Auth:** OTP (Fast2SMS) → RS256 JWT access + rotating refresh (atomic claim, family revocation on reuse); PINs (bcrypt-12 + lockout) for seller/rider; roles customer/seller/rider/admin; socket rooms IDOR-guarded fail-closed; admin routes 403-verified.
- **API surface:** `/api/v1/{auth,users,catalog,search,cart,pricing,orders,payments,delivery,admin,loyalty,notifications,sellers,geo,recovery}` + `/health`, `/ready`.
- **Deploy/ops:** GitHub Actions CI (PG+Redis services) gates exact-SHA deploys to Hetzner via `server-release.sh` (env:check → guarded migrate → reload → health gate); one-command rollback; nightly verified pg_dump→R2; logrotate; RUNBOOK/DEPLOYMENT/DISASTER_RECOVERY/ROLLBACK_DRILL docs; Sentry + heartbeat + uptime monitors (to be wired on server).

## Completed Systems

Backend: auth, catalog+search+moderation+master-catalog, cart, pricing+promotions (engine), orders (full lifecycle incl. unavailability/refund/receiver-change/ETA/pagination), payments (Razorpay wired, COD-gated, atomic refunds, fail-closed webhooks), delivery (dispatch/batching/assignment/location ingest), sellers (shop, open-toggle, settlements), notifications (FCM/SMS/socket/in-app rows), worker (settlement, reconciliation, payout reconcile, enrichment, auto-accept), recovery foundation, admin read/moderation API. Infrastructure: backups+restore, CI-gated deploy+rollback, env validation, structured logging, Sentry, heartbeat, load-test + smoke suites. Apps: customer core loop + A1–A4 fixes (in tree); seller order/inventory/settlement + Sprints 0–4; rider delivery path + R1 (in tree). Full detail: Baseline §3.

## Remaining Systems

Admin dashboard UI + order-ops endpoints (cancel/refund/user/promo/notification) — the biggest missing system; analytics & crash reporting + force-update; promo-code entry UI; DLT SMS swap; search GIN index; Redis-backed limiter + DB pool param + dep bumps; rider COD ledger + real earnings + POD; seller business hours + store profile + payout-details UI + reports; notification inbox; ratings display; invoices/refund center (with online payments); recovery orchestrator (S5.1+); growth loops rebuild; wishlist/reviews/tips/instructions/slots; multi-town/web/own-store (future). Full prioritized list: Baseline §5.

## Launch Priorities

1. **M0** Commit + push + PR `eng/p0-hardening` (removes the single-laptop risk the same day).
2. **M1** R1 physical-device validation → map ship/no-ship decision.
3. **M2** Operational gate (`PRODUCTION_READINESS_CHECKLIST.md`) + DLT registration start + deliberate merge/deploy + production sign-off (`LAUNCH_VALIDATION.md` §5) → **soft launch, COD, no marketing**.
4. **M3** Week-1 fast-follows: Redis limiter, pool param, dependency bumps.
5. **M4** Operate & grow: admin mini-dashboard, promo UI, analytics/force-update, rider COD ledger, seller hours — **gate for any marketing push**.
6. **M5** Scale protections: search GIN (before ~1–2k products), categories counts, promo CAS.
7. **M6** Seller Sprint 5 orchestrator (needs the missing Architecture spec). **M7** Online payments GA + invoices/refund center, then growth loops.

## Engineering Rules

(Baseline §10 in full; the short form:) integer paise + server-derived money; one CAS enforcement point per invariant; fail closed in production; idempotent/exactly-once side effects; additive guarded migrations; evidence over assertion (tests/smoke/device checklists); deploy = the tested SHA, merges to `main` are deliberate (auto-deploy); ship honestly (no fake affordances); Hindi+English every string; small-town pragmatism, no feature creep, no redesign of approved work; structured logs only; Conventional Commits + ADRs + docs; never touch `.env`; mark gaps **MISSING FROM SOURCE ARTIFACT** — never invent.

## Known Risks

Top: (1) 53 unpushed commits + uncommitted tree on one machine; (2) unrotated compromised Maps key; (3) launch gate/sign-off never run against production; (4) rider-location unproven on device (customer map's credibility rides on it); (5) search scalability cliff with a validated but unlanded fix; (6) no admin ops tooling → hard ceiling at tens of orders/day; (7) no analytics/crash reporting at launch; (8) pre-DLT SMS filtering; (9) promo cap race once marketing starts; (10) COD cash handling without a rider ledger; (11) single-VPS SPOF (mitigated by backups/restore drill); (12) brand split Bringly vs chirawa.in. Full register: Baseline §8.

---
*End of baseline. Future sprints must cite this document as `docs/PROJECT_BASELINE.md` and update it when milestones land.*
