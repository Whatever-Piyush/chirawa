# ETA MVP — Phase 1 Changeset (pre-implementation)

Scope: **Phase 1 only** per `ETA_MVP_IMPLEMENTATION_PLAN.md`. Milestone ETA computed at
placement + recomputed at each **phase transition**, persisted, pushed via `order:eta`,
surfaced in `GET /orders/:id`, and consumed by the client (replacing the hardcoded values).
**No live/ping recompute, no Redis ETA cache, no provider calls, no delay sweep, no
multi-shop aggregation, no traffic/weather.** (Phase-1 travel time derives from the existing
`Order.distanceKm` ÷ a calibrated town speed — so **no Google Distance Matrix call is needed
at all** in Phase 1; the flat-fee path falls back to a wide range, never a provider call.)

## 1. Files that will change

**Backend (`apps/api`)**
| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `Order` eta fields + phase timestamps; `Shop.prepTimeMinutes`; index `(status, estimatedDeliveryAt)` |
| `prisma/migrations/<ts>_eta_phase1/migration.sql` | **New** additive migration (ADD COLUMN + CREATE INDEX) |
| `src/modules/orders/eta.service.ts` | **New** — pure `computeEta()` + `computeAndPersistEta()` (best-effort, emits `ORDER_ETA_CHANGED`) |
| `src/modules/orders/orders.service.ts` | `placeOrder` (initial ETA post-commit); `updateOrderStatus` (stamp `preparingAt`/`readyAt` + recompute); `codCollected`/`markDelivered` (terminal → skip); `getOrder` (add `eta` block) |
| `src/modules/delivery/dispatch.service.ts` | `riderAdvance` (stamp `outForDeliveryAt` + recompute); `assignOrder` (recompute) |
| `src/shared/events/event-bus.ts` | Add `ORDER_ETA_CHANGED` event, payload type, emit fn |
| `src/shared/plugins/realtime.plugin.ts` | Bridge `ORDER_ETA_CHANGED` → emit `order:eta` (duration + serverNow) to `order:{id}` + `user:{customerId}` |
| `src/modules/notifications/notifications.plugin.ts` | `out_for_delivery` push uses the real ETA (replaces hardcoded `'30 minute'`) |

**Shared / client**
| File | Change |
|---|---|
| `packages/types/src/dto/order.dto.ts` | Additive `eta?: { secondsRemaining; spreadSeconds; serverNow; source }` on `OrderDetailResponse` |
| `apps/customer-app/src/screens/orders/OrderTrackingScreen.tsx` | Header consumes server `eta` (replaces hardcoded `~20 min`) |
| `apps/customer-app/src/components/tracking/TrackingMap.tsx` | Badge prefers server `eta`; straight-line kept only as last-ditch fallback |

*(No change to `packages/api-client` runtime — `getOrder` already returns `OrderDetailResponse`; the new optional field flows through.)*

## 2. Migrations
- **One** migration `eta_phase1`, **additive only** (safe — history is clean, DB in sync):
  - `ALTER TABLE "orders" ADD COLUMN "estimated_delivery_at" TIMESTAMP(3)`, `"eta_spread_seconds" INTEGER`, `"eta_computed_at" TIMESTAMP(3)`, `"eta_source" VARCHAR`, `"preparing_at" TIMESTAMP(3)`, `"ready_at" TIMESTAMP(3)`, `"out_for_delivery_at" TIMESTAMP(3)` (all nullable).
  - `ALTER TABLE "shops" ADD COLUMN "prep_time_minutes" INTEGER NOT NULL DEFAULT 8`.
  - `CREATE INDEX "orders_status_estimated_delivery_at_idx" ON "orders"("status", "estimated_delivery_at")`.
  - **No backfill** (ETA is forward-computed; existing orders simply have null until next transition). Generate via `--create-only`, inspect (ADD/CREATE only), then apply.

## 3. Tests to add/update
- **`src/modules/orders/__tests__/eta.service.test.ts` (new)** — pure `computeEta`:
  - placement (`paid`/`confirmed`): `prep + travel(distanceKm) + dwell + handover`.
  - `preparing`: prep decremented from `preparingAt`.
  - `ready_for_pickup` / `out_for_delivery`: prep = 0.
  - terminal (`delivered`/`cancelled`): returns `null` (no ETA).
  - flat/no-distance (`distanceKm` 0/null): **wide-range fallback**, `source='fallback'`.
  - floor (very short distance) ⇒ ≥ `minMinutes`.
  - `computeAndPersistEta` (mock prisma): persists fields + emits once; terminal skips; a thrown error is swallowed (best-effort).
- **`src/modules/orders/__tests__/orders.rider-access.test.ts` (extend)** — `getOrder` returns the
  `eta` block when `estimatedDeliveryAt` is set + non-terminal; omits it for terminal/unset.
- **Transition coverage** — assert `updateOrderStatus` stamps `preparingAt`/`readyAt`; `riderAdvance`
  stamps `outForDeliveryAt` (extend existing delivered/transition tests as needed).

## 4. Acceptance (Phase-1 done when)
- Order gets `estimatedDeliveryAt` at placement; recomputed on each transition; cleared/omitted
  on terminal.
- `GET /orders/:id` returns `eta { secondsRemaining, spreadSeconds, serverNow, source }`.
- `order:eta` fires on transitions (duration + serverNow payload).
- Client header + map show the server ETA; the `~20 min` and `'30 minute'` hardcodes are gone.
- `pnpm --filter @chirawa/api typecheck` adds **0** new errors; orders test suite green.
- Runtime: seed→assign→advance shows ETA tighten across phases and appear in `GET`.

## 5. Explicitly NOT in this changeset
Live rider ETA, ping-path recompute, Redis ETA cache, delay-sweep worker, multi-shop group
ETA, traffic-aware routing, weather handling. (Phase 2/3.)
