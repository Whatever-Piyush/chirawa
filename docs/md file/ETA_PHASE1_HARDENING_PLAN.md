# ETA Phase 1 — Hardening Plan

**Design only — no code.** Scopes exactly three findings from `ETA_PHASE1_REVIEW.md`,
prioritized:

| Priority | Finding | Severity |
|---|---|---|
| **P1** | #6 — `distanceKm = 0` ⇒ ETA always the fallback | 🟠 High |
| **P2** | #10 — OFD notification reads ETA before it's recomputed | 🟡 Medium |
| **P3** | #4 — `order:eta` emitted but client never subscribes | 🟡 Medium |

Sequencing rationale: **P1 first** (it's the value bug, and it keeps `computeEta` pure/
fast — no provider — which makes P2's reorder safe). **P2** next (correctness of the live
push the customer already receives). **P3** last (delivers the live ETA to the UI — most
valuable once P1 makes the ETA real). The three are otherwise independent.

Out of scope: every other review finding (#2 race, #3 rollback, #5/#7/#8/#9, etc.).

---

## P1 — #6 `distanceKm` bug (HIGH)

### Root cause
`placeOrder` hardcodes `distanceKm: 0, distanceSource: 'flat'` on every created order
(`apps/api/src/modules/orders/orders.service.ts:288`) — the delivery **fee** is flat, so the
distance was never computed. `computeEta` treats `distanceKm <= 0/null` as *unknown* and
returns the wide **fallback** (`eta.service.ts`). DB confirms 51/54 orders are `flat`/0.000.
Result: no real order ever uses a per-order (distance-based) ETA.

### Fix (recommended): derive the leg from the coordinates the order already stores
Compute the shop→customer leg from `Shop.lat/lng` + `Order.deliveryLat/deliveryLng` (both
non-null) via `haversineMeters` (`shared/utils/geo.ts`) × a road-factor (~1.3), in
`eta.service`. **No provider call, no schema change, no migration, no checkout latency** — a
pure calc inside the existing recompute. This gives every order a real per-order distance and
retires the fallback for any order with coordinates (which is all of them). It also fixes the
secondary "`> 0` misclassifies a legitimate near-zero distance" nuance — haversine yields a
real value, and the existing floor handles tiny distances.
- Leave `Order.distanceKm`/`distanceSource` (the **billing** field) untouched.
- A later phase may upgrade the leg to the cached `pricing/distance.service` (Google Distance
  Matrix, road distance) for accuracy — **out of scope for hardening**; haversine×road-factor
  is the minimal, constraint-clean fix now.

### Exact files affected
- `apps/api/src/modules/orders/eta.service.ts` — (a) add `shop.lat`, `shop.lng`,
  `deliveryLat`, `deliveryLng` to the `findUnique` select in `computeAndPersistEta`;
  (b) compute `legKm = haversineMeters(shop, drop)/1000 * ROAD_FACTOR`; (c) feed it to
  `computeEta` in place of the billing `distanceKm`; add `ROAD_FACTOR` to the tunables. Import
  `haversineMeters` from `../../shared/utils/geo`.
- `apps/api/src/modules/orders/__tests__/eta.service.test.ts` — update the compute tests to
  pass coordinates (or the derived `legKm`) instead of `distanceKm`; keep the fallback test for
  the genuinely-missing-coords case.
- **No** schema/migration. **No** change to `placeOrder`'s billing fields.

### Risk
**Low.** Pure arithmetic over already-stored, non-null data; no provider, no migration, no
checkout-path latency. The only inaccuracy is the road-factor estimate (calibration is Phase 3).
Edge cases: identical shop/drop coords → ~0 leg → covered by the existing ETA floor; the
fallback path now only triggers if coords are somehow absent.

### Test plan
- Unit (`eta.service.test.ts`): given shop+drop coords ~2 km apart, `computeEta` returns
  `source` = distance-based (not `fallback`) with travel ≈ `legKm/townSpeed`; a near-zero leg
  floors to `minMinutes`; missing coords → fallback.
- `computeAndPersistEta`: mock prisma returns shop lat/lng + delivery lat/lng → persists a
  non-fallback ETA; asserts the `findUnique` select includes the coords.
- Regression: existing orders suite stays green; `getOrder` eta-block tests unaffected.

### Runtime verification plan
Reuse the `eta_verify` harness pattern but **without** seeding `distanceKm` (leave it
`0/'flat'`, like a real order). Seed an order, set the customer drop ~2 km from the Chirawa
Store coords, walk the transitions, and assert `GET /orders/:id` `eta.source` is **distance-
based** (not `fallback`) and `secondsRemaining` scales with the seeded drop distance (move the
drop closer → smaller ETA). The pre-fix run shows `source='fallback'` for the same un-seeded
order; the post-fix run shows a real per-order ETA. Clean up the test rows.

---

## P2 — #10 Notification ordering (MEDIUM)

### Root cause
At the `out_for_delivery` transition, the status event is emitted **before** the ETA is
recomputed/persisted:
- `dispatch.service.ts` `riderAdvance`: `emitOrderStatusChanged(...)` at `:220` runs
  **before** `await computeAndPersistEta(...)` at `:226`.
The notifications plugin listens to `ORDER_STATUS_CHANGED` and reads `estimatedDeliveryAt` for
the OFD push (`notifications.plugin.ts`), so it sees the **pre-OFD** ETA (or null →
`'jaldi'`). The pushed minutes won't match the in-app OFD ETA.

### Fix: persist the ETA *before* emitting the status event
Reorder the transition sites so `await computeAndPersistEta(...)` runs **before**
`emitOrderStatusChanged(...)`. After the status `$transaction` commits, `computeAndPersistEta`
reads the new status, persists the OFD ETA (and emits `order:eta`), and only then is
`ORDER_STATUS_CHANGED` emitted — so the notification reads the fresh, persisted ETA. Safe
because, after P1, `computeAndPersistEta` is pure + one `update` (no provider) → negligible
added latency to the status event. (Also tightens the client `order:status`→`order:eta`
ordering.)

### Exact files affected
- `apps/api/src/modules/delivery/dispatch.service.ts` — `riderAdvance`: move
  `computeAndPersistEta` above `emitOrderStatusChanged` (the OFD-critical site).
- `apps/api/src/modules/orders/orders.service.ts` — `updateOrderStatus`: same reorder for
  consistency (covers `confirmed`/`preparing`/`ready`/`cancelled`).
- *(Optional, defensive)* `apps/api/src/modules/notifications/notifications.plugin.ts` — leave
  the `'jaldi'` fallback for a still-null ETA; no change required if the reorder lands.
- Tests: `apps/api/src/modules/orders/__tests__/` (extend the delivered/transition tests).

### Risk
**Low.** Reordering two already-`await`ed calls. `computeAndPersistEta` is best-effort (swallows
errors), so the status emit still fires even if ETA computation fails (it's now after). The
status socket event arrives marginally later (one fast local update) — acceptable, and it makes
status+ETA consistent.

### Test plan
- Ordering unit test (mock spies): in `riderAdvance` / `updateOrderStatus`, assert the ETA
  persist (`prisma.order.update` with eta fields, or the `emitOrderEtaChanged` spy) has a lower
  `mock.invocationCallOrder` than the `emitOrderStatusChanged` spy — i.e., ETA is persisted/
  emitted **before** the status event.
- Regression: existing transition/delivered tests stay green.

### Runtime verification plan
Trigger `out_for_delivery` and confirm the OFD push reflects the OFD ETA.
- Primary: query the `notifications` table for the `out_for_delivery` row and assert its
  `body` minutes match `orders.estimated_delivery_at − now` at send time (the handler's
  `logNotification` records the body).
- **Caveat:** the push (and its log row) only fires when the customer has an FCM token; in dev
  there may be none, so seed a token for the test customer (or temporarily stub `getToken`) to
  exercise the path — note this in the run. If a token can't be arranged in dev, fall back to
  the ordering unit test as the gate and verify the push body in staging with a real token.
- Negative control: the pre-fix run yields a push minutes value that **diverges** from the
  in-app OFD `eta`; post-fix they agree.

---

## P3 — #4 `order:eta` client subscription (MEDIUM)

### Root cause
The server emits `order:eta` (`realtime.plugin.ts`), but `OrderTrackingScreen` subscribes only
to `order:status` (`:471`) and `order:location` (`:476`) — there is **no `order:eta`
listener**. So the live push is unconsumed; ETA updates only on the 15 s poll, and
`order:status` updates status locally without refetch, so status and ETA can disagree for up to
15 s.

### Fix: subscribe to `order:eta` on the client and merge it into the order
Add a `socket.on('order:eta', …)` handler in `OrderTrackingScreen` that, for the matching
`orderId`, merges the payload (`secondsRemaining`, `spreadSeconds`, `source`) into the order's
`eta` so the header range + map badge reflect the pushed value immediately (closing the ≤15 s
gap). Register/clean up the listener alongside the existing ones; the merge is idempotent so
the dual-room duplicate emit (order room + user room) is harmless. (Local countdown
interpolation between pushes is **Phase 2** — out of scope; this just applies each pushed value.)

### Exact files affected
- `apps/customer-app/src/screens/orders/OrderTrackingScreen.tsx` — add the `order:eta`
  listener (filter by `orderId`; `setOrder(prev => prev ? { ...prev, eta: { secondsRemaining,
  spreadSeconds, serverNow, source } } : prev)`); add `socket.off('order:eta')` to the cleanup
  next to the existing `off('order:status')` / `off('order:location')`.
- *(No server change — the event already exists. No DTO change — `eta` already on
  `OrderDetailResponse`.)*

### Risk
**Low.** Client-only, additive listener; no new server surface. Map the socket payload
(`{orderId, secondsRemaining, spreadSeconds, serverNow, status, source}`) to the `eta` shape
the UI already reads. Ensure cleanup to avoid a listener leak on unmount/re-subscribe.

### Test plan
- If the app has a unit-testable seam, extract and test the `order:eta` reducer (payload →
  merged `eta`; ignores non-matching `orderId`; idempotent on duplicate). Otherwise this is a
  runtime/manual check (RN socket UI is not unit-tested in this repo today) — state that
  explicitly rather than claim coverage.

### Runtime verification plan
Prove the server→client delivery (the missing half) with a **Node `socket.io-client`** script
(no app needed):
1. OTP-login the test customer; open a socket with the access token; `emit('order:subscribe',
   orderId)`.
2. Trigger a transition over HTTP (e.g., `ready → picked_up`).
3. Assert the script receives an `order:eta` event for that `orderId` within ~1 s, with a
   plausible `secondsRemaining`/`spreadSeconds` — proving the event reaches a subscribed client.
4. The in-app UI update (header/badge changing without waiting for the 15 s poll) is verified
   manually in the app.
Clean up the test order. Pre-fix, the app ignores this event; post-fix, the handler applies it.

---

## Cross-cutting notes
- **Dependencies:** P1 should land first (makes `computeEta` produce real values and keeps it
  provider-free, which P2's reorder relies on for low latency). P2 and P3 are independent of
  each other.
- **No migrations** in any of the three (P1 uses existing coords; P2 reorders calls; P3 is
  client-only).
- **Re-test after all three:** full `pnpm --filter @chirawa/api typecheck` (expect baseline
  unchanged) + `vitest run src/modules/orders`, then a combined runtime pass (real-distance ETA
  → correct OFD push → client receives `order:eta`).
