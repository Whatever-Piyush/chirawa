# RIDER_LIFECYCLE.md

> The delivery rider lifecycle: onboarding → availability → assignment → pickup → delivery →
> COD reconciliation → monthly pay. Traced to code; citations `path:line`.
> App: `apps/rider-app` — screens `HomeScreen`, `delivery/DeliveryScreen`, `EarningsScreen`,
> `ProfileScreen`, `auth/{OtpLoginScreen,VerifyOtpScreen,SetPinScreen}`.

---

## 1. Actors & ownership

| Actor | Responsibility |
|-------|----------------|
| Rider | Goes online, accepts assignments, picks up, delivers, collects COD cash |
| Admin / Ops | Provisions rider, assigns zones, runs monthly settlement, manual-assigns unrouted batches |
| System | Auto-assigns batches, escalates when no rider, recomputes ETA |

**Two-id rule (the single biggest rider-side footgun):**
- `Order.riderId` stores a **`RiderProfile.id`** (denormalized, no FK).
- The JWT `sub` is a **`User.id`**; the socket/route auth also carries `profileId` =
  `RiderProfile.id`.
- Ownership checks must compare the right one. The "BUG-1" fixes exist because these were
  swapped: `getMyOrders` filters `riderId: profileId` (`orders.service.ts:431`), `codCollected`
  takes **both** ids — `riderProfileId` for ownership/ledger and `riderUserId` for the
  status-history actor (`:659`).

---

## 2. Onboarding & identity

**Provisioned by ops** (no self-serve): `User(role='rider')` + `RiderProfile` + `RiderZone`
links are created out of band.

**Login** (`auth.service.ts`): phone OTP → because riders carry a PIN, `requiresPin=true`
until `RiderProfile.pinHash` is set (`:117`) → `SetPinScreen` → `setPin` (bcrypt cost 12,
`:206`). 5 wrong PINs → 15-min lockout (`pinFailCount`/`pinLockedUntil`, `:251-274`).

**`RiderProfile`** (`schema.prisma:177`): `fullName`, `vehicleNumber`, `licenseUrl`, `rcUrl`,
`securityDepositBalance`, **`monthlySalaryPaise` (default 750000 = ₹7,500)**, `pinHash`,
**`codBalancePaise`** (cash the rider is holding/owes the platform).

> Riders are **salaried**, not paid per trip — `monthlySalaryPaise` + optional petrol, settled
> monthly (`RiderSettlement`). This is why dispatch optimizes for **load-balance**, not rider
> earnings.

---

## 3. Availability (going online)

Screen: `HomeScreen`. The rider toggles online/offline; only online riders are dispatch
candidates.

Two write paths (both update `RiderAvailability`, `schema.prisma:715`):
1. **REST** `PATCH /delivery/availability` → `setAvailability` (`dispatch.service.ts:44`):
   authoritative state in Postgres **and** a fast-path copy in Redis
   (`rider:{riderProfileId}:availability`, and `:location` when coords given, `:57-60`).
2. **Socket** `rider:availability` (`realtime.plugin.ts:166`): upserts the same row (used by
   the live screen).

`RiderAvailability.status` ∈ {online, offline, on_delivery}. Default offline
(`getAvailability`, `:65`).

`GET /delivery/availability` returns the current state for the home screen.

---

## 4. Assignment (system → rider)

Riders do **not** browse a job board — the system **pushes** a whole **batch** (1–3 orders).

**Trigger:** an order becomes `confirmed` → `dispatch.plugin` slots it into a `Batch`
(same zone, ≤800 m of anchor, ≤3 orders, 3-min window) → schedules an `assign-batch` worker
job (see ORDER_LIFECYCLE.md §5).

**Candidate selection** (`assignBatch` → `findBestRiderForPoint`, `batching.service.ts:84`):
1. `RiderAvailability.status='online'` riders only.
2. Prefer riders linked to the order's `DeliveryZone` via `RiderZone`; else any online rider
   (3 km-town simplification).
3. Pick **fewest active deliveries** (`pickBestRider`, `dispatch.service.ts:34`) — load balance.

**On assign** (one transaction, `batching.service.ts:125-130`): create `DeliveryAssignment`(s)
(`isActive=true`), set `Order.riderId`, `Batch.status='assigned'`. Emit **one**
`ORDER_ASSIGNED_TO_RIDER` for the batch →
- socket `order:assigned` → room `rider:{userId}` (60-sec accept-window UI, `realtime.plugin.ts:252`),
- FCM on `chirawa_alerts` (alarm sound, `notifications.plugin.ts:215`).

**No rider available:** the job **retries every 60 s, up to 10 attempts**, then **escalates by
SMS** to `AppConfig['support_phone']` (`assignment.job.ts:35-57`). The order stays unassigned
and shows in the admin dispatch view (OPERATIONS_LIFECYCLE.md §2).

> **There is no in-app "reject assignment" endpoint today.** `DeliveryAssignment` has
> `rejectedAt`/`rejectReason` columns (`schema.prisma:690`), but the rider routes expose only
> pickup / start-delivery / deliver / item-unavailable. Effectively, an assigned batch is the
> rider's to complete; reassignment is an ops action.

---

## 5. The active delivery (pickup → deliver)

Screen: `delivery/DeliveryScreen`. `GET /delivery/active` (`getActiveDelivery`,
`dispatch.service.ts:142`) returns the rider's current **trip**: every order on an active
assignment, grouped as a batch with distinct pickup shops and per-order dropoffs, including
the **contact to call** — the receiver if set, else the account owner (`:173-175`).

**Rider transitions** (all via `riderAdvance`, `dispatch.service.ts:189` — verifies active
`DeliveryAssignment`, then `transitionOrderStatus`, recompute ETA, emit):

| Action | Endpoint | Transition | Notes |
|--------|----------|------------|-------|
| Pickup | `POST /delivery/orders/:id/pickup` | `ready_for_pickup → picked_up` | per order |
| Start delivery | `POST /delivery/orders/:id/start-delivery` | `picked_up → out_for_delivery` | **batch-gated** |
| Deliver (COD) | `POST /orders/:id/cod-collected` | `out_for_delivery → delivered` | records cash |
| Deliver (prepaid) | `POST /orders/:id/delivered` | `out_for_delivery → delivered` | no cash |
| Item unavailable | `POST /delivery/orders/:id/items/:itemId/unavailable` | refund/cancel line | safety net |

**Batch gate** (`dispatch.service.ts:200-204`): a rider can't `start-delivery` for any order
until **every** order in the batch is `picked_up` ("Pehle batch ke saare orders pickup
karein"). Keeps a multi-stop trip coherent.

**Live location:** `DeliveryScreen` pushes `rider:location` (`{orderId,lat,lng,timestamp}`)
~every 8 s. Server (`realtime.plugin.ts:129`): writes Redis `rider:{userId}:location` (30 s
TTL), broadcasts to the order room (customer map), persists to `RiderLocation` (7-day
retention for disputes). Only `role==='rider'` may emit.

**Item-unavailable at pickup** (`riderReportItemUnavailable`, `orders.service.ts:738`): rider
taps "not available" on a line at the shop →
- atomic at-most-once line claim (`fulfilled → unavailable_refunded`),
- flip that shop's `Product → out_of_stock`,
- sole line → cancel + full refund + **free the rider**; multi-line → refund/reduce-cash and
  the trip continues,
- customer gets `ORDER_ITEM_UNAVAILABLE` + a substitute suggestion.

---

## 6. COD reconciliation (cash the rider holds)

When a rider delivers a **COD** order (`codCollected`, `orders.service.ts:659`):
- transition `out_for_delivery → delivered` with `codCollectedPaise = order.totalAmount`,
- **credit `RiderProfile.codBalancePaise`** by the **server-derived** total — the client-sent
  `amountPaise` is advisory only and never written (`:671`),
- both in **one transaction**, so only the call that actually flips the status credits the
  balance (race-safe),
- **idempotent**: a retried collection on an already-`delivered` order returns success
  **without** re-crediting (`:667`).

`codBalancePaise` is the running cash the rider owes the platform; it is reduced when the
rider deposits/settles cash (transaction types `rider_cod_collection` / `rider_cod_settlement`
exist in the ledger enum, `schema.prisma:73-74`). Prepaid deliveries (`markDelivered`, `:708`)
never touch the COD balance and reject COD orders (which must record cash).

---

## 7. Earnings & monthly settlement

Screen: `EarningsScreen`. Riders are **salaried**:
- `RiderSettlement` (`schema.prisma:838`) — unique on `(riderId, month, year)`: `salaryPaise`
  (+ optional `petrolPaise`) → `totalPaise`, `status`, `upiRef`, `paidAt`.
- Default monthly salary `RiderProfile.monthlySalaryPaise = 750000` (₹7,500).
- `securityDepositBalance` — deposit held against COD float.

> The recurring **rider** payout job is not in the worker scheduler today (the scheduler runs
> seller settlement, payment/payout reconcile, and cleanups — `scheduler.ts`). Rider
> settlement is currently an ops/manual or future-job concern; the data model is in place.

---

## 8. Realtime events the rider depends on

| Event | Socket / channel | Rider effect |
|-------|------------------|--------------|
| `ORDER_ASSIGNED_TO_RIDER` | `order:assigned` → `rider:{userId}` + FCM `chirawa_alerts` | New batch alarm; 60-sec accept UI |
| `ORDER_STATUS_CHANGED(cancelled)` | FCM (`RiderNotifications.orderCancelled`) | Order leaves active list |
| (rider emits) `rider:location` | → order room | Customer live map |
| (rider emits) `rider:availability` | server upsert | Online/offline |

The rider's own pushes drive customer-facing tracking; the only **inbound** push that matters
operationally is the assignment alarm.

---

## 9. Failure modes & launch-critical requirements

| Failure | Guard | Result |
|---------|-------|--------|
| Wrong-id ownership check (BUG-1 class) | profileId vs userId separation (`:659`,`:431`) | Rider can act on own deliveries; COD ledger lands |
| No rider online for a batch | retry 60s×10 → SMS escalation (`assignment.job.ts`) | Ops manually assigns; order not lost |
| Rider double-taps "COD collected" | idempotent delivered-state return (`:667`) | Cash credited once |
| Client lies about COD amount | server-derived from order total (`:671`) | Recorded amount is authoritative |
| Rider disconnects mid-trip | Redis location 30s TTL + DB pings | Customer map degrades gracefully (stale fallback) |
| Item missing at shop | item-unavailable net (`:738`) | Line refunded / order cancelled; rider freed |
| Partial batch start-delivery | batch pickup gate (`:200`) | Trip stays coherent |
| Cancelled order still in rider list | `releaseOrderAssignment` deactivates assignment (`orders.service.ts:112`) | Order disappears from `/delivery/active` |

**Launch-critical:**
1. Correct `RiderProfile.id` vs `User.id` handling everywhere (ownership + COD ledger).
2. COD idempotency + server-derived amounts (cash integrity).
3. No-rider escalation actually paging ops (`support_phone` configured in `AppConfig`).
4. Assignment alarm (socket + FCM `chirawa_alerts`) reaching the device.
5. `releaseOrderAssignment` on every cancel path (no ghost deliveries).
