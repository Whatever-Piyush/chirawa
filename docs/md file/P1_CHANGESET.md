# ETA Hardening P1 — Changeset (pre-implementation)

Scope: **finding #6 only** (`distanceKm = 0` ⇒ ETA always fallback). Derive the
shop→customer leg from the coordinates the order already stores
(`Shop.lat/lng` + `Order.deliveryLat/deliveryLng`) via `haversineMeters` × a road-factor,
inside `eta.service`. **No schema, no migration, no provider call, no billing change.**
P2 and P3 are **not** touched.

## Files to change
| File | Change |
|---|---|
| `apps/api/src/modules/orders/eta.service.ts` | Add `ROAD_FACTOR` tunable + `import { haversineMeters } from '../../shared/utils/geo'`. `computeAndPersistEta`: select `shop.lat/lng` + `deliveryLat/deliveryLng` (drop `distanceKm` from the select — billing field, no longer read); compute `legKm = haversineMeters(shop, drop)/1000 * ROAD_FACTOR` and feed it to `computeEta`. `computeEta`/`EtaInputs`: rename `distanceKm → legKm`; treat a valid number `>= 0` as known (fixes the "legitimate 0 misclassified as unknown" nuance) — fallback only when the leg is missing/NaN. |
| `apps/api/src/modules/orders/__tests__/eta.service.test.ts` | Pass `legKm` (or coords) instead of `distanceKm`; `legKm = 0` ⇒ distance-based (not fallback); `legKm = null` ⇒ fallback. Update `computeAndPersistEta` mocks to return `shop.lat/lng` + `deliveryLat/deliveryLng` instead of `distanceKm`. |

No other files. `Order.distanceKm` / `distanceSource` (billing) are **not** read or written.
`computeAndPersistEta`'s public signature `(prisma, orderId)` is unchanged, so its call sites
(`orders.service`, `dispatch.service`) need **no** edits.

## Tests to add / update
- `computeEta`: a ~2 km leg → `source` distance-based (`prep_road`), travel ≈ `legKm ÷ townSpeed`.
- `computeEta`: `legKm = 0` (same coords) → distance-based, travel ≈ 0, ETA floored to min minutes.
- `computeEta`: `legKm = null` (coords missing) → wide **fallback** range.
- `computeAndPersistEta`: mock order with shop+drop coords ~2 km apart → persists a
  **non-fallback** ETA; assert the `findUnique` select requests the coordinate fields.
- Regression: terminal → null; persist/emit/terminal-skip/error-swallow unchanged.

## Runtime verification plan
Seed an order the way a **real** order looks — `distance_km = 0`, `distance_source = 'flat'` —
but with a drop pin ~2 km from the Chirawa Store coords. Walk the transitions and assert
`GET /orders/:id` now returns `eta.source` = **distance-based** (not `fallback`) with
`secondsRemaining` consistent with the coordinate distance. Then move the drop closer and
confirm the ETA shrinks. Pre-fix, the same `distance_km = 0` order yields `source = 'fallback'`;
post-fix it yields a real per-order ETA. Clean up the test rows.

## After implementation
`pnpm --filter @chirawa/api typecheck` (expect baseline unchanged) → `vitest run
src/modules/orders` → runtime verification → `P1_IMPLEMENTATION_REPORT.md`. **Do not start P2/P3.**
