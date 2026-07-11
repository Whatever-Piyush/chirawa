# Tracking — Bug Verification Report

**Purpose:** Verify (do **not** fix) three findings from `TRACKING_PAGE_RESEARCH.md`
before any UI redesign. Each finding was traced through the actual code paths.
**Method:** Static code tracing across `apps/api` (orders, delivery, payments,
notifications), `packages/api-client`, `packages/types`, and the customer app.
**No fixes were implemented.**

## Verdict summary

| # | Finding | Verdict | Severity | Confidence |
|---|---|---|---|---|
| 1 | `Order.riderId` stores `RiderProfile.id` but is compared against `User.id` | ✅ **REAL** | 🔴 **Critical** | High (code-trace; one path also masks itself with a wrong-assumption test) |
| 2 | Rider details (`name`/`phone`) never returned by `getOrder` | ✅ **REAL** | 🟠 **High** | High (definitive) |
| 3 | ETA is not server-computed; client value is crude/hardcoded | ✅ **REAL** | 🟡 **Medium** | High (definitive) |

All three findings are confirmed. Severities below.

---

## 🔴 CRITICAL

### BUG-1 — `Order.riderId` identity mismatch breaks order completion

**Finding #1 — CONFIRMED.**

**What the code does.** Every production write to `Order.riderId` stores the
**`RiderProfile.id`**, never the `User.id`:
- `dispatch.service.ts:117` — `prisma.order.update({ … data: { riderId: best.riderProfileId } })`
  where `best.riderProfileId` is `RiderProfile.id` (it is resolved via
  `prisma.riderProfile.findUnique({ where: { id: rid } })`, `dispatch.service.ts:106`).
- `batching.service.ts:128` — `prisma.order.updateMany({ … data: { riderId: rider.riderProfileId } })`.
- `orders.service.ts:126` (release) — sets `riderId: null`.

There is **no** code path that ever sets `Order.riderId = User.id`.

**Where it is read incorrectly.** Several rider-facing paths compare `Order.riderId`
against the authenticated **`User.id`** (`request.auth.userId`):
- `codCollected` — `if (order.riderId !== riderId) throw ForbiddenError('Not your delivery')`,
  with `riderId = request.auth.userId` (`orders.service.ts:602`; route
  `orders.routes.ts:122`).
- `markDelivered` — same guard `order.riderId !== riderId` (`orders.service.ts:634`;
  route `orders.routes.ts:132`).
- `getOrder` access check — `role === 'rider' && order.riderId === userId`
  (`orders.service.ts:370`).
- `getMyOrders` (rider list) — `where = { riderId: userId }` (`orders.service.ts:383`).

Because `RiderProfile.id` and `User.id` are **distinct UUIDs** (separate columns,
both `@default(uuid())`, `schema.prisma:178`/`:179`), the guard
`order.riderId !== userId` is **always true** → these calls **always throw / return
empty** in production.

**Blast radius (all via the `/orders` endpoints):**
- `POST /orders/:id/delivered` (prepaid completion) → always `403 Not your delivery`.
- `POST /orders/:id/cod-collected` (COD completion + `codBalancePaise` ledger) →
  always `403`. **COD cash is never recorded and the order never reaches `delivered`.**
- `GET /orders` for a rider → returns `[]` (no order has `riderId == userId`).
- `GET /orders/:id` for a rider → `403` on their own assigned order.

**What still works (and why the bug is easy to miss):** the rider's pickup flow goes
through the **delivery** module, which resolves the profile first and queries by
`RiderProfile.id`, so it is correct:
- `getActiveDelivery` (`dispatch.service.ts:138`), `riderAdvance` →
  `markPickedUp`/`startDelivery` (`dispatch.service.ts:185`) look up
  `riderProfile.findUnique({ where: { userId } })` then use `rider.id`.

So an order can advance `…→ picked_up → out_for_delivery` but **cannot be completed**
(no working `delivered`/`cod-collected` path — there is no `delivered` action in the
delivery module either; the only ones are the broken `/orders` endpoints).

**Why CI is green (false negative).** The unit test encodes the **wrong assumption**:
`orders.delivered.test.ts:17` defines `const RIDER = 'rider_user_1'`, builds the mock
order with `riderId: RIDER` (`:20`), then calls `markDelivered('order_1', RIDER)`
(`:41`) — i.e. it makes `order.riderId === param` by construction, so the guard passes.
The test's name and value (`rider_user_1`) reveal it believes `Order.riderId` holds the
rider's **User id**, which contradicts what `assignOrder`/`batching` actually write.
The test therefore can never catch this mismatch.

**Severity rationale — Critical.** Orders cannot be completed and COD cash is never
ledgered through the documented rider endpoints; rider order list/detail are broken.
This is core operational/financial breakage, not cosmetic.

**Confidence.** High, by code trace. A live repro (assign an order, call
`POST /orders/:id/delivered` as the assigned rider, observe `403`) would make it
airtight; not run here per the "verify, don't implement" instruction.

---

## 🟠 HIGH

### BUG-2 — Rider identity is never returned to the tracking screen

**Finding #2 — CONFIRMED.**

**What the code does.**
- `getOrder` returns the **raw Prisma order** with
  `include: { items, statusHistory, payments }` — **no rider** data
  (`orders.service.ts:354`).
- `Order` has **no `rider` relation** in the schema (its relations are `customer,
  shop, address, promoCode, batch, group, items, statusHistory, payments,
  deliveryAssignments` — `schema.prisma:566`), so rider name/phone cannot even be
  `include`d; it would require a manual `RiderProfile` + `User` lookup, which
  `getOrder` never performs.
- The API client is a **pass-through**: `getOrder` just does
  `this.request<OrderDetailResponse>('GET', /orders/:id)` with no client-side mapping
  (`packages/api-client/src/index.ts:401`).

**Consequence.** `OrderDetailResponse.rider?{name,phone}` is declared
(`packages/types/src/dto/order.dto.ts:53`) but **never populated**. On the tracking
screen, `showRider = !!order.rider` (`OrderTrackingScreen.tsx:626`) and `riderPhone =
order.rider?.phone` (`:648`) are therefore always falsy — **the rider card and the
"Call" button never render.** "Need help" (WhatsApp) is the only fallback.

**Related contract drift (same root cause).** `getOrder` returns raw fields
(`cartSubtotalAtPricing`, `totalAmount`, and no `deliveryAddress` snapshot object)
while `OrderDetailResponse` promises `cartSubtotal`/`total`/`deliveryAddress`. The
client already casts around this (a comment at `OrderTrackingScreen.tsx` notes "not
`total` as in the OrderDetailResponse DTO"). The DTO contract is not honoured by the
server.

**Severity rationale — High.** A core tracking feature (see/contact your rider)
silently never works, but it does not corrupt data or money. Note it compounds with
BUG-1: even if the rider phone surfaced, the same `riderId` confusion affects rider
queries.

**Confidence.** High, definitive (no relation exists + no mapping anywhere).

---

## 🟡 MEDIUM

### BUG-3 — No server-side ETA; displayed ETA is hardcoded or crudely estimated

**Finding #3 — CONFIRMED.**

There is **no ETA engine on the server** — no `estimatedDeliveryAt`/`promisedAt`
field, no prep-time + travel-time computation anywhere in `orders`, `pricing`, or
`delivery` (grep for `estimatedDeliveryAt|promisedAt|computeEta|estimateEta` returns
nothing in `apps/api/src`). The road distance the platform already stores
(`Order.distanceKm`, `distanceSource = google_maps`, `schema.prisma:528`) is **not
used** for any ETA.

Instead there are **three independent, inconsistent ETA values**, none authoritative:

1. **Tracking header — hardcoded.** Pre-out-for-delivery the big header literally
   reads `~20 min`; at out-for-delivery it switches to a static "arriving soon"
   string — neither is computed:
   ```
   order.status === OUT_FOR_DELIVERY ? t('tracking.arrivingSoon')
                                      : `${t('tracking.arrivingIn')} ~20 min`
   ```
   (`OrderTrackingScreen.tsx:655-656`).
2. **Map badge — crude client estimate.** `TrackingMap` computes
   `etaMin = ceil((straightLineKm(rider, customer) / 20) * 60)` — **straight-line**
   distance at a fixed **20 km/h**, and **only** when a live, non-stale rider location
   exists (`showRider = rider !== null && !stale`). So there is **no map ETA before
   out-for-delivery**; otherwise it shows "location unavailable"
   (`components/tracking/TrackingMap.tsx`).
3. **Push notification — hardcoded.** The out-for-delivery push is sent with a literal
   string: `CustomerNotifications.outForDelivery('30 minute')`
   (`notifications.plugin.ts:70`; template at `notification.templates.ts:26`).

So a customer can simultaneously see "~20 min" (header), a computed "~7 min" (map
badge), and receive a "30 minute" push — for the same order.

`Shop.estimatedDeliveryMinutes` exists and is shown on **shop cards** (home/discovery,
`ShopsNearbySection.tsx:55`, `ChirawaSpecialSection.tsx:151`) but is **not** used as
the order ETA.

**Severity rationale — Medium.** The screen renders and shows *an* ETA, so nothing is
broken or data-corrupting — but the values are hardcoded/inconsistent and the one
computed value is straight-line/fixed-speed and only appears post-dispatch. This is an
accuracy/trust problem, not an outage. (Lands above "cosmetic" because customers act on
ETAs; below "High" because no flow fails.)

**Confidence.** High, definitive.

---

## Cross-cutting note

BUG-1 and BUG-2 share a root cause worth flagging for the redesign: the **`Order.riderId`
column is a bare `String?` with no relation and ambiguous semantics** (profile-id vs
user-id) across modules. Any tracking redesign that surfaces rider identity or
rider-side actions should settle this first (normalise to one id space and/or add a
real relation) — otherwise both the rider card (BUG-2) and order completion (BUG-1)
remain broken regardless of UI work.

## Explicitly out of scope

No fixes were implemented. No schema, service, client, or test files were modified by
this verification. Recommended next step before UI work: reproduce BUG-1 at runtime
(assign → attempt `delivered`/`cod-collected` as the assigned rider) to convert
"High-confidence trace" into "observed", then prioritise BUG-1 → BUG-2 → BUG-3.
