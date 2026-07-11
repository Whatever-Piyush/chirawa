# ETA MVP — Phase 1 Implementation Report

**Scope:** Phase 1 only per `ETA_MVP_IMPLEMENTATION_PLAN.md` / `PHASE1_CHANGESET.md` —
milestone ETA computed at placement + recomputed at every phase transition, persisted,
pushed via `order:eta`, surfaced in `GET /orders/:id`, with the hardcoded ETA sources
replaced. **No live/ping recompute, no Redis ETA cache, no provider calls, no delay
sweep, no multi-shop aggregation, no traffic/weather** (Phase 2/3 — not started).

**Status:** Implemented on `fix/order-rider-id-identity` (stacked on BUG-1 `6fdad0d` +
BUG-2 `bcd8830`), **uncommitted**. Context7 (Prisma v5) consulted; the socket bridge
reuses the existing Socket.IO v4 `io.to(room).emit()` pattern verbatim.

## 1. Constraint compliance
- **No provider calls anywhere in Phase 1.** Travel time = `Order.distanceKm ÷ town speed`
  (the road distance is already stored). The flat-fee path (`distanceKm` 0/null) falls back
  to a **wide range** (`source='fallback'`, ±10 min) — never a confident wrong value, never a
  Distance Matrix call.
- **No ping-path code touched, no Redis ETA cache, no live recompute** — recompute fires
  **only on phase transitions** (and once at placement).
- **Best-effort:** `computeAndPersistEta` swallows all errors — ETA never blocks order flow
  (same discipline as the BUG-2 rider lookup).
- **Duration, not absolute timestamp** (review F3): the `eta` payload/response carry
  `secondsRemaining + serverNow`.

## 2. Files changed
**New**
- `apps/api/src/modules/orders/eta.service.ts` — pure `computeEta()`, `computeAndPersistEta()` (persist + emit, best-effort), `etaResponse()` (GET serialization).
- `apps/api/prisma/migrations/20260617184209_eta_phase1/migration.sql` — additive migration.
- `apps/api/src/modules/orders/__tests__/eta.service.test.ts` — 12 unit tests.

**Modified (backend)**
- `prisma/schema.prisma` — `Order`: `estimatedDeliveryAt, etaSpreadSeconds, etaComputedAt, etaSource, preparingAt, readyAt, outForDeliveryAt`; `Shop.prepTimeMinutes`; index `(status, estimatedDeliveryAt)`.
- `modules/orders/orders.service.ts` — `placeOrder` (initial ETA post-commit), `updateOrderStatus` (stamp `preparingAt`/`readyAt` + recompute), `getOrder` (`eta` block).
- `modules/delivery/dispatch.service.ts` — `riderAdvance` (stamp `outForDeliveryAt` + recompute), `assignOrder` (recompute).
- `shared/events/event-bus.ts` — `ORDER_ETA_CHANGED` event + payload + emit fn.
- `shared/plugins/realtime.plugin.ts` — bridge → `order:eta` (duration + serverNow) to `order:{id}` + `user:{customerId}`.
- `modules/notifications/notifications.plugin.ts` — `out_for_delivery` push uses the real ETA (replaces hardcoded `'30 minute'`).

**Modified (shared / client)**
- `packages/types/src/dto/order.dto.ts` — additive `eta?` on `OrderDetailResponse`.
- `customer-app/.../OrderTrackingScreen.tsx` — header shows the server ETA range (replaces hardcoded `~20 min`).
- `customer-app/.../TrackingMap.tsx` — badge prefers the server ETA; straight-line kept only as a last-ditch fallback.
- `modules/orders/__tests__/orders.rider-access.test.ts` — +3 getOrder `eta`-block tests.

## 3. Migration
One additive migration `20260617184209_eta_phase1` — `ADD COLUMN` (7 nullable on `orders`,
1 `NOT NULL DEFAULT 8` on `shops`) + `CREATE INDEX`. **No backfill** (ETA is forward-
computed). Applied via `prisma migrate deploy` (non-resetting); 54 seed orders intact;
client regenerated.

## 4. ETA model (Phase 1)
`ETA = prep_remaining + travel + pickup_dwell + handover`, floored at 5 min.
- `prep_remaining`: full `Shop.prepTimeMinutes` decremented from `sellerAcceptedAt`/`preparingAt` (review A3); 0 once `ready_for_pickup`+.
- `travel = distanceKm ÷ 14 km/h` (calibrated-conservative for the town, review A2); fallback range when distance unknown (review F1).
- `dwell`: pickup-dwell (3 min) pre-pickup + handover (2 min) — the end-of-trip terms (review A1).
- Spread: ±5 min pre-pickup, ±2 min once out for delivery, ±10 min fallback.

## 5. Tests
- **Typecheck:** `pnpm --filter @chirawa/api typecheck` → **29 = baseline (0 new errors)**.
  Customer-app: no errors in the two edited client files. (A transient test-only error was
  fixed before finalizing.)
- **Unit (`vitest run src/modules/orders`): 66/66 pass (9 files).**
  - `eta.service.test.ts` (12): per-phase compute, terminal→null, flat→wide fallback, floor,
    `etaResponse` shape/omission, `computeAndPersistEta` persist+emit/terminal-skip/error-swallow.
  - `orders.rider-access.test.ts` (19): +3 `eta`-block tests (present when computed+non-terminal; omitted for terminal/unset).
  - All pre-existing orders tests still green.

## 6. Runtime verification (live API, real OTP, cleaned up)
Walked one order (`distanceKm = 2.0`) through the transitions; `GET /orders/:id` (customer)
+ DB after each. All actions returned **HTTP 200**:

| Step | status | `eta.secondsRemaining` | spread | source | timestamp stamped |
|---|---|---|---|---|---|
| seeded (no transition) | confirmed | — (none) | — | — | — |
| seller → preparing | preparing | **1294** (~21.6m) | 300 | prep_road | `preparing_at` ✓ |
| seller → ready | ready_for_pickup | **814** (~13.6m) | 300 | prep_road | `ready_at` ✓ |
| admin → assign | ready_for_pickup | 814 | 300 | prep_road | — |
| rider → picked_up | picked_up | **634** (~10.6m) | **120** | prep_road | `picked_up_at` ✓ |
| rider → out_for_delivery | out_for_delivery | 634 | 120 | prep_road | `out_for_delivery_at` ✓ |

**Proves:** ETA is computed at each transition, **tightens** as prep completes (1294 → 814 →
634 s), the **spread narrows** at pickup (300 → 120), `source=prep_road` (using `distanceKm`,
not the fallback), phase timestamps are stamped, and the `eta` block (duration + serverNow)
is present in `GET /orders/:id`. The hardcoded `~20 min` / straight-line / `'30 minute'`
sources are gone. DB restored (54 orders, no leftovers).

## 7. Not done (Phase 2/3 — not started, per instruction)
Live rider ETA, ping-path recompute, Redis ETA cache, delay-sweep worker, multi-shop group
ETA, traffic-aware routing, weather handling. The provider-isolation accessor + kill-switch
were **not** needed in Phase 1 (zero provider calls); they land when the first provider call
(live legs / flat-path lookup) is introduced in a later phase.

## 8. Notes
- Changes are **uncommitted** on `fix/order-rider-id-identity`. Natural commit: "feat(eta):
  Phase 1 milestone ETA". The migration + `eta.service.ts` + `eta.service.test.ts` are
  untracked; the rest are modifications.
- The dev API was restarted to load the regenerated Prisma client; it is currently running.
