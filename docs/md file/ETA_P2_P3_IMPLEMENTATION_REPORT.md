# ETA Hardening P2 + P3 — Implementation Report

**Scope:** P2 (#10 notification ordering) + P3 (#4 client `order:eta` subscription) only.
**Not modified:** ETA calculations, distance logic, Phase 2 live ETA, Redis ETA cache,
multi-shop ETA. **Tracking V2 not started.**

**Status:** Implemented on `fix/order-rider-id-identity` (on top of the committed ETA Phase
1, `7db0993`), **uncommitted**. Context7 not re-consulted — both changes are a pure reorder
of existing calls (P2) and a client-only socket listener (P3); no new library API.

## 1. Files changed
| File | Change | For |
|---|---|---|
| `apps/api/src/modules/delivery/dispatch.service.ts` | `riderAdvance`: `computeAndPersistEta` moved **before** `emitOrderStatusChanged` | P2 (OFD-critical) |
| `apps/api/src/modules/orders/orders.service.ts` | `updateOrderStatus`: same reorder | P2 (consistency) |
| `apps/customer-app/src/screens/orders/OrderTrackingScreen.tsx` | add `socket.on('order:eta', …)` (merge into `order.eta`) + `socket.off('order:eta')` cleanup | P3 |
| `apps/api/src/modules/delivery/__tests__/dispatch.eta-ordering.test.ts` *(new)* | ordering unit test | P2 |

No schema, no migration, no provider calls, no ETA-math/distance change. `.env.example`
left unstaged (pre-existing, unrelated).

## 2. The changes
**P2 — persist/emit ETA before the status event.** At each transition the ETA is now
recomputed, persisted, and `order:eta`-emitted *before* `ORDER_STATUS_CHANGED` fires, so the
`out_for_delivery` notification (which reads `estimatedDeliveryAt` off the status event) sees
the fresh, persisted value instead of the previous phase's / `'jaldi'`. Safe: the ETA call is
best-effort and provider-free (post-P1), so the status event still always fires, just
marginally later.

**P3 — consume `order:eta` on the client.** `OrderTrackingScreen` now listens for `order:eta`
and merges `{secondsRemaining, spreadSeconds, serverNow, source}` into `order.eta`, which the
header range + map badge already read — so the ETA updates on the push, not the 15 s poll.
The merge is idempotent (the dual-room order+user duplicate is harmless) and the listener is
torn down on cleanup.

## 3. Tests
- **Typecheck** `pnpm --filter @chirawa/api typecheck` → **29 = baseline (0 new errors)**.
  (The two `orders.service.ts:488/499` errors are the pre-existing `exactOptionalPropertyTypes`
  baseline — count unchanged.)
- **Unit** `vitest run src/modules/orders src/modules/delivery` → **79/79 pass (12 files)**,
  including the new `dispatch.eta-ordering.test.ts`: asserts
  `computeAndPersistEta.invocationCallOrder < emitOrderStatusChanged.invocationCallOrder` on
  `out_for_delivery` (the strict P2 ordering guarantee).
- P3 has no RN socket-UI test harness in this repo; covered by the end-to-end runtime proof
  below + the ordering of code (stated honestly, not faked).

## 4. Runtime verification (live API, real OTP, cleaned up)

### A — notification uses the fresh ETA (proves #10)
Seeded an FCM token (Redis) + an order, drove `…→ out_for_delivery`, read the persisted
`notifications` row:
```
persisted OFD ETA (GET /orders/:id) ≈ 13 min
notification body:  "Rider 13 minute mein pahunchega. Darwaza khula rakhein!"
notification ETA minutes = 13   |   persisted ETA minutes = 13   → MATCH ✓
```
The push now reflects the **real persisted ETA (13 min)** — not the old hardcoded `'30
minute'` and not the `'jaldi'` fallback — proving the notification reads the ETA persisted
*before* the status event. (The strict persist-before-emit ordering is also locked by the
unit test.)

### B — `order:eta` end-to-end (proves #4)
A Node `socket.io-client` logged in as the customer, subscribed to the order, and a
`seller→preparing` transition was triggered over HTTP:
```
socket connected + subscribed to order:f4caf185
>>> RECEIVED order:eta: {"orderId":"f4caf185…","secondsRemaining":1449,"spreadSeconds":300,
    "serverNow":"…","status":"preparing","source":"prep_road"}
triggered seller→preparing [HTTP 200]
RESULT B: client received order:eta within ~1s ✓ (no 15s poll needed)
```
The subscribed client received `order:eta` within ~1 s of the recompute — proving the
server→client wire the `OrderTrackingScreen` handler now consumes. (The event arrived twice =
the order-room + user-room dual emit; the client handler is idempotent, so it's harmless.)
The on-device re-render is driven by the handler's `setOrder({...prev, eta})`, which the
existing header/badge read — verified by construction; the literal RN render needs the app.

Cleanup verified: orders back to 54, no leftover order/notification rows, FCM token deleted,
rider set offline.

## 5. Not done (per instruction)
- **Tracking V2** — not started.
- Still out of scope (Phase 2/3): live/ping ETA recompute, Redis ETA cache, delay-sweep
  worker, multi-shop group ETA, traffic/weather.

## 6. Notes
- Changes **uncommitted** on `fix/order-rider-id-identity`. Natural follow-up commit:
  "fix(eta): notification ordering (#10) + client order:eta subscription (#4)".
- The dev API (tsx-watch) reloaded the P2 backend change; P3 is client-only (no server
  change). No restart needed.
