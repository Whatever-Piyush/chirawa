# ETA Hardening P1 — Implementation Report

**Scope:** finding **#6 only** (`distanceKm = 0` ⇒ ETA always fallback). **P2 and P3 were
not started.** Constraints honored: **no schema change, no migration, no provider call, no
billing change.**

**Status:** Implemented on `fix/order-rider-id-identity` (on top of the uncommitted ETA
Phase 1 work), **uncommitted**. Context7 Prisma v5 consulted; the change adds a `select` of
existing columns and uses the internal `haversineMeters` util (no new library surface).

## 1. Root cause (recap)
`placeOrder` stores `distanceKm: 0, distanceSource: 'flat'` on every order (flat-fee model),
so `computeEta`'s `distanceKm > 0` check always failed → every real order got the wide
**fallback** range. (DB: 51/54 orders are `flat`/0.000.)

## 2. The change
**Derive the shop→customer leg from the coordinates the order already stores** — no provider,
no schema, billing field untouched.

Files:
- `apps/api/src/modules/orders/eta.service.ts`
- `apps/api/src/modules/orders/__tests__/eta.service.test.ts`

Key hunks (`eta.service.ts`):
```ts
// import { haversineMeters } from '../../shared/utils/geo';
const ROAD_FACTOR = 1.3;   // straight-line → approx road distance (calibrate in P3)

// EtaInputs: distanceKm → legKm  (shop→customer travel leg, km; null → coords missing)

// computeEta — a leg of 0 is VALID (customer at the shop), not "unknown":
const hasLeg    = input.legKm != null && Number.isFinite(input.legKm) && input.legKm >= 0;
const travelMin = hasLeg ? (input.legKm! / TOWN_SPEED_KMPH) * 60 : FALLBACK_TRAVEL_MIN;
// …source = hasLeg ? 'prep_road' : 'fallback'

// computeAndPersistEta — select coords (not the billing distanceKm) and derive the leg:
//   select: { …, deliveryLat, deliveryLng, shop: { prepTimeMinutes, lat, lng } }
const legKm = coordsOk
  ? (haversineMeters({ lat: sLat, lng: sLng }, { lat: dLat, lng: dLng }) / 1000) * ROAD_FACTOR
  : null;
```

What did **not** change:
- `Order.distanceKm` / `distanceSource` are no longer read or written by the ETA path
  (billing field left intact).
- `computeAndPersistEta(prisma, orderId)` signature unchanged → **no edits to call sites**
  (`orders.service`, `dispatch.service`).
- No schema, no migration, **zero provider calls** (Haversine over stored coords).
- Secondary fix: `legKm = 0` (customer at the shop) is now treated as a valid short distance,
  not "unknown" (resolves the review's "`> 0` misclassifies a legitimate 0").

## 3. Tests
**Typecheck** `pnpm --filter @chirawa/api typecheck` → **29 = baseline (0 new errors)**.
(A transient test-only cast error was fixed before finalizing.)

**Unit** `vitest run src/modules/orders` → **67/67 pass (9 files)**. `eta.service.test.ts`
(13) now covers: per-phase compute over `legKm`; **`legKm = 0` ⇒ distance-based (not
fallback)**; **`legKm = null` ⇒ fallback**; floor; `computeAndPersistEta` selects the
coordinate fields and persists a **non-fallback** ETA; terminal-skip; error-swallow.

## 4. Runtime verification
Two orders seeded **exactly like real orders** — `distance_km = 0`, `distance_source =
'flat'` — differing only in the drop pin. Walked via real HTTP (seller transitions). Cleaned
up after (DB back to 54 orders).

| Order | drop distance | `distance_km` (billing) | phase | `eta.source` | `secondsRemaining` |
|---|---|---|---|---|---|
| FAR | ~2 km | **0 / flat** | preparing | **`prep_road`** | 1449 |
| FAR | ~2 km | 0 / flat | ready_for_pickup | `prep_road` | 969 (tightened) |
| NEAR | ~0.17 km | **0 / flat** | preparing | **`prep_road`** | 836 |

**Proves #6 fixed:**
- Despite `distance_km = 0` (the condition that previously forced `fallback`), the ETA is now
  **`prep_road`** — a real, distance-based value derived from coordinates.
- The ETA **scales with the actual drop distance**: FAR (1449s) ≫ NEAR (836s) at the *same*
  `preparing` phase.
- It still **tightens** across phases (FAR 1449 → 969 as prep completes).
- Pre-fix (per `ETA_PHASE1_REVIEW.md`), the same `distance_km = 0` orders yielded `fallback`.

## 5. Not done (per instruction)
- **P2** (#10 notification ordering) — not started.
- **P3** (#4 client `order:eta` subscription) — not started.

## 6. Notes
- Changes are **uncommitted**; `eta.service.ts` is still an untracked file (part of the
  uncommitted ETA Phase 1 set), so this fix is folded into it.
- The dev API (tsx-watch) reloaded the change; no restart needed (no schema/client change).
- Road-factor `1.3` is a constant; calibration from real `deliveredAt − pickedUpAt` data is
  Phase 3 (out of scope).
