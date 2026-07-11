# ETA Hardening P2 + P3 — Changeset (pre-implementation)

Scope: **P2 (#10 notification ordering)** + **P3 (#4 client `order:eta` subscription)** only.
**Do NOT touch:** ETA calculations, distance logic, Phase 2 live ETA, Redis ETA cache,
multi-shop ETA.

## 1. Exact files affected
**P2 — persist ETA before emitting the status event (so `ORDER_STATUS_CHANGED` consumers read fresh ETA)**
- `apps/api/src/modules/delivery/dispatch.service.ts` — `riderAdvance`: move
  `await computeAndPersistEta(...)` **above** `emitOrderStatusChanged(...)` (the OFD-critical path).
- `apps/api/src/modules/orders/orders.service.ts` — `updateOrderStatus`: same reorder for
  consistency (confirmed/preparing/ready/cancelled).
- *(No change to `notifications.plugin.ts` — its `out_for_delivery` handler already reads
  `estimatedDeliveryAt`; after the reorder that read is fresh. Its `'jaldi'` fallback stays.)*

**P3 — consume `order:eta` on the client**
- `apps/customer-app/src/screens/orders/OrderTrackingScreen.tsx` — add a `socket.on('order:eta', …)`
  listener (filter by `orderId`; merge `{secondsRemaining, spreadSeconds, serverNow, source}`
  into `order.eta`); add `socket.off('order:eta')` to the cleanup.

**Tests**
- `apps/api/src/modules/delivery/__tests__/dispatch.eta-ordering.test.ts` (new) — ordering assertion.

**Not modified:** `eta.service.ts` (calc/distance untouched), any Phase-2/Redis/multi-shop code.

## 2. Risks
- **P2 (Low):** reordering two already-`await`ed calls. `computeAndPersistEta` is best-effort
  (swallows errors) and provider-free (fast, post-P1), so the status event fires marginally
  later but always fires. Net: status + ETA become consistent.
- **P3 (Low):** client-only, additive listener. Payload→`eta` mapping is idempotent, so the
  dual-room duplicate emit (order room + user room) is harmless; must add cleanup to avoid a
  listener leak.
- No schema, no migration, no provider calls, no ETA-math change.

## 3. Tests to add
- **P2 unit (`dispatch.eta-ordering.test.ts`):** mock `eta.service.computeAndPersistEta` +
  `event-bus.emitOrderStatusChanged`; drive `riderAdvance` (`startDelivery` → out_for_delivery)
  with a mock prisma; assert `computeAndPersistEta.mock.invocationCallOrder[0] <
  emitOrderStatusChanged.mock.invocationCallOrder[0]` (ETA persisted/emitted **before** the
  status event).
- **Regression:** full `vitest run src/modules/orders` + `src/modules/delivery` stay green.
- **P3:** no RN component test harness exists in this repo for socket UI; covered by the
  end-to-end runtime proof below + code review of the handler (stated honestly, not faked).

## 4. Runtime verification plan
**A — notification uses fresh ETA (proves #10):** FCM tokens live in Redis
(`fcm:token:{userId}`) and `sendPush` no-ops+logs in dev (no throw), so `logNotification`
writes a `notifications` row. Steps: seed a Redis FCM token for the test customer → seed an
order with real drop coords → drive `ready → picked_up → out_for_delivery` over HTTP → read
the `notifications` row for `event_type='out_for_delivery'` and assert its **body minutes**
match `orders.estimated_delivery_at − now` (the persisted, post-OFD ETA). Pre-fix the body
would reflect the pre-OFD/`'jaldi'` value; post-fix it matches. Clean up token + rows.

**B — `order:eta` end-to-end (proves #4):** use a Node `socket.io-client` (installed) as the
test customer:
1. OTP-login → open socket with the access token → `emit('order:subscribe', orderId)`.
2. Trigger a transition over HTTP (`preparing`/`ready`) to force an ETA recompute.
3. Assert the client **receives an `order:eta`** event for that `orderId` within ~1 s, with a
   plausible `secondsRemaining`/`spreadSeconds` — proving the server→subscribed-client wire.
4. The `OrderTrackingScreen` handler (new) merges that payload into `order.eta`, which the
   header + map badge already read → UI updates on the push, not the 15 s poll. (The literal
   on-device re-render needs the app; the wire is proven live and the handler is verified by
   construction — stated honestly.)

## 5. After implementation
`pnpm --filter @chirawa/api typecheck` (expect baseline unchanged) → `vitest run
src/modules/orders src/modules/delivery` → runtime A + B → `ETA_P2_P3_IMPLEMENTATION_REPORT.md`.
**Do not start Tracking V2.**
