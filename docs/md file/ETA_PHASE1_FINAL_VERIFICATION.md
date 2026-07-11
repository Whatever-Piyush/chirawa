# ETA Phase 1 — Final End-to-End Verification

Consolidated verification of ETA Phase 1 (incl. P1 #6, P2 #10, P3 #4) across all 10
required points. Evidence is drawn from the prior verification passes
(`ETA_PHASE1_IMPLEMENTATION_REPORT.md`, `P1_IMPLEMENTATION_REPORT.md`,
`ETA_P2_P3_IMPLEMENTATION_REPORT.md`) **plus a fresh final pass** run for the points not
previously shown directly (placement via a real checkout, no-provider-calls, no-DB-writes on
the push path). No code was modified. Environment: live dev API (`:3000`), real OTP login,
all test data cleaned up.

## Verdict: all 10 points PASS ✅

| # | Point | Result | Source |
|---|---|---|---|
| 1 | Order placement ETA | ✅ real COD checkout → `confirmed`, eta `prep_road` 1099s | **Final pass** |
| 2 | Preparing ETA | ✅ `prep_road`, ~1294–1449s, spread 300 | Phase 1 / P2-P3 |
| 3 | Ready ETA | ✅ tightens to ~814–969s | Phase 1 / P1 |
| 4 | Out-for-delivery ETA | ✅ ~634–786s, spread **120** | Phase 1 / P1 |
| 5 | Notification ETA | ✅ push body "13 minute" == persisted 13 min (not '30 min'/'jaldi') | P2 |
| 6 | Socket ETA (`order:eta`) | ✅ subscribed client received it < ~1s | P3 |
| 7 | API ETA (`GET /orders/:id`) | ✅ `eta {secondsRemaining, spreadSeconds, serverNow, source}` | all passes |
| 8 | Poll fallback | ✅ same `GET` carries `eta`; client polls every 15s | all passes |
| 9 | No provider calls | ✅ ETA path imports only Prisma/event-bus/Haversine | **Final pass (code)** |
| 10 | No DB writes on ETA push path | ✅ `order:eta` socket handler has no `prisma` | **Final pass (code)** |

Supporting: `pnpm --filter @chirawa/api typecheck` → **29 = baseline (0 ETA-introduced
errors)**; `vitest run src/modules/orders src/modules/delivery` → **79/79 pass** (incl.
`eta.service` 13 + `dispatch.eta-ordering` 1).

---

## Detail & evidence

### 1. Order placement ETA — Final pass (real checkout)
Real COD checkout (`POST /cart/items` → `POST /orders`), customer's real address
(Ward no. 24, ~0.95 km from the shop):
```
placed: { orderId: f0be634a…, status: 'confirmed', totalAmount: 15000 }
GET /orders/f0be634a…  →  status=confirmed  distanceKm(billing)=0
  eta = { secondsRemaining: 1099, spreadSeconds: 300, serverNow: …, source: 'prep_road' }
```
A genuinely-placed order gets a **distance-based** placement ETA immediately — `prep_road`,
not `fallback`, despite the billing `distanceKm = 0` (also re-confirms the #6 fix on the live
checkout path). Order cleaned up.

### 2–4. Phase ETAs tighten across the lifecycle
From the Phase-1 and P1 runtime walks (one order through the transitions):
```
preparing        → secondsRemaining 1294–1449  spread 300  source prep_road
ready_for_pickup → 814–969  (prep complete → shorter)
picked_up        → spread tightens to 120
out_for_delivery → 634–786  spread 120
```
ETA decreases as prep completes and the spread narrows at pickup — exactly the milestone
model. (`ETA_PHASE1_IMPLEMENTATION_REPORT.md` §6; `P1_IMPLEMENTATION_REPORT.md` §4.)

### 5. Notification ETA — P2
OFD push read the fresh persisted ETA:
```
persisted OFD ETA (GET) ≈ 13 min
notification body: "Rider 13 minute mein pahunchega…"   → 13 == 13  MATCH
```
Proves #10: the push uses the ETA persisted **before** the status event (no longer the
hardcoded '30 minute' / 'jaldi'). Strict ordering also locked by the unit test
(`dispatch.eta-ordering.test.ts`: `computeAndPersistEta` invoked before `emitOrderStatusChanged`).

### 6. Socket ETA — P3
A Node `socket.io-client` as the customer, subscribed to the order:
```
>>> RECEIVED order:eta {"orderId":"f4caf185…","secondsRemaining":1449,"spreadSeconds":300,"source":"prep_road","status":"preparing"}
RESULT: received within ~1s of the transition ✓ (no 15s poll needed)
```
The `OrderTrackingScreen` handler merges this into `order.eta` (the header/badge read it), so
the UI updates on the push. (Arrived twice = order-room + user-room dual emit; handler is
idempotent.)

### 7. API ETA — all passes
`GET /orders/:id` returns `eta { secondsRemaining, spreadSeconds, serverNow, source }` for
every non-terminal order with a computed ETA (duration + serverNow, clock-skew safe), omitted
for terminal/unset. Shown in every runtime pass above.

### 8. Poll fallback
The ETA is carried by the same `GET /orders/:id` the client polls every **15 s**
(`POLL_MS = 15_000`, `pollRef → fetchOrder`). So if a socket push is missed, the next poll
reconciles the ETA from the API — i.e., the socket (`order:eta`) is an optimization layered
over a poll-backed source of truth. Evidence: the `eta` block present in every `GET` response
above + the client poll loop.

### 9. No provider calls — Final pass (code-level, definitive)
```
eta.service imports: @prisma/client, ../../shared/events/event-bus, ../../shared/utils/geo (haversineMeters)
grep eta.service for distance.service|distancematrix|googleapis|fetch(|GOOGLE_MAPS → NONE
sole caller of the Google Distance Matrix (pricing/distance.service) → pricing/distance.service itself
```
The ETA path derives travel from `Haversine(stored coords) × road-factor` — **zero
map-provider calls** in Phase 1. (Also: the flat path now yields `prep_road` from coords, so
even the wide fallback rarely triggers — and it too makes no provider call.)

### 10. No DB writes on the ETA push path — Final pass (code-level, definitive)
The `ORDER_ETA_CHANGED → order:eta` socket handler only computes `secondsRemaining` and calls
`io.to(room).emit(...)` — **no `prisma`**. The only `prisma` references in `realtime.plugin`
are in the unrelated `rider:location` (`riderLocation.create`) and `rider:availability`
(`riderAvailability.upsert`) handlers, not the ETA path. ETA is persisted **once per
transition** inside `computeAndPersistEta` (not a push path); Phase 1 has **no ping-path
recompute** at all (that's Phase 2), so there is literally no ETA DB write on any push/ping
path.

---

## Honest caveats
- **On-device RN render** (UI visibly updating from the `order:eta` push) is verified by
  construction (handler → `setOrder({...prev, eta})` → existing header/badge) and by the live
  socket-wire proof; the literal app render isn't automatable from here.
- Verification ran against the **dev DB**; production should get a one-order smoke test after
  deploy.
- Out of scope (Phase 2/3, by design): live/ping ETA recompute, Redis ETA cache, delay-sweep,
  multi-shop group ETA, traffic/weather.

## Code state
ETA Phase 1 + P1 are committed (`7db0993`); P2 + P3 are implemented and **uncommitted** on
`fix/order-rider-id-identity`. No code was changed by this verification.
