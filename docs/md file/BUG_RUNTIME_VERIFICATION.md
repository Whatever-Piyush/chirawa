# Runtime Verification — Tracking Bugs

**Goal:** Move BUG-1/2/3 from "confirmed by code trace" to "observed at runtime," with
concrete request/response traces and proof of impact.
**Result:** **All three confirmed at runtime.** BUG-1 is Critical and observable as
`HTTP 403` on the rider's own assigned order.

## Test environment & method

- **Live API:** `http://localhost:3000/api/v1` (`/health` → 200), Fastify + Prisma 5 +
  Postgres 15 (Docker `chirawa_postgres`) + Redis 7 (Docker `chirawa_redis`),
  `NODE_ENV=development`.
- **Auth:** real OTP login flow (`POST /auth/send-otp` → `POST /auth/verify-otp` with
  the dev bypass code `123456`). Tokens minted by the server itself (RS256). Logged in
  as the seeded **rider** `7700110001`, **customer** `9680599889`, **admin**
  `9999900001` (token lengths 602 / 606 / 554 — all valid).
- **Assignment:** performed by the **real** `assignOrder` via the admin endpoint
  `POST /delivery/orders/:id/assign` — not a hand-written `riderId`. So the assigned
  state is exactly what production produces.
- **Data:** two orders (one `upi`/prepaid, one `cod`) seeded for the real customer at
  shop "Chirawa Store", then **deleted at the end** of the run.
- **Code:** **no repository code modified.** The harness was a throwaway script in
  `/tmp` (login → seed → assign → exercise endpoints → clean up).

Identifiers used (real seed rows):

| Entity | `User.id` | `RiderProfile.id` |
|---|---|---|
| Rider `7700110001` | `2cb348fa-…-1e1d84db03df` | `a69c6e6c-…-a32c32ef0b7d` |

These two id spaces are the crux of BUG-1.

---

## 🔴 BUG-1 — `Order.riderId` mismatch — **RUNTIME CONFIRMED (Critical)**

### Proof the real assignment writes `RiderProfile.id`

`POST /delivery/orders/{prepaid}/assign` (admin) → **HTTP 200**
```json
{"assigned":true,"riderId":"a69c6e6c-eaa6-4303-886f-a32c32ef0b7d","zone":"Zone 3 — North Residential"}
```
DB after assignment (real `assignOrder` output):
```
                  id                  |     status       | payment | rider_id (a69c6e6c…=PROFILE id) | =profile_id | =user_id
 a284d897-…-e0b52291a425 (prepaid)    | ready_for_pickup | upi     | a69c6e6c-…-a32c32ef0b7d         |     t       |    f
 c4884943-…-8f49d69c9ba4 (cod)        | ready_for_pickup | cod     | a69c6e6c-…-a32c32ef0b7d         |     t       |    f
```
`orders.rider_id` equals the **RiderProfile.id** (`t`) and **not** the rider's
`User.id` (`f`). Confirmed in production data, written by the real code path.

### Impact trace 1a — rider cannot mark a prepaid order delivered
**Request:** `POST /orders/a284d897-…/delivered` — `Authorization: Bearer <rider>`
**Response: `HTTP 403`**
```json
{"success":false,"error":{"code":"FORBIDDEN","message":"Not your delivery"}}
```

### Impact trace 1b — rider cannot record COD cash
**Request:** `POST /orders/c4884943-…/cod-collected` — rider — body `{"amountPaise":16000}`
**Response: `HTTP 403`**
```json
{"success":false,"error":{"code":"FORBIDDEN","message":"Not your delivery"}}
```
→ The order can never reach `delivered` and **COD cash is never added to the rider's
`codBalancePaise` ledger** through the documented endpoint.

### Impact trace 1c — rider's order list is empty
**Request:** `GET /orders` — rider
**Result:**
```
returned order count = 0
contains prepaid order?  False
contains cod order?      False
```
(`getMyOrders` filters `where: { riderId: userId }`; no order has `riderId == userId`.)

### Impact trace 1d — the smoking gun (same rider, opposite answers)
**Request:** `GET /delivery/active` — rider (the delivery module resolves by
`RiderProfile.id`)
**Result:**
```
orderCount = 2
order ids = ['a284d897-…-e0b52291a425', 'c4884943-…-8f49d69c9ba4']
```
The **same rider** is legitimately assigned **both** orders (delivery module: "yours"),
yet every `/orders` path rejects them ("not yours"). This isolates the defect to the
`order.riderId` ↔ `userId` comparison in the orders module, not to ownership.

### Impact trace 1e — rider cannot even view the order
**Request:** `GET /orders/a284d897-…` — rider → **HTTP 403**
```json
{"success":false,"error":{"code":"FORBIDDEN","message":"Not your order"}}
```

### Verdict
**Critical, confirmed at runtime.** A correctly-assigned rider gets `403` on
`delivered`, `cod-collected`, `GET /orders`, and `GET /orders/:id`. Delivery cannot be
completed and COD cash cannot be ledgered via these endpoints. (Note: the unit test
`orders.delivered.test.ts` passes only because it sets `order.riderId` to the same value
it passes in — encoding the wrong assumption that `riderId` holds the `User.id`.)

---

## 🟠 BUG-2 — Rider details never returned — **RUNTIME CONFIRMED (High)**

**Request:** `GET /orders/a284d897-…` — `Authorization: Bearer <customer>` → **HTTP 200**

Full response body (abridged to the relevant parts):
```json
{
  "id": "a284d897-…-e0b52291a425",
  "status": "ready_for_pickup",
  "riderId": "a69c6e6c-eaa6-4303-886f-a32c32ef0b7d",   // a rider IS assigned
  "items": [ { "productName": "Tata Tea Gold", "quantity": 1, "subtotal": 14000 } ],
  "statusHistory": [],
  "payments": []
  // …no `rider` object anywhere…
}
```
Programmatic check on that response:
```
has 'rider' key: False | value: None
```
**Proof of impact:** a rider is assigned (`riderId` is populated), yet the payload
contains **no `rider` name/phone object**. On the tracking screen
`showRider = !!order.rider` and `riderPhone = order.rider?.phone` are therefore always
falsy — **the rider card and Call button can never render.**

**Incidental confirmations from the same trace:**
- **DTO drift (matches the static finding):** the response uses raw Prisma fields
  `cartSubtotalAtPricing` / `totalAmount` / `deliveryLat…` and has **no**
  `cartSubtotal` / `total` / `deliveryAddress`, contradicting `OrderDetailResponse`.
- **Over-exposure:** the raw order is returned to the customer including internal
  fields (`riderId`, `batchId`, `feeRuleVersion`, `distanceSource`, …) — a side effect
  of there being no serialization layer.
- *(`statusHistory: []` / `payments: []` here are because the order was seeded directly
  for the test; a real order would have history/payment rows. Not a bug — disclosed for
  honesty.)*

### Verdict
**High, confirmed at runtime.** `getOrder` never joins/serializes rider identity (and
`Order` has no `rider` relation to even `include`), so the tracking rider card is dead.

---

## 🟡 BUG-3 — No server-side ETA — **RUNTIME CONFIRMED (Medium)**

From the same customer `GET /orders/:id` response, the full top-level key set was
captured and scanned for any ETA field:
```
top-level keys: [... 'distanceKm', 'distanceSource', 'status', 'paymentMethod',
                 'riderId', 'codCollectedPaise', ... 'createdAt', 'updatedAt',
                 'items', 'statusHistory', 'payments']
eta-ish keys: []
```
**Proof of impact:** the server returns **no ETA whatsoever** (no
`estimatedDeliveryAt` / `eta` / `promisedAt` / `arrivingAt`). The road distance
`distanceKm: "1"` is present but unused. Therefore every ETA the customer sees is
**fabricated client-side or hardcoded**:
- tracking header → literal `~20 min` (`OrderTrackingScreen.tsx:656`),
- map badge → `straight-line km ÷ 20 km/h`, only once a live GPS fix exists
  (`TrackingMap.tsx`),
- push notification → literal `'30 minute'` (`notifications.plugin.ts:70`).

### Verdict
**Medium, confirmed at runtime.** No authoritative ETA exists server-side; the displayed
values are static/crude and mutually inconsistent. Functional but misleading — not a
hard failure.

---

## Summary

| Bug | Severity | Runtime verdict | Hardest evidence |
|---|---|---|---|
| BUG-1 riderId mismatch | 🔴 Critical | **Confirmed** | `403` on `delivered`/`cod-collected`/`GET /orders/:id`; `GET /delivery/active` shows the *same* orders as the rider's |
| BUG-2 no rider details | 🟠 High | **Confirmed** | Customer order payload: `has 'rider' key: False` while `riderId` is set |
| BUG-3 no server ETA | 🟡 Medium | **Confirmed** | `eta-ish keys: []` in the order payload; `distanceKm` present but unused |

**Root-cause coupling:** BUG-1 and BUG-2 both stem from the bare, relation-less,
semantically-ambiguous `Order.riderId` column. Settle its identity (one id space and/or
a real relation) before any tracking UI redesign — otherwise rider completion (BUG-1)
and the rider card (BUG-2) stay broken regardless of UI.

## Integrity notes

- No repository code/schema/tests were modified.
- All test rows (2 orders, 2 items, assignments, status history) were deleted and the
  test rider was returned to `offline` at the end of the run; DB row counts are
  unchanged from before the test.
- Evidence above is copied verbatim from the live run; nothing is hand-authored.
- No fixes implemented, per instruction.
