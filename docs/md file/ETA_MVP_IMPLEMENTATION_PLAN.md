# ETA — MVP Implementation Plan

**Design only. No code.** Source: `ETA_ARCHITECTURE.md` + `ETA_ARCHITECTURE_REVIEW.md`.

**MVP goal:** one server-computed, *honest, well-bounded* ETA — accurate enough to trust,
cheap enough to never blow up, robust to bad GPS — delivered in three phases. This is **not**
the full precision system (traffic-aware routing, learned prep, VRP multi-stop, weather APIs
are explicitly out of MVP — see §Out of scope).

## Hard constraints (cross-cutting invariants — apply to every task)

| # | Invariant | How it's enforced |
|---|---|---|
| C1 | **No provider calls on the live/ping path** | Distance Matrix reachable only via the isolated accessor (T1.3); `realtime.plugin`/ping code must not import it. Lint/review rule + a cost-guard test (T2.x) asserting 0 provider calls during simulated pings. |
| C2 | **No DB writes on the rider-ping path** | Ping recompute is Redis-read + emit only (T2.2). A test asserts `prisma.*.update` is never called from the ping handler. |
| C3 | **Google Distance Matrix only at phase transitions** | Only T1.5 (transition orchestrator) may call the accessor; fixed origin/dest pairs so the existing coordinate cache hits. Kill-switch (`AppConfig: eta.providerEnabled`) forces the local model. |
| C4 | **Reuse existing rider-location sockets** | Build on `rider:location`/`order:location` + Redis last-known + event-bus→socket bridge; add only `order:eta`. |
| C5 | **Use existing `Order.distanceKm`** | The placement/shop→customer leg uses the stored road distance; travel *time* derived locally (`distance ÷ effectiveSpeed`) — no new distance call needed for that leg. |

These directly resolve review findings **C1/C2/C3, S1/S2, F2/F3, F1, R3**.

**Severity legend:** Risk = Low/Med/High (chance×blast-radius). Complexity = S/M/L.

---

# Phase 1 — Milestone ETA (placement + transitions; persisted; surfaced)

*Outcome:* every order has a server ETA at placement that **tightens at each phase
transition**, shown as a **range**, present in `GET /orders/:id`, cost-bounded (provider
only at transitions). **No live ping recompute yet** — post-pickup ETA updates at the
`picked_up`/`out_for_delivery` transition only. This is the safest, highest-value slice and
the foundation for Phases 2–3.

### T1.1 — Schema additions (additive, nullable; no backfill)
- **Files:** `apps/api/prisma/schema.prisma` (+ generated migration).
- Add `Order.estimatedDeliveryAt`, `etaSpreadSeconds`, `etaComputedAt`, `etaSource`;
  `Order.preparingAt`, `readyAt`, `outForDeliveryAt` (phase timestamps for prep measurement,
  review A3/A1); `Shop.prepTimeMinutes`. Index `(status, estimatedDeliveryAt)` for the later
  delay sweep.
- **Risk:** Low (all nullable/additive; no data migration; forward-computed). Watch the Prisma
  rename/DROP gotcha is **N/A** here (pure adds).
- **Complexity:** S.
- **Dependencies:** none. (Independent of BUG-1 Phase 2's rename.)
- **Test plan:** migration applies on a clone; `prisma migrate diff` shows only `ADD COLUMN`;
  typecheck of the regenerated client.

### T1.2 — ETA config loader (`AppConfig`-backed, cached, with defaults)
- **Files:** `apps/api/src/modules/orders/eta.config.ts` (new); reads `AppConfig` (existing
  table, currently unused) with safe defaults.
- Keys: `eta.townSpeedKmph`, `eta.roadFactor`, `eta.prepDefaultMinutes`,
  `eta.pickupDwellMinutes`, `eta.handoverMinutes`, `eta.spreadSeconds`, `eta.minMinutes`
  (floor, review E2), `eta.providerEnabled` (kill-switch, review C2/C3).
- **Risk:** Low.
- **Complexity:** S.
- **Dependencies:** T1.1 not required; standalone.
- **Test plan:** unit — defaults when keys absent; override when present; cache TTL; invalid
  values fall back to default (never throw).

### T1.3 — Provider isolation accessor + kill-switch
- **Files:** `apps/api/src/modules/orders/eta.distance.ts` (new), wrapping
  `pricing/distance.service.ts` (existing cached Distance Matrix + haversine fallback).
- Single choke point for any provider distance call; honors `eta.providerEnabled` (off ⇒
  local haversine×roadFactor only). **Not importable** from socket/ping code (module-boundary
  rule + review note).
- **Risk:** Med — this is the cost firewall (review C1/C2/C3); a leak here is the only
  irreversible risk.
- **Complexity:** S.
- **Dependencies:** T1.2.
- **Test plan:** unit — kill-switch off ⇒ zero provider calls (spy); fixed-pair lookups hit
  cache; fallback on provider error. **Architecture test:** static check / lint that
  `realtime.plugin` and any ping module do not import `eta.distance`.

### T1.4 — Pure ETA compute (`eta.service` pure fns)
- **Files:** `apps/api/src/modules/orders/eta.service.ts` (new).
- `computeEta({ phase, prepRemainingMin, travelMin, dwellMin, handoverMin, spread, floorMin })
  → { estimatedDeliveryAt, spreadSeconds, source }`. Models **all four terms** (prep + travel +
  pickup dwell + handover, review A1), applies the floor (E2), and yields a **wide-range
  fallback** when inputs are missing (review F1) — never a confident single wrong value.
- **Risk:** Low (pure).
- **Complexity:** M.
- **Dependencies:** T1.2.
- **Test plan:** unit table — each phase formula; short-distance floor; missing-input ⇒ wide
  range + `source='fallback'`; monotonic sanity (more prep ⇒ later ETA).

### T1.5 — Transition orchestrator `computeAndPersistOnTransition(orderId)`
- **Files:** `eta.service.ts`; reads order/shop/rider; uses `Order.distanceKm` for the
  shop→customer leg (C5), and **only here** may call T1.3 for legs not covered by
  `distanceKm` (e.g., rider→shop at assignment) — fixed pairs ⇒ cache-friendly. Persists the
  eta fields (review S1: persist on transitions only). Emits `ORDER_ETA_CHANGED`. Wrapped in
  try/catch — **best-effort, never blocks order flow**.
- **Risk:** Med (touches the transition path; must not break order completion — mirror BUG-2's
  defensive pattern).
- **Complexity:** M.
- **Dependencies:** T1.3, T1.4, T1.7.
- **Test plan:** service test (mock prisma) — persists expected `estimatedDeliveryAt` per
  phase; flat-fee path (`distanceKm=0/'flat'`) falls back to a distance lookup or range; a
  thrown lookup ⇒ order unchanged, no throw; emits the event once.

### T1.6 — Wire transitions + phase timestamps
- **Files:** `apps/api/src/modules/orders/orders.service.ts` (`updateOrderStatus` — stamp
  `preparingAt`/`readyAt`/`outForDeliveryAt`; call T1.5), `codCollected`, `markDelivered`,
  `placeOrder` (initial compute); `apps/api/src/modules/delivery/dispatch.service.ts`
  (`assignOrder`, `riderAdvance`), `batching.service.ts`.
- Anchor `prepRemaining` on **`sellerAcceptedAt`**, not `confirmedAt` (review A3).
- **Risk:** Med — edits hot transition code; keep ETA calls non-blocking/async-after-commit
  (review F4) so checkout/transition latency is unaffected.
- **Complexity:** M.
- **Dependencies:** T1.1, T1.5.
- **Test plan:** extend existing `orders` suite (delivered/cod-collected/transitions tests) to
  assert timestamps are stamped and ETA recompute is invoked; assert transitions still pass
  the state machine; assert order flow is unaffected if ETA throws.

### T1.7 — `order:eta` event (bus + socket bridge)
- **Files:** `apps/api/src/shared/events/event-bus.ts` (add `ORDER_ETA_CHANGED` + emit fn +
  payload type), `apps/api/src/shared/plugins/realtime.plugin.ts` (bridge → `order:eta` to
  `order:{id}` + `user:{customerId}`, mirroring `ORDER_STATUS_CHANGED`).
- **Payload:** `{ orderId, secondsRemaining, spreadSeconds, serverNow, phase, source }` —
  **duration + server clock, not a bare absolute timestamp** (review F3).
- **Risk:** Low (reuses the proven pattern).
- **Complexity:** S.
- **Dependencies:** event-bus.
- **Test plan:** unit — emit maps to the right rooms; payload carries duration + serverNow.

### T1.8 — Surface ETA in `GET /orders/:id` (poll fallback)
- **Files:** `apps/api/src/modules/orders/orders.service.ts` (`getOrder` return),
  `packages/types/src/dto/order.dto.ts` (additive `eta?: { secondsRemaining; spreadSeconds;
  serverNow; source }`), `packages/api-client/src/index.ts` (types).
- **Mandatory** (review F2): the 15 s poll is the reconciliation path if a socket publish
  drops. Additive field — no DTO redesign.
- **Risk:** Low.
- **Complexity:** S.
- **Dependencies:** T1.5. (Coexists cleanly with the shipped BUG-2 `rider` block in `getOrder`.)
- **Test plan:** service test — `getOrder` includes `eta` when computed, omits/wide-range when
  not; runtime: customer `GET` shows the eta block.

### T1.9 — Client consumes server ETA (retire the fakes)
- **Files:** `apps/customer-app/src/screens/orders/OrderTrackingScreen.tsx` (header), 
  `apps/customer-app/src/components/tracking/TrackingMap.tsx` (badge).
- Header shows the server **range** (pre-OFD) / value; map badge consumes server ETA. Remove
  the hardcoded `~20 min` (`OrderTrackingScreen.tsx:656`) and the straight-line ÷20 calc as the
  *source of truth* (keep straight-line only as a last-ditch offline fallback).
- **Risk:** Low-Med (UI; ensure graceful when `eta` absent → "calculating…").
- **Complexity:** M.
- **Dependencies:** T1.8.
- **Test plan:** component test — renders range vs value vs "calculating…"; no crash when `eta`
  undefined; manual device check on a live order.

**Phase 1 acceptance:** order created → `estimatedDeliveryAt` set within seconds (async),
tightens at each transition; `GET /orders/:id` returns the eta block; `order:eta` fires on
transitions; provider called **only** at transitions (cache-friendly); kill-switch forces the
local model; the three fake values are gone. Cost is bounded to ~1–2 cache-friendly provider
calls/order.

---

# Phase 2 — Live ETA on the ping path (Redis + emit only)

*Outcome:* post-pickup ETA updates **as the rider moves**, with **zero provider calls** (C1)
and **zero DB writes** (C2) on the ping path; off the broadcast hot path (review S2); GPS-noise
and staleness handled.

### T2.1 — Redis ETA-input cache (populated at assignment)
- **Files:** `dispatch.service.ts`/`batching.service.ts` (on assign), `eta.service.ts` (cache
  read/write helpers).
- At assignment, write `eta:order:{id}` → `{ shopLat/Lng, dropLat/Lng, prepRemaining, phase,
  riderUserId }` (TTL ~ order lifetime). The ping path reads **only** this (no Postgres — S3/C2).
- **Risk:** Med (cache/DB drift — stale phase in Redis; mitigate by refreshing on transitions).
- **Complexity:** M.
- **Dependencies:** Phase 1 (T1.5 refreshes the cache on transitions).
- **Test plan:** unit — cache populated at assign, refreshed on transition, expires; ping read
  uses cache only (spy: no `prisma` calls).

### T2.2 — Live recompute in the `rider:location` handler
- **Files:** `apps/api/src/shared/plugins/realtime.plugin.ts`.
- From cached inputs (T2.1): `travel = haversineMeters(rider, target) × roadFactor ÷
  effectiveSpeed` (target = shop if not picked up, else customer). **No provider** (C1), **no DB
  write** (C2). Run **off** the location broadcast (don't await — review S2). Debounce: emit
  `order:eta` only if `secondsRemaining` shifts > ~60 s.
- **Risk:** High — this is the constraint-critical task; a regression here (provider/DB on the
  hot path) is the headline cost/scale risk.
- **Complexity:** M.
- **Dependencies:** T2.1, T1.7.
- **Test plan:** **cost-guard test** — simulate N pings; assert **0** provider calls and **0**
  `prisma.*.update` calls; emit only on >60 s shift; broadcast latency unaffected (ETA runs
  async). Unit — target selection by phase; debounce threshold.

### T2.3 — id-space resolution for the location key (review R3)
- **Files:** `realtime.plugin.ts` / `eta.service.ts`.
- `Order.riderId` is the **RiderProfile.id**; the Redis location key is
  **`rider:{userId}:location`**. Resolve `riderProfileId → userId` **once** (cache in T2.1's
  blob) and read the correct key. (Same id-space landmine as BUG-1.)
- **Risk:** Med (silent "no location" if wrong — degrades ETA invisibly).
- **Complexity:** S.
- **Dependencies:** T2.1.
- **Test plan:** unit asserting the key read is `rider:{userId}:location`, not
  `rider:{riderProfileId}:…`; integration with a seeded assigned order.

### T2.4 — Staleness & ping-starvation handling (review R1/R4)
- **Files:** `realtime.plugin.ts`, client.
- Carry `ageMs`; widen `spreadSeconds` as age grows; past a freshness threshold stop the precise
  countdown and emit "location updating…"; detect ping gaps (rider app backgrounded) and degrade
  to the distance/speed estimate.
- **Risk:** Med (Android background-location is a real ops failure — review R1).
- **Complexity:** M.
- **Dependencies:** T2.2. (Rider-app foreground-service work is a **separate** rider-app task —
  flag as a dependency, not in this backend plan.)
- **Test plan:** unit — band widens with age; "updating" past threshold; no precise countdown on
  stale fix.

### T2.5 — Client live countdown (post-pickup)
- **Files:** `OrderTrackingScreen.tsx`, `TrackingMap.tsx`.
- Count down locally from `secondsRemaining` + `serverNow` (clock-skew safe — review F3);
  reconcile on each `order:eta` / 15 s poll; smooth jumps.
- **Risk:** Low-Med.
- **Complexity:** M.
- **Dependencies:** T2.2, T1.9.
- **Test plan:** component — counts down; reconciles on push; tolerant of skew & missing pushes.

**Phase 2 acceptance:** during `picked_up`/`out_for_delivery`, the ETA updates live as the
rider moves; provider-call count and order-row writes attributable to pings are **zero**
(proven by the cost-guard test); stale GPS degrades gracefully.

---

# Phase 3 — Robustness, delay, multi-shop, accuracy

*Outcome:* operationally honest MVP — proactive delays, multi-shop handled conservatively,
calibrated speeds, and basic accuracy observability.

### T3.1 — Delay-sweep worker (proactive lateness)
- **Files:** `apps/api/src/modules/delivery/` new BullMQ plugin (pattern: `dispatch.plugin.ts`);
  `notifications/notification.templates.ts` (replace hardcoded `'30 minute'`).
- Periodic (60–120 s) bounded query on `(status, estimatedDeliveryAt)`; flag `now > eta +
  graceMinutes` with **hysteresis** (one "running late" transition; no re-spam — review F5);
  send proactive FCM with the *real* ETA. No ping-path coupling.
- **Risk:** Med (notification spam if hysteresis is wrong).
- **Complexity:** M.
- **Dependencies:** Phase 1 (persisted `estimatedDeliveryAt`).
- **Test plan:** unit — flags only past grace; fires once; suppresses until material change;
  query bounded/indexed.

### T3.2 — Multi-shop group ETA (`getOrderGroup`)
- **Files:** `apps/api/src/modules/orders/orders.service.ts` (`getOrderGroup`), `eta.service.ts`.
- Per-child **phase-aware** ETA; group rule = **slowest live child** (review M1/M2). If a batch
  is one rider over ordered stops, use the **ordered-stop legs** from `getActiveDelivery` (ETA =
  cumulative legs to *this* stop — review E3). If children are on **different riders**, expose
  **per-child** ETAs + a partial-delivery summary (review M3) rather than a single misleading
  `max`.
- **Risk:** High (this is the genuinely hard area — keep MVP conservative; do **not** attempt
  full VRP optimization).
- **Complexity:** L.
- **Dependencies:** Phase 1; benefits from Phase 2 for live legs.
- **Test plan:** unit — per-child phase formulas; group = slowest; batched ordered-stop
  cumulative legs; cross-rider ⇒ per-child surfaced; child cancellation recomputes.

### T3.3 — Reassignment recompute (review F6)
- **Files:** `eta.service.ts`, `orders.service.ts` (`releaseOrderAssignment`),
  `dispatch.service.ts`.
- On rider release/change, reset the pickup leg; if unassigned, revert to the pre-assignment
  (prep + placement-distance) estimate with a wider band; refresh the Redis cache (T2.1).
- **Risk:** Med.
- **Complexity:** M.
- **Dependencies:** Phase 1, T2.1.
- **Test plan:** unit — riderId→null reverts to pre-assignment ETA; rider change recomputes from
  the new position; no crash on null.

### T3.4 — Calibration + accuracy logging (review A2/A3)
- **Files:** `eta.service.ts` (log predicted vs `deliveredAt`); optional small `EtaSnapshot`
  table or derive from `estimatedDeliveryAt` + `deliveredAt`/`OrderStatusHistory`.
- Compute MAE per shop/zone/hour; tune `townSpeedKmph` / `prepTimeMinutes` via `AppConfig`
  (no redeploy). Add shop-closed gating (review E1) and the short-distance floor (E2) to compute.
- **Risk:** Low.
- **Complexity:** M.
- **Dependencies:** Phase 1.
- **Test plan:** backtest on logged data; assert MAE computed; config tuning changes output;
  shop-closed orders don't emit a bogus precise ETA.

### T3.5 — UI states: "Arriving" + "running late"
- **Files:** `OrderTrackingScreen.tsx`, `TrackingMap.tsx`.
- "Arriving" via geofence **combined** with rider-dwell / a rider "reached" signal (don't trust
  the drop pin alone — review A5/E5); "running late" banner from T3.1.
- **Risk:** Low-Med (bad pins → false "arriving").
- **Complexity:** M.
- **Dependencies:** T3.1, Phase 2.
- **Test plan:** component — states render; "arriving" needs geofence + dwell, not pin alone.

**Phase 3 acceptance:** late orders proactively message (once); multi-shop shows a defensible
group/per-child ETA + partial progress; ETAs calibratable from real data without redeploy;
reassignment doesn't strand the ETA.

---

## Dependency graph (summary)
- **Prereq:** BUG-1 (shipped) — `Order.riderId` semantics; T2.3 relies on it.
- **Phase 1:** T1.1→{T1.5,T1.6}; T1.2→{T1.3,T1.4}; {T1.3,T1.4,T1.7}→T1.5→{T1.6,T1.8}→T1.9.
- **Phase 2:** Phase 1 → T2.1→{T2.2,T2.3}; T2.2→{T2.4,T2.5}. (T2.4 also needs a **rider-app
  foreground-location** task — external dependency.)
- **Phase 3:** Phase 1 → {T3.1,T3.2,T3.3,T3.4}; Phase 2 → {T3.2 live legs, T3.5}.

## Out of MVP scope (architecture P2/P3 — not this plan)
- Traffic-aware routing (`duration_in_traffic` / Mappls route ETA) on the active leg.
- Learned per-shop × hour-of-day prep times (MVP uses a calibrated constant).
- Full vehicle-routing optimization for batches (MVP uses fixed ordered-stop legs).
- Weather **API** (MVP uses an ops-toggled `AppConfig` multiplier only).
- Rider-app foreground-location service is a **dependency**, owned by the rider-app track.

## Test strategy (applies across phases)
- **Unit:** pure compute (T1.4), config (T1.2), provider isolation (T1.3).
- **Service (mock prisma):** transition persistence (T1.5/T1.6), getOrder/getOrderGroup ETA.
- **Cost/scale guards (mandatory):** assert **0 provider calls** and **0 DB writes** on the ping
  path (T2.2) — these protect the headline constraints and must be CI-enforced.
- **Runtime (existing harness pattern):** seed + assign + advance statuses → assert `eta` in
  `GET /orders/:id`, `order:eta` emitted, range pre-OFD → countdown post-pickup, fallback wide
  range when provider is killed.
- **Accuracy (Phase 3):** backtest predicted vs actual; MAE thresholds before tuning.
