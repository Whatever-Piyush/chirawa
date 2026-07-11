# Tracking V2 — Sprint 2 Implementation Report

**Scope:** ETA Hero (P1.1) · Map Gating (P1.2) · Timeline Redesign (P1.4).
**Excluded (not touched):** rider photo, rider rating, number masking, polyline routing, delay
engine, group ETA, support workflows, rider-card redesign.

**Status:** Implemented on `fix/order-rider-id-identity`, **uncommitted**. Sprint 2 is
**client-only** — no backend, no schema, no socket changes (uses the shipped `eta` block,
`order:eta` push, and the order's phase-timestamp columns already in `GET /orders/:id`).
(The `apps/api/*` + `order.dto.ts` changes in the working tree are **Sprint 1's** refund
block, also still uncommitted.)

## 1. Files changed (Sprint 2)
| File | Change |
|---|---|
| `apps/customer-app/src/screens/orders/OrderTrackingScreen.tsx` | New `EtaHero` + `fmtClock`; replaced the 4-step horizontal `ProgressStepper` with a vertical `OrderTimeline`; `showMapNow` gated to active delivery + pre-pickup packing illustration; header `headerBig` → phase headline, `headerSmall` → order id; removed the old `etaText`/`STATUS_STEP`/`STEP_KEYS`/`currentStep` |
| `packages/i18n/src/translations.ts` | new `tracking.*` keys (en + hi): `progressTitle, pickedUp, calculatingEta, byTime, etaEstimate, packingSub` |

## 2. What was built
**P1.1 — ETA Hero.** A dedicated top card. Pre-pickup: a **range** ("Arriving in 15–20 min ·
by 9:42 PM"); at `picked_up`/`out_for_delivery`: a **live local countdown** ("Arriving in ~9
min") that ticks every second, **clock-skew safe** (anchored on the client receive-time of
each `eta` + `secondsRemaining`, reconciled on every push/poll). `source==='fallback'` adds an
"· estimate" note; no `eta` yet → "Calculating ETA…". The ETA was **removed from the gradient
header** (now phase-only) — single ETA surface, no more header-vs-badge duplication.

**P1.2 — Map gating.** The live map renders **only** for `picked_up`/`out_for_delivery`
(matches the rider reveal). Pre-pickup shows a **packing illustration** instead of the empty
"location unavailable" map.

**P1.4 — Timeline redesign.** A vertical **`OrderTimeline`**: 5 display phases (Confirmed ·
Packing · Picked up · On the way · Delivered) with **per-phase timestamps** (from the order's
`confirmedAt/preparingAt/pickedUpAt/outForDeliveryAt/deliveredAt`), **collapsible** (collapsed
shows the current phase + chevron), and a distinct **cancelled** branch. Reuses `PulsingRing`
for the active dot.

## 3. Tests
- **Typecheck:** **customer-app `tsc --noEmit` → 0 errors**; api **29 = baseline** (no backend
  change in Sprint 2).
- **Unit:** `vitest run src/modules/orders` → **71/71 pass** (regression only — Sprint 2 is
  client-side; the suite stays green).
- Client UI: repo has no RN component test harness — verified by typecheck + the runtime data
  walk below + by construction (stated honestly, as in prior sprints).

## 4. Runtime verification (live API, real OTP, cleaned up)
Walked one order through every phase; `GET /orders/:id` (customer) at each — confirming the
data each feature consumes:

| Phase | HERO `eta` | MAP shown | TIMELINE timestamps |
|---|---|---|---|
| confirmed (seeded) | — → "Calculating…" | **False** | confirmedAt |
| preparing | prep_road ~1449s ±300 (range) | **False** | +preparingAt |
| ready_for_pickup | prep_road ~969s ±300 | **False** | (Packing phase) |
| picked_up | prep_road ~789s ±**120** | **True** | +pickedUpAt |
| out_for_delivery | prep_road ~789s ±120 (countdown) | **True** | +outForDeliveryAt |

**Proves:**
- **ETA Hero** has data every live phase — a range pre-pickup (spread 300) tightening to a
  ±120 countdown source at OFD; the empty case (`confirmed` seeded → no eta) renders
  "Calculating ETA…".
- **Map gating** flips exactly at pickup — `shown=False` through confirmed/preparing/ready,
  `True` at picked_up/out_for_delivery (the pre-pickup empty-map is gone).
- **Timeline** timestamps accumulate per phase.

DB restored: `orders=54`, no leftovers, no online riders.

## 5. Not done (per instruction)
Rider photo · rider rating · number masking · polyline routing · delay engine · group ETA ·
support workflows · rider-card redesign — **none started.**

## 6. Notes
- Changes **uncommitted** on `fix/order-rider-id-identity` (Sprint 1 + Sprint 2 both pending).
  Suggested commits: `feat(tracking): V2 sprint 1 — error state, refund card, item-unavailable`
  then `feat(tracking): V2 sprint 2 — ETA hero, map gating, timeline`.
- The in-map ETA badge stays (in-context on the map at OFD); the Hero is the primary ETA
  surface.
- Old horizontal-stepper styles remain defined but unused (harmless object properties); can be
  pruned in a cleanup pass.
