# Inventory Engine — Implementation Report (for independent verification)

> **Date:** 2026-07-07 · **Branch:** `customer-app-validation` · **Author:** Claude (Fable 5)
> **Purpose:** Complete, verifiable record of the Inventory Engine build so a second reviewer (human or AI) can audit that every claim below is true in the code. Every section ends with **How to verify** steps.
> **Source design:** `inventory_engine.md` (repo root) — implemented **with amendments** (§2). The prior source-level audit `docs/md file/INVENTORY_ENGINE_ANALYSIS.md` (2026-06-29) documents the pre-existing state this work replaces.
> **Environment caveat:** Postgres + Redis were DOWN during this build. All verification is unit-test + typecheck level; the migration SQL is hand-written (Prisma format) and has **not** been applied to a live DB. See §9 for the cutover runbook.
> **Not mine:** the working-tree deletions of `Voice_Search.md` and `apps/web/src/lib/query.ts` predate this session — do not attribute them to this change set.

---

## 1. What this change is

Replaces the old opt-in `products.stockQty` decrement-at-placement model with a **belief-layer inventory engine**:

- **Belief state** per product (`inventory_state`): `expectedQty` (nullable = binary/untracked), `reservedQty` counter, `velocityClass` (nullable = no decay), `confidenceBase`, verification stamps.
- **Reserve at placement → commit at rider pickup → release on cancel/expiry** (reservations table + single-statement CAS).
- **Append-only event log** (`inventory_events`) written by a single-writer module.
- **Read-time decay**: `effectiveQty = max(0, expected − reserved − ⌈k·vel·hours/24⌉)`, `confidence = base·e^(−hours/τ)`. No cron ever mutates belief with guesses.
- **Gates**: one threshold (`θ_hide`) governs BOTH feed visibility and resolver routability; `θ_flag` drives seller accept-screen chips; auto-accept marks unverified lines for rider verification.
- **Sensors**: seller accept chips (`lineOverrides`), shelf-verify endpoint, morning card, rider-miss fold-in.
- **Ops**: 60s expiry sweeper, nightly invariant reconciler, admin health endpoint.

### Pre-existing bugs this fixes (verified before the change)
- **A-1 (stock leak):** the ONLY `stockQty` mutation in the old codebase was the placement decrement (`orders.service.ts` old `decrementStockOrThrow`); no cancel/reject/refund path ever re-incremented. Every cancelled tracked-stock order leaked permanently.
- **A-2 (stranded pending_payment):** no job expired stale `pending_payment` orders; `runPaymentReconciliation` only promotes captures. Abandoned checkouts held their stock decrement forever.

**How to verify §1:** `git show HEAD:apps/api/src/modules/orders/orders.service.ts | grep -n "decrement"` shows the old model; `grep -rn "decrementStockOrThrow" apps/api/src` now returns nothing.

---

## 2. Deliberate amendments vs `inventory_engine.md` (do NOT flag as missed items)

| # | EDD said | Implemented instead | Why |
|---|---|---|---|
| 1 | Move `stockStatus` to `inventory_state` (§2.3) | `products.stockStatus` **stays** and is a *projection* the single writer maintains | ~15 read paths (catalog/feed/resolver/cart/apps) key off it; moving = huge blast radius, zero semantic gain |
| 2 | `velocityClass Int @default(2)` | `velocityClass Int?` — **NULL for binary items, no decay for them** | EDD default would decay the entire binary tail (~80% of catalog) into auto-hide within ~2 days. Binary items keep pre-engine semantics exactly |
| 3 | 4 confidence bands incl. DOUBTED (visible-but-unroutable) | 3 bands; `θ_hide == θ_route` — one predicate for visibility AND routing | "Visible but unroutable" manufactures the exact lie the engine exists to prevent in a unified store |
| 4 | Resolver = scored greedy w1–w5 (§7.2) | Kept existing price-floor greedy + **hard** viability gates (effectiveQty ≥ qty ∧ conf ≥ θ) + `MAX_SHOPS` cap + trace | The w1–w5 score silently drops the price-floor guarantee (customer never pays above displayed price); untunable at 5 sellers |
| 5 | Re-split residual into sibling child order (§5.2) | Partial + refund only; all-lines-zero → seller directed to Reject | Payments are per-child-order rows; post-payment re-splits are an unsolved accounting problem |
| 6 | "Extend release into every cancel path, tested" (F8) | Commit/release hooks **inside `transitionOrderStatus`** | Per-call-site discipline is what caused A-1; every cancel already flows through that one function |
| 7 | Per-line rider pickup body (Appendix A) | **Rider app untouched.** Single pickup tap commits all still-`fulfilled` lines; the existing per-line `items/:itemId/unavailable` endpoint covers misses pre-pickup | Zero rider UI change needed for MVP |
| 8 | New Redis key `inv:avail:*` (§8) | None. Existing feed/shop caches (TTL 90–630s) carry availability; resolver/cart read belief live from PG | EDD's own §13.5 defers this to ~1000 orders/day |
| 9 | Migrate `stock_update_log` rows as `legacy` events; dual-write `stockQty` | No data migration (pre-launch, all seeded). `stockQty` mirrored by the single writer until dropped; `StockUpdateLog` now written ONLY for `hidden` toggles | Dual-write ceremony solves a live-traffic problem this repo doesn't have |
| 10 | `shops.reliabilityScore`, `avgRiderWaitMin`, EWMA velocity, fairness | **Not added** (per EDD §13.2-13.3 these are ~100 orders/day items; columns that do nothing drift) | — |
| 11 | `stock_adjustments` table | Never built (EDD itself rejects it) | One append-only log |

---

## 3. New files (all created this session)

| File | Purpose |
|---|---|
| `apps/api/prisma/migrations/20260707090000_inventory_engine/migration.sql` | 3 tables + 2 columns + indexes + FK (hand-written, Prisma SQL format) |
| `apps/api/prisma/backfill-inventory.ts` | Idempotent one-shot: `inventory_state` row per product (tracked ← `stockQty`, else binary) + `backfill` event. Script: `db:backfill:inventory` |
| `apps/api/src/modules/inventory/belief.ts` | Pure math: `effectiveQty`, `confidence`, `beliefBand` (normal/flagged/hidden), `projectStockStatus`, `DEFAULT_INVENTORY_CONFIG` |
| `apps/api/src/modules/inventory/inventory.config.ts` | AppConfig-backed `inv.*` keys, per-key fallback to defaults, 60s in-process cache, never throws |
| `apps/api/src/modules/inventory/apply-event.ts` | `applyInventoryEvent()` — THE single writer: state upsert per event-effect table + `products.stockStatus` projection + legacy `products.stockQty` mirror + append event (`createMany skipDuplicates` = replay-safe). Also `ensureInventoryState()` |
| `apps/api/src/modules/inventory/reservations.service.ts` | CAS reserve (`casIncrementReserved` — single UPDATE, tracked arithmetic OR binary status guard), `reserveOrderLines` (productId-sorted, throws `ReservationConflictError(productId)`), `commitReservationsForOrder` (claim held+fulfilled → expected/reserved decrement floored at 0 + `anomaly_negative_floor` + conf `min(base+0.05,0.95)` + verification stamp `rider_pickup` + mirror + reprojection), `releaseReservationsForOrder` / `releaseReservationForOrderItem` / `shrinkReservationForOrderItem`, `sweepExpiredReservations` (own tx per row, held-claim guard), `reclaimExpiredReservations` (expired→held + CAS; failure flags item `accept_verify_requested`) |
| `apps/api/src/modules/inventory/reconcile.service.ts` | Nightly invariants: I1 missing state rows → create; I2 `reservedQty == Σ held` → recount + `reconcile_fix` event; I3 held reservations on delivered/cancelled orders → replay commit/release; I4 negative expected → count only (impossible by construction) |
| `apps/api/src/modules/inventory/morning-card.service.ts` | `getMorningCard`: tracked items only, `priority = orders7d × (1−conf) × ₹value`, zero-demand excluded, top `inv.morning_card_n` |
| `apps/api/src/modules/inventory/health.service.ts` | `getInventoryHealth`: 7d miss rate, auto-accept canary, live belief-band histogram, reservation counts, live I2 drift count |
| `apps/api/src/worker/jobs/morning-card.job.ts` | 9:00 IST FCM push per shop with ≥1 card item (card itself is computed at GET time — nothing persisted) |
| `apps/api/src/modules/inventory/__tests__/belief.test.ts` (16 tests) | Golden values incl. EDD §4.2 worked example (0.95·e^(−9/8) ≈ 0.308) |
| `apps/api/src/modules/inventory/__tests__/inventory.config.test.ts` (3) | Defaults / per-key override / clamp maxShops to [1,3] |
| `apps/api/src/modules/inventory/__tests__/apply-event.test.ts` (10) | Every event type's state+projection+snapshot; hidden never touched; replay = `applied:false` |
| `apps/api/src/modules/inventory/__tests__/reservations.service.test.ts` (15) | CAS win/lose, sort order, conflict productId, commit+anomaly, release revive, sweeper claim-loss, reclaim flag |
| `apps/api/src/modules/inventory/__tests__/morning-card.test.ts` (3) | Ranking, zero-demand exclusion, fresh-verify drop-off |
| `apps/api/src/modules/orders/__tests__/orders.accept-overrides.test.ts` (6) | Chips: implicit confirm, है, सिर्फ n (money+qty+belief+reservation), नहीं, all-zero rejection, COD |
| `apps/seller-app/src/screens/stock/MorningCardScreen.tsx` | है/कम/नहीं per row → `verifyShelf` → row removed |

Deleted: `apps/api/src/modules/orders/__tests__/orders.stock.test.ts` (tested the removed decrement helper).

**How to verify §3:** `ls apps/api/src/modules/inventory` and `ls apps/api/src/modules/inventory/__tests__` match the table; `git status --porcelain` shows the `??` entries above.

---

## 4. Modified files — exact behavior changes

### Schema — `apps/api/prisma/schema.prisma`
- `model InventoryState` (PK `productId`, 1:1 Product w/ cascade), `model InventoryEvent` (`@@unique([orderItemId, eventType])` = idempotency; 3 indexes), `model Reservation` (`orderItemId @unique`; `[productId,status]`, `[status,expiresAt]` indexes).
- `OrderItem.verificationFlag String? @db.VarChar(30)` — values: `accept_verify_requested | accept_confirmed | rider_verify_requested`.
- `Order.resolverTrace Json?` — fee-carrier child only.
- `Product.inventoryState InventoryState?` back-relation.
- **Verify:** `npx prisma validate` passes; migration SQL column-for-column matches `@map` names.

### `apps/api/src/modules/orders/order-status.ts`
- `transitionOrderStatus` after a successful CAS flip: `to === 'picked_up'` → `commitReservationsForOrder(tx, …)`; `to === 'cancelled'` → `releaseReservationsForOrder(tx, …)` — **same transaction**. Lost CAS race (`count === 0`) → no hooks. Config read is failure-safe (defaults).
- **Verify:** `order-status.test.ts` has 4 new hook tests ("COMMITS held…", "RELEASES held…", "NO inventory hook on other transitions", "skips the hooks…when the compare-and-set loses").

### `apps/api/src/modules/orders/orders.service.ts` (largest change)
- `decrementStockOrThrow` + `StockTx` **deleted**.
- `placeOrder`: placement loop (`MAX_PLACEMENT_ATTEMPTS = 3`). Per attempt: resolver runs with `excludeProductIds`; excluded pinned lines → `droppedLines`; plans/fee/promo recomputed from scratch; one `$transaction` creates group/orders/**items one-by-one** (line id = reservation idempotency key), then `reserveOrderLines` (globally productId-sorted), then chip-flag stamping (tracked lines with `confidence < θ_flag` → `verificationFlag='accept_verify_requested'`), then promo redemption. `ReservationConflictError` → rollback, exclude product, retry; attempts exhausted → `BusinessRuleError`. Prepaid `holdExpiresAt = now + inv.reservation_ttl_min`; COD null. `resolverTrace` (attempt + excluded + full resolver trace) written on the fee-carrier order.
- `sellerAcceptOrder(orderId, sellerUserId, lineOverrides = [])`:
  - plain accept → `accept_verify_requested` → `accept_confirmed` (implicit confirmation, EDD §4.6);
  - `availableQty ≥ qty` → confirm flag only;
  - `0 < n < qty` → `sellerCapLineQty`: prepaid `refundOrderLine(diff)` FIRST (retry-safe), then one tx: `shrinkReservationForOrderItem` + `seller_count(n)` belief event + item `{quantity:n, subtotal, refundedPaise+=diff, accept_confirmed}` + order totals decrement; emits `ORDER_ITEM_UNAVAILABLE (cancelled:false)`;
  - `n = 0` → `sellerMarkLineUnavailable`: line-claim CAS (`fulfilled→unavailable_refunded`) → release hold + `seller_toggle_out` event (belief 0, conf 0.95) → cache bust → substitute → refund line / COD totals decrement → emit;
  - zeroing would leave **no** fulfilled lines → `BusinessRuleError('…order reject karein')` before any mutation.
- `autoAcceptOrder`: flips `accept_verify_requested` → `rider_verify_requested` + `console.warn` canary; still accepts (timer must not strand); returns `unverifiedLines`.
- `riderReportItemUnavailable`: after line claim, one tx = `releaseReservationForOrderItem` + `applyInventoryEvent('rider_reported_missing')` (belief 0, conf 0.15, projection out_of_stock) — replaces the old direct `product.update`. Substitute query extracted to `findSubstitute()` (shared with seller path).
- `getMyOrders` items now include `id, verificationFlag, fulfillmentStatus` (chips data; additive).
- **Verify:** `grep -n "MAX_PLACEMENT_ATTEMPTS\|reserveOrderLines\|sellerCapLineQty\|rider_verify_requested" apps/api/src/modules/orders/orders.service.ts`.

### `apps/api/src/modules/orders/resolver.service.ts`
- `Candidate.stockQty` → **`effectiveQty`** + optional `confidence`.
- `resolveCart`: joins `inventoryState`; tracked candidates: `conf < θ_hide` → skipped; `effectiveQty ≤ 0` → skipped (read-time decay — status column alone is never trusted). `maxShops` default from `inv.max_shops_per_group`.
- `resolveAggregatedLines`: `maxShops` clamp [1,3]; each greedy iteration opens exactly one shop; leftover lines → `dropped` (never a 4th pickup). Full `trace` (per-line candidates w/ viability, chosen, dropped) in `ResolveResult`.
- **Verify:** `resolver.service.test.ts` — 2 new tests (cap-drop, trace) + renamed field; all pre-existing behavior tests (price floor, tolerance, nearest tie-break) untouched and green.

### `apps/api/src/modules/catalog/aggregation.service.ts`
- `build()` joins `inventoryState`; tracked items in the `hidden` band are filtered out of the feed at build time; survivors carry `effectiveQty`.
- `AggTile.capQty: number | null` — per master: `null` if ANY carrying shop untracked, else `max(effectiveQty)` across shops.
- **Verify:** `catalog.essentials.test.ts` tile helper gained `capQty: null`; aggregation tests green.

### `apps/api/src/modules/catalog/inventory.service.ts`
- All numeric stock writes route through `recordSellerCount` → `applyInventoryEvent('seller_count')` (create/update/stock-this/CSV/set-qty). Product-create paths without stock call `ensureInventoryState` (CAS needs the row). Direct `data.stockQty/stockStatus` writes removed everywhere.
- New `verifyShelf(productId, 'have'|'low'|'out', qty?)`: out → `seller_toggle_out`; qty → `seller_count`; else `seller_bucket` (`inv.bucket_lots`=24 / `inv.bucket_some`=8). Returns `restocked` for the notify hook.
- **Verify:** the three rewritten test files assert event-writer behavior, e.g. `inventory.stockthis.test.ts` "creates … tracking stock via a seller_count event".

### `apps/api/src/modules/catalog/catalog.routes.ts` + `catalog.schema.ts`
- `/products/:id/stock` toggle: `available|out_of_stock` → `seller_toggle_in/out` belief events; `hidden` stays a direct write + `StockUpdateLog` (merchandising, not inventory). Restock-notify driven off `result.stockStatusChanged`.
- New `PATCH /products/:id/verify` (zod `verifyShelfSchema {state, qty?}`) + restock-notify.

### `apps/api/src/modules/cart/cart.service.ts`
- `assertWithinEffectiveQty` on add/update for base-product lines of tracked items: requested total > effective → `BusinessRuleError('… sirf N available hai')`. Binary/variant lines unchanged.

### `apps/api/src/modules/payments/payments.service.ts`
- `markOrderPaid` post-flip: `reclaimExpiredReservations(prisma, orderId)`; failures logged, flagged lines warned — never blocks the paid order.

### Worker — `queues.ts`, `scheduler.ts`, `index.ts`
- New job names: `RESERVATION_SWEEP` (repeat 60s), `INVENTORY_RECONCILE` (cron `0 21 * * *` = 2:30 IST), `MORNING_CARD_PUSH` (cron `30 3 * * *` = 9:00 IST) — all on the existing RECONCILIATION queue, processed in `reconciliationWorker`. Patterns copied from the repo's proven BullMQ v5 usage (no `QueueScheduler` — v5 rule respected).

### `apps/api/src/modules/sellers/sellers.routes.ts` / `admin/admin.routes.ts`
- `GET /sellers/me/morning-card` (seller-guarded, computed fresh). `GET /admin/inventory/health` (admin-guarded).

### Seller app (`apps/seller-app`)
- `api.service.ts`: `acceptOrder(…, lineOverrides?)`, `verifyShelf`, `getMorningCard` + `MorningCardItem` type.
- `OrderQueueScreen.tsx`: chip UI on the accept modal for lines with `verificationFlag==='accept_verify_requested'` (है / सिर्फ n stepper 1..qty−1 / नहीं; सिर्फ hidden when qty==1); socket `order:new` triggers `loadOrders()` so the modal enriches with line ids (socket payload has none — chips degrade gracefully to 1-tap accept, backend implicit-confirms); inline Accept opens the modal when flagged lines exist; chip state resets per order.
- `MorningCardScreen` + `AppNavigator` registration (`RootStackParamList.MorningCard`) + `NotificationsBootstrap` deep-link (`data.screen==='MorningCard'`) + StockScreen banner.

### Customer app (`apps/customer-app`)
- `catalog.ts`: `AggTile.capQty` + `toFeedCard` passthrough. `ProductCard.tsx`: `capQty` on `ProductCardData`; "सिर्फ N बचे" shown only when `0 < capQty ≤ 5`; stepper `+` no-ops at cap. Cart-clamp errors already surface via the pre-existing toast+revert path — no other change needed.

---

## 5. Event-effect table implemented (`apply-event.ts` — audit against EDD §4.3)

| eventType | expectedQty | confidenceBase | verified stamp | status projection |
|---|---|---|---|---|
| `seller_count` | := qty | 0.95 | yes (`seller_count`) | band (tracked) |
| `seller_bucket` | := qty (bucket) | 0.85 | yes | band |
| `seller_toggle_out` | tracked→0, binary→null | 0.95 | yes | **out_of_stock** (both) |
| `seller_toggle_in` | tracked→bucketSome, binary→null | 0.80 | yes | **available** (both) |
| `rider_reported_missing` | tracked→0 | 0.15 | yes (`rider_miss`) | **out_of_stock** |
| `admin_adjust` | := qty | 0.90 | yes | band |
| `backfill` | := qty/null | 0.85/0.80 | if qty | binary: none |
| `pickup_committed` (reservations.service) | −= qty, floor 0 | `min(base+0.05, 0.95)`; anomaly → 0.20 | yes (`rider_pickup`) | band |
| `order_reserved` / `reservation_released` / `reservation_expired` | unchanged | unchanged | no | release/commit reproject band |
| `anomaly_negative_floor` / `reconcile_fix` | see reservations/reconcile | 0.20 / unchanged | — | — |

Invariants: `hidden` product status is NEVER overwritten by any event (merchandising is seller-owned). Binary items get no band projection from count-free events.

---

## 6. Concurrency & idempotency guarantees (the claims to attack hardest)

1. **Online-vs-online oversell:** single-statement CAS (`UPDATE inventory_state SET reserved_qty = reserved_qty + n WHERE … expected − reserved ≥ n OR (binary AND products.stock_status='available')`). No SELECT-FOR-UPDATE, no Redis, no serializable.
2. **Deadlock rule:** `reserveOrderLines` sorts globally by `productId` across ALL child orders in the placement tx (test: "reserves in ascending productId order").
3. **Replay safety:** reservations keyed `orderItemId @unique`; events keyed `(orderItemId, eventType)` unique + `createMany skipDuplicates`; commit/release/expire all claim via `WHERE status='held'`; line refunds claim via `WHERE fulfillmentStatus='fulfilled'`. Double-tap/redelivered-job = no-op.
4. **Hook placement:** commit/release ride the order-status CAS *inside the same transaction*; a lost status race runs no hooks.
5. **Post-pickup cancel:** releases no stock (holds already `committed`) — goods physically left; returns are a manual flow.
6. **Placement atomicity:** a CAS loss rolls back the entire attempt (orders, items, promo) — totals are never patched mid-transaction; fees/promos recompute per attempt.
7. **Late payment:** expired holds re-reserve per line in own tx; CAS failure → order proceeds with `accept_verify_requested` flag (accept-time verification), never blocks.

---

## 7. Config keys (AppConfig `inv.*`, defaults in `belief.ts`)

`inv.k_sigma`=1.0 · `inv.theta_hide`=0.40 (== θ_route) · `inv.theta_flag`=0.65 · `inv.theta_auto`=0.65 (reserved; gate is flag-driven) · `inv.max_shops_per_group`=2 (clamped 1–3) · `inv.reservation_ttl_min`=15 · `inv.morning_card_n`=8 · `inv.bucket_lots`=24 · `inv.bucket_some`=8 · `inv.tau.slow/med/fast/ultra`=336/72/24/8h · `inv.vel.slow/med/fast/ultra`=0.2/1.5/6/15 per day.

---

## 8. Verification runbook (run these; expected results stated)

```bash
cd apps/api

# 1. Full test suite — EXPECT: 54 files, 403 tests, 0 failures
npx vitest run

# 2. Typecheck — EXPECT: exactly 28 errors, ALL pre-existing
#    (baseline before this work was 29; the change REMOVED the old StockTx error.
#     None of the 28 are in src/modules/inventory/** or the new code paths —
#     they are the known exactOptionalPropertyTypes Fastify-handler batch:
#     orders.routes 9, payments.routes 3, orders.service ReleasePrisma 3,
#     realtime.helpers.test 2, auth.routes 2, + 9 singles.)
npx tsc --noEmit | grep -c "error TS"

# 3. Schema valid — EXPECT: "valid"
npx prisma validate

# 4. A-1 truly gone — EXPECT: no output (old decrement path deleted)
grep -rn "decrementStockOrThrow" src

# 5. Single-writer discipline — EXPECT: inventoryState writes ONLY in
#    src/modules/inventory/** and prisma/backfill-inventory.ts
grep -rn "inventoryState\.\(update\|upsert\|create\)" src --include="*.ts" | grep -v __tests__ | grep -v "modules/inventory"

# 6. Hooks are structural — EXPECT: both commit+release calls inside
#    transitionOrderStatus (order-status.ts), nowhere per-call-site
grep -n "commitReservationsForOrder\|releaseReservationsForOrder" src/modules/orders/order-status.ts

# 7. Apps typecheck — EXPECT: exit 0 both
(cd ../seller-app  && npx tsc --noEmit)
(cd ../customer-app && npx tsc --noEmit)

# 8. Migration ↔ schema drift (needs a live PG; see §9 first) — EXPECT: empty diff
npx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$DATABASE_URL"
```

Test inventory: **62 new tests** — new files: belief 16, apply-event 10, inventory.config 3, reservations 15, morning-card 3, orders.accept-overrides 6 (= 53); added to existing files: order-status hooks +4, resolver cap/trace +2, inventory.service verifyShelf +3 (= 9). `orders.stock.test.ts` (3 tests) deleted with the code it tested. Suite: 344 → **403** (`npx vitest run` per-file counts reproduce these numbers via `grep -c "it(" <file>` vs `git show HEAD:<file>`).

---

## 9. Cutover runbook (NOT yet executed — DB was down)

```bash
pnpm --filter @chirawa/api db:migrate:prod        # applies 20260707090000_inventory_engine
pnpm --filter @chirawa/api db:backfill:inventory  # idempotent; logs tracked/binary counts
# restart API + worker (repeatables self-register via setupSchedules)
```
Post-cutover smoke (seeded): place COD order → `reservations` row `held`; rider pickup → `committed` + `inventory_events.pickup_committed` + `products.stock_qty` mirror decremented; cancel a fresh order → `released`; abandon a prepaid checkout 15+ min → sweeper marks `expired`; `GET /admin/inventory/health` → `invariants.reservedCounterDrift === 0`.

---

## 10. Known limitations / follow-ups (deliberate, pre-known — don't count as defects)

1. **`Payment.refundedPaise` overwrite edge (pre-existing):** `refundCapturedOrderPayment` sets `refundedPaise := totalAmount` on full cancel; a prior partial line refund's amount is overwritten in that field (ledger `transactions` rows remain correct). Chips make this path likelier — first follow-up.
2. **Variant inventory out of scope:** `ProductVariant.stockQty` still checked only at cart-add; `OrderItem` has no `variantId` (pre-existing gap, documented in `INVENTORY_ENGINE_ANALYSIS.md` §4).
3. **ESLint config missing repo-wide** — `pnpm lint` cannot run (pre-existing).
4. **Cache staleness on order-path projections:** commit-to-zero relies on feed TTL (≤150s) rather than explicit invalidation; resolver/cart read live so no oversell risk — display-only lag, per EDD §8 layering.
5. **θ_auto key reserved but the auto-accept gate is flag-driven** (flags stamped at placement with θ_flag); at a 3-min window the decay delta is negligible. Revisit if the window grows.
6. **Deferred by design (EDD §13.3):** velocity EWMA, reliabilityScore, fairness tie-break, calibration chart, per-line pickup confirm, rider-wait telemetry, partial-depart tooling.
7. **Morning-card FCM requires the seller's token in Redis** (`fcm:token:{userId}`) — same mechanism as existing pushes; sellers who never opened the app get no push (card still served on GET).
