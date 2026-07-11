# Tracking V2 — Sprint 2 Changeset (pre-implementation)

Scope: **ETA Hero (P1.1) · Map Gating (P1.2) · Timeline Redesign (P1.4)**.
**Excluded (not touched):** rider photo/rating, number masking, polyline routing, delay
engine, group ETA, support workflows, and the rider-card redesign. **All client-side — no
backend, no schema, no socket changes** (uses the already-shipped `eta` block, `order:eta`
push, and the order's phase-timestamp columns already in `GET /orders/:id`).

## Files to change
| File | Item | Change |
|---|---|---|
| `apps/customer-app/src/screens/orders/OrderTrackingScreen.tsx` | P1.1 | New **`EtaHero`** card (range pre-pickup → live local countdown at OFD, "by H:MM", fallback-aware, "Calculating…"); header `headerBig` → **phase headline** (`getStatusMessage()`), `headerSmall` → order id; remove `etaText` from the header (dedupe) |
| same | P1.2 | `showMapNow` gated to `picked_up`/`out_for_delivery`; pre-pickup **packing illustration** instead of an empty map |
| same | P1.4 | Replace the 4-step horizontal `ProgressStepper` with a **vertical `OrderTimeline`** (5 phases · per-phase timestamps · collapsible · cancelled branch) using the order's `confirmedAt/preparingAt/pickedUpAt/outForDeliveryAt/deliveredAt` (raw passthrough via the `orderPrisma` cast) |
| `packages/i18n/src/translations.ts` | all | new `tracking.*` keys (en + hi): `progressTitle, pickedUp, calculatingEta, byTime, etaEstimate, packingSub` |

No backend files. No P0 files re-touched (Sprint 1 stays). No Phase-2 work.

## Implementation notes
- **ETA Hero countdown** is clock-skew safe: anchor on the client receive time of each
  `order.eta` (`Date.now()` when it arrives) + `secondsRemaining`; tick locally (1 s) and
  reconcile on every push/poll. No use of the raw absolute server timestamp for the delta.
- **Map gating** aligns the map with the rider-reveal window (`showRider`); the empty
  "location unavailable" map pre-pickup goes away.
- **Timeline** maps 9 DB states → 5 display phases; timestamps from the order columns (already
  in the response); collapsed by default with an expand toggle; a distinct cancelled row.
- The in-map ETA badge stays (in-context on the map at OFD); the Hero is the single primary
  ETA surface — header no longer shows the ETA.

## Risks
- **Low-Med (P1.1):** countdown logic (anchor/tick/clamp at 0); ensure no negative; reconcile
  on push. **Low (P1.2):** a pure condition change + illustration. **Low-Med (P1.4):** phase→
  timestamp mapping + collapse state; cancelled branch.
- No backend/socket risk (client-only). Removing the old `ProgressStepper` must not orphan a
  now-unused helper (clean up or reuse `PulsingRing`).

## Tests
- **Backend:** none changed → `vitest run src/modules/orders` stays green (regression only).
- **Client:** repo has no RN component test harness; extract pure helpers where feasible
  (`formatClockTime`, `timelinePhases(order)`, `etaHeroView(eta, active, now)`) for unit tests
  if a seam exists; otherwise covered by typecheck + runtime/manual (stated honestly).

## Runtime verification plan (client UI → verify the data it consumes, per phase)
Walk one order through the transitions and confirm, via `GET /orders/:id` + `order:eta`, that
the UI has what each feature needs:
- **ETA Hero:** `eta {secondsRemaining, spreadSeconds, serverNow, source}` present pre-pickup
  (range) and at OFD (countdown source); `order:eta` pushes update it live (proven P3 wire).
- **Map gating:** `status` drives it — map data shown only at `picked_up`/`out_for_delivery`.
- **Timeline:** the phase timestamps (`confirmedAt/preparingAt/pickedUpAt/outForDeliveryAt/
  deliveredAt`) are populated as the order advances (verify via `GET`).
On-device render verified by construction + the live `order:eta` wire (no headless RN here).

## After implementation
`pnpm --filter @chirawa/api typecheck` (regression) + `pnpm --filter @chirawa/customer-app
exec tsc --noEmit` (must be 0) → `vitest run src/modules/orders` → runtime walk →
`TRACKING_V2_SPRINT2_IMPLEMENTATION_REPORT.md`. **No excluded items started.**
