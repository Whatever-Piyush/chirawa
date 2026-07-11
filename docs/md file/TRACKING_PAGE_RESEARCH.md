# Order Tracking — Research & Engineering Specification

**Status:** Research / specification only. No code is changed by this document.
**Audience:** Product + backend + mobile engineering.
**Scope:** The customer-facing order-tracking experience (the "where is my order"
screen) and every backend/data capability it depends on.

> **Method note.** Section 1 (competitor research) describes externally observable
> UX behaviour of each app as of this writing; where internal mechanisms (routing
> engines, assignment algorithms) are not public, they are labelled *inferred*.
> Section 2 (Bringly audit) is grounded in the actual repository with `file:line`
> references. Two WhatsApp screenshots were attached to the request but did not
> arrive as viewable images on the engineering side — if they depict a target
> tracking layout, fold them into §3.2 (Screen anatomy) before build.

---

## 1. Competitor research

Apps surveyed: **Blinkit**, **Zepto**, **Swiggy Instamart** (q-commerce / dark-store
model) and **Uber Eats**, **DoorDash** (restaurant marketplace / 3-sided model).

The two cohorts matter because Bringly sits *between* them: it is q-commerce-shaped
(hyperlocal grocery, one town, fast delivery) but 3-sided like the marketplaces
(independent seller shops + gig riders + customer), and multi-shop carts split into
per-shop orders. The patterns worth copying come mostly from the q-commerce cohort;
the patterns worth copying for *rider assignment and support* come from the
marketplace cohort.

### 1.1 Order status transitions

| App | Customer-visible states | Notes |
|---|---|---|
| Blinkit | Placed → Packing → Out for delivery → Arriving → Delivered | Collapses prep + pick into "Packing"; emphasises the 10-min promise, not granular state |
| Zepto | Confirmed → Packed → On the way → Delivered | Very few states; the timer (countdown) is the hero, not the state list |
| Swiggy Instamart | Placed → Packed → Out for delivery → Delivered | Similar; shows a slim progress bar |
| Uber Eats | Order placed → Restaurant confirmed → Preparing → Ready/Picked up → On the way → Arriving/Delivered | More states because a 3rd-party restaurant + courier are involved |
| DoorDash | Confirmed → Preparing → (Dasher assigned) → Picked up → On the way → Delivered | Surfaces "Dasher assigned/heading to store" explicitly |

**Pattern takeaway.** Customers do not want the *internal* state machine; they want
3–5 *legible* phases on a stepper, each with a one-line plain-language message and a
timestamp. The marketplace apps expose a "merchant confirmed" and a "courier
assigned/at store" milestone because two independent parties create uncertainty —
exactly Bringly's situation (independent seller + gig rider). The terminal states
(delivered, cancelled) always carry a money outcome (receipt / refund).

### 1.2 Delivery rider assignment

- **Blinkit / Zepto / Instamart:** Assignment is **automatic and invisible** from a
  dark store. The customer typically sees the rider only once the order is *out for
  delivery* (rider name, photo, masked phone, vehicle). No "your rider is X" moment
  during packing. *(Inferred: zone + capacity based dispatch from the serving store.)*
- **Uber Eats / DoorDash:** Assignment is **surfaced as a milestone** ("Finding a
  courier", "Dasher assigned", "Dasher heading to restaurant"). Reassignment is
  visible too ("We found you a new Dasher"). Courier card with name, photo, rating,
  vehicle, masked call/chat.

**Pattern takeaway.** Two acceptable models: hide assignment until OFD (q-commerce),
or surface it as a milestone (marketplace). Either way, once a rider is on the case,
the customer gets a **rider identity card** (name, photo/initial, masked phone) and a
**contact channel**. Riders are contacted through **number masking**, never the raw
phone, on all five apps.

### 1.3 Live location tracking

- **q-commerce (Blinkit/Zepto/Instamart):** Live rider dot on a map appears at
  *out-for-delivery*; pin for the drop; sometimes a route line; refresh every few
  seconds. Before OFD, the map is replaced by a countdown/illustration.
- **Marketplace (Uber Eats/DoorDash):** Full live map earlier — courier moving to the
  store, then to you; route polyline; the dot animates smoothly between updates
  (client-side interpolation) rather than teleporting.

**Pattern takeaway.** Live map only matters from pickup onward. Before that, show a
status illustration + ETA, not an empty map. Smooth marker interpolation and a route
polyline are the difference between "premium" and "GPS jitter". Stale-location
handling (rider lost signal) must degrade gracefully to "location updating…".

### 1.4 ETA calculation

- **Blinkit/Zepto:** ETA is the headline — a **countdown** ("Arriving in 8 min").
  Computed from store load + travel time and shown *from order placement*, not just
  after dispatch. Promise-based ("by 9:42 PM") as a fallback. *(Inferred: prep-time
  model + travel-time estimate, re-computed on dispatch.)*
- **Instamart:** Similar countdown, slightly more conservative.
- **Uber Eats/DoorDash:** A **time range** ("15–25 min") shown from placement, then
  tightened to a specific time after pickup. ETA blends merchant prep time + courier
  travel time (routing engine + traffic). Lateness triggers proactive messaging and
  sometimes credit.

**Pattern takeaway.** ETA must exist **from the moment the order is placed**, not only
after a rider has GPS. The credible model is: `ETA = prep_time_estimate +
travel_time_estimate`, recomputed at each phase transition and persisted as a
**promised delivery time**. Travel time should use **road distance**, not straight
line. Show a *range* early, a *time/countdown* once OFD.

### 1.5 Payment & billing visibility

- All five: a **bill/receipt** is reachable from the tracking/order screen — item
  lines, item total, delivery fee, taxes/handling, discounts, tip (marketplace),
  grand total, and **payment method** used. Prepaid shows "Paid"; COD shows "Pay ₹X
  on delivery" prominently.
- Marketplace apps separate **estimated** vs **final** charges (weight-adjusted items,
  tips), and show authorisation vs capture.
- q-commerce: simpler, fixed prices, charge at placement; bill is final.

**Pattern takeaway.** The tracking screen must link to a complete, itemised bill with
the exact fee breakdown and payment method/state. For COD the "amount due in cash"
must be unmissable. If any line was refunded/removed (out-of-stock), the bill must
reflect the **adjusted** total and the refunded amount.

### 1.6 Cancellation handling

- **Blinkit/Zepto/Instamart:** Self-cancel allowed only for a **short window** /
  before packing; after that it's blocked or routed to support. Because items are
  picked fast, the window is small. Clear messaging on refund eligibility.
- **Uber Eats/DoorDash:** Self-cancel before the merchant starts preparing; after
  that, partial/no refund and a support path. Cancellation reason is captured.

**Pattern takeaway.** Cancellation is **state-gated** and the gate is communicated
*before* the customer tries. Reason capture is standard. Post-gate, the only path is
support, and the refund consequence is stated up front.

### 1.7 Refund handling

- All: refunds are **status-tracked and visible** — "Refund initiated → processed",
  with an **amount, destination (original method / wallet), and an ETA** ("3–5
  business days" / "instant to wallet"). q-commerce leans on **instant wallet
  credit**; marketplaces refund to original method or credits.
- Partial refunds (missing/oos item, weight adjustment) are itemised against the
  specific line.

**Pattern takeaway.** A refund is a first-class, *trackable* object with state, amount,
destination, and ETA — not a silent reversal. The customer should see it both on the
order and in a refunds/wallet history. Instant wallet credit is the q-commerce
expectation for delight; original-method refund is the trust baseline.

### 1.8 Customer support integration

- **q-commerce:** In-app **help center per order** — chat/bot first, canned issues
  ("item missing", "didn't arrive", "quality"), escalation to human; chat is
  **order-context-aware**.
- **Marketplace:** Same, plus live chat with courier/merchant, and self-serve
  resolution (instant credit for common issues).

**Pattern takeaway.** Support is **entered from the specific order**, pre-loaded with
order context, and offers **structured issue types** that can auto-resolve common
cases (missing item → instant credit). A raw "WhatsApp us" link is a stopgap, not a
support system.

### 1.9 Cross-app synthesis — the bar Bringly should aim for

1. A **3–5 phase stepper** with timestamps and plain-language copy.
2. **ETA from placement** (range), tightening to a **countdown/time** at OFD, server-
   computed from prep + **road** travel time, persisted as a promise.
3. **Rider identity card + masked contact** once assigned/OFD.
4. **Live map from pickup onward** with smooth movement, route line, stale handling.
5. **Itemised bill** + payment method/state always reachable; COD amount-due explicit.
6. **State-gated cancellation** with reason capture and refund consequence shown
   up-front.
7. **Trackable refunds** (state + amount + destination + ETA), instant-to-wallet where
   possible.
8. **Order-scoped, structured support** with auto-resolution for common issues.

---

## 2. Bringly codebase audit

Stack: Fastify v4 + Prisma v5 (PostgreSQL) + Socket.IO v4 (+ Redis adapter) + BullMQ
v5 on the API; Expo / React Native customer app with `react-native-maps`; Razorpay for
payments. Shared DTOs in `packages/types`, API client in `packages/api-client`.

### 2.1 What already exists ✅

**Order state machine & history**
- 9-state `OrderStatus` enum: `pending_payment, paid, confirmed, preparing,
  ready_for_pickup, picked_up, out_for_delivery, delivered, cancelled`
  (`apps/api/prisma/schema.prisma:19`).
- A real **state machine** — `ORDER_TRANSITIONS` + `assertTransition()` reject illegal
  jumps (`apps/api/src/modules/orders/orders.service.ts:77`).
- **Full transition audit trail**: `OrderStatusHistory` rows (status, changedByRole,
  changedById, reason, changedAt) written on every legal transition
  (`schema.prisma:621`; written in `updateOrderStatus` `orders.service.ts:458`).
- Per-phase timestamps on `Order`: `confirmedAt, sellerAcceptedAt, pickedUpAt,
  deliveredAt, cancelledAt, cancelReason` (`schema.prisma:551`).

**Rider assignment**
- Automatic **zone-based, load-balanced** dispatch: `pickZone()` (point-in-polygon +
  nearest-centroid fallback) and `pickBestRider()` (fewest active deliveries)
  (`apps/api/src/modules/delivery/dispatch.service.ts:19`, `:32`, `assignOrder` `:79`).
- A BullMQ dispatch worker (`delivery/dispatch.plugin.ts`) plus a manual/admin trigger
  `POST /api/v1/delivery/orders/:orderId/assign` (`delivery.routes.ts:97`).
- `DeliveryAssignment` lifecycle table (`assignedAt, acceptedAt, rejectedAt,
  rejectReason, completedAt, isActive`) and denormalised `Order.riderId`
  (`schema.prisma:670`, `:536`).
- **Batching**: up to 3 nearby same-zone orders into one trip (`Batch`,
  `schema.prisma:733`; `delivery/batching.service.ts`); out-for-delivery is gated until
  all batch orders are picked up (`dispatch.service.ts:196`).
- Rider availability online/offline/on_delivery with last-known geo
  (`RiderAvailability`, `schema.prisma:701`).

**Live location tracking**
- Socket.IO v4 with a **Redis adapter** for multi-instance fan-out; JWT-authenticated
  sockets; per-order rooms via `order:subscribe`/`order:unsubscribe`
  (`apps/api/src/shared/plugins/realtime.plugin.ts:36`, `:97`).
- Rider pushes `rider:location` (client cadence ~8 s) → server broadcasts
  `order:location` to the order room **and** writes a `RiderLocation` row (dispute
  retention) **and** caches last-known in Redis with a 30 s TTL
  (`realtime.plugin.ts:109`).
- HTTP **polling fallback** for the initial paint / stale case: `GET
  /api/v1/delivery/orders/:orderId/rider-location` returns last-known + `ageMs`
  (`delivery.routes.ts:74`; `dispatch.service.ts:226`).
- Client live map exists: `TrackingMap` (Google provider, home + rider pins,
  auto-fit region) (`apps/customer-app/src/components/tracking/TrackingMap.tsx`).
- Customer tracking screen wires socket (`order:status`, `order:location`) **plus** a
  poll-interval fallback and a stale-location threshold
  (`apps/customer-app/src/screens/orders/OrderTrackingScreen.tsx:462`).

**ETA**
- A **client-side** ETA only: straight-line distance ÷ 20 km/h, shown as a badge on
  the map (`TrackingMap.tsx` — `etaMin = ceil((distanceKm / 20) * 60)`).

**Payment & billing visibility**
- `Payment` model with Razorpay ids, status (`pending, captured, failed, refunded,
  partially_refunded`), `amountPaise`, `refundedPaise`, `capturedAt`
  (`schema.prisma:638`). `getOrder` includes `payments[]` (status/method/amount)
  (`orders.service.ts:358`).
- Order carries the full money breakdown: `cartSubtotalAtPricing, deliveryFee,
  discount, totalAmount, feeRuleVersion, distanceKm` (`schema.prisma:522`).
- COD tracking: `Order.codCollectedPaise`, `RiderProfile.codBalancePaise`, and a
  rider `cod-collected` endpoint (`orders.routes.ts:117`; `codCollected`
  `orders.service.ts:599`).
- **Multi-shop unification**: `OrderGroup` gives one customer-facing order over N
  per-shop child orders; `getOrderGroup` returns combined money + a single "least-
  advanced child" status (`schema.prisma:588`; `orders.service.ts:403`).

**Cancellation**
- Customer `DELETE /api/v1/orders/:id` (`orders.routes.ts:73`), **state-gated** to
  `pending_payment | paid | confirmed` (`cancelOrder` `orders.service.ts:569`), with
  reason capture, automatic prepaid refund, seller real-time notification, and rider/
  batch release (`releaseOrderAssignment` `orders.service.ts:116`).
- Cancellation reason UI with preset reasons on the tracking screen
  (`OrderTrackingScreen.tsx:637`).

**Refunds**
- `refundCapturedOrderPayment()` (full order) and `refundOrderLine()` (single line) →
  Razorpay `createRefund()` (`payments.service.ts:217`, `:260`;
  `razorpay.service.ts:83`).
- Per-line out-of-stock safety net: rider marks an item unavailable → line refunded
  (or order cancelled if it was the only line), `OrderItem.fulfillmentStatus =
  'unavailable_refunded'` + `refundedPaise`, with a **live socket event**
  `order:item-unavailable` carrying a substitute suggestion
  (`riderReportItemUnavailable` `orders.service.ts:660`; `realtime.plugin.ts:235`).
- Financial ledger: `Transaction(type = refund)` + `PaymentStatus` refunded states.

**Support / comms**
- `Notification` model (channels `fcm | sms | in_app`) (`schema.prisma:992`); a
  notifications module; FCM push wired to events.
- Tracking screen: **call the rider** (`tel:`) and a **WhatsApp help** deeplink
  (`OrderTrackingScreen.tsx:673`, `:528`).

**Post-delivery**
- Rating + comment (`Order.rating/ratingComment/ratedAt`, `rateOrder`
  `orders.service.ts:737`).
- Editable delivery address / receiver **before pickup only** (`EDITABLE_STATUSES`
  gate; `updateDeliveryAddress` `orders.service.ts:766`, `updateReceiver` `:795`).

> **Headline:** the *transport* (sockets, Redis fan-out, location storage, polling
> fallback, map, state machine, refunds-to-Razorpay) is largely built and is good. The
> gaps are mostly in **ETA quality, rider identity surfacing, refund/ support
> *visibility*, and a couple of correctness bugs** — not in raw plumbing.

### 2.2 What is missing ❌

1. **Server-side ETA / delivery promise.** No `Order.estimatedDeliveryAt` /
   `promisedAt`, no prep-time model, no road-distance travel-time estimate. The only
   ETA is client-side straight-line ÷ 20 km/h and exists **only once a rider has a live
   GPS fix** — there is *no ETA from placement* and none during packing. Notably,
   `Order.distanceKm` (road distance, `distanceSource = google_maps`,
   `schema.prisma:528`) already exists and is **ignored** by the ETA.
2. **Rider identity in the tracking payload.** `OrderDetailResponse.rider?{name,phone}`
   is declared (`packages/types/src/dto/order.dto.ts:53`) but `getOrder` returns the
   raw Prisma order **without** joining the rider's profile/phone
   (`orders.service.ts:353`). So the rider card / call button likely **never
   populate** in production. No photo, vehicle, or rating either.
3. **Number masking.** Rider/customer contact is the **raw phone** (`tel:` /
   `wa.me/<number>`). No privacy proxy — every competitor masks this.
4. **Refund visibility.** Refunds happen but are **not trackable by the customer**: no
   refund state machine surfaced ("initiated → processed"), no amount/destination/ETA
   on screen, no refunds list. There is no `Refund` entity — only `Payment.refundedPaise`
   and a ledger row.
5. **Structured, order-scoped support.** No support tickets/threads, no canned issue
   types, no auto-resolution (e.g. missing item → instant credit). Only a WhatsApp
   deeplink + call.
6. **Delivery proof.** No proof-of-delivery photo, no delivery OTP/PIN at the door, no
   `podImageUrl`/`deliveryOtp` fields. (Relevant for COD disputes and "marked
   delivered but not received".)
7. **Rider accept/reject flow.** `DeliveryAssignment.acceptedAt/rejectedAt` exist and
   the realtime layer comments a "60-second accept window", but there is **no
   endpoint** to accept/reject and `assignOrder` sets the order's `riderId`
   immediately — assignment is effectively **forced**, with no timeout-driven
   reassignment loop. (Acceptable for a captive-fleet MVP; a gap vs the marketplace
   model.)
8. **Map polish.** No route polyline and **no marker interpolation** — the rider dot
   teleports every ~8 s. No "rider has reached the shop / your location" geofence
   milestones.
9. **Group-level live tracking.** `getOrderGroup` returns money + a rolled-up status
   but **no rider, no location, no ETA** — a multi-shop order can't show a live map at
   the group level.
10. **Phase timestamps for `preparing / ready_for_pickup / out_for_delivery`.**
    `updateOrderStatus` only stamps `confirmed/picked_up/delivered/cancelled`
    (`orders.service.ts:452`). Other phase times exist only inside `OrderStatusHistory`
    (recoverable, but there's no first-class column for analytics/SLA).
11. **Proactive lateness handling.** No "running late" detection or messaging/credit.
12. **Tipping.** No tip concept (a marketplace-only nicety; likely out of scope).

### 2.3 What is incorrectly implemented ⚠️ (verify before relying on)

1. **`Order.riderId` identity mismatch — HIGH.** `assignOrder` stores the **`RiderProfile.id`**
   into `Order.riderId` (`dispatch.service.ts:117`), but several rider-side checks
   compare it against the **`User.id`**:
   - access check in `getOrder`: `role === 'rider' && order.riderId === userId`
     (`orders.service.ts:370`),
   - `codCollected` guard `order.riderId !== riderId` (riderId = userId)
     (`orders.service.ts:602`),
   - `markDelivered` guard `order.riderId !== riderId` (`orders.service.ts:634`).
   If `riderId` truly holds the profile id, these comparisons can never be true and the
   rider can't read/deliver/collect-COD on the order. Either the column's semantics are
   inconsistent across modules or one path is dead. **Must be reconciled and tested**
   before building tracking on top of `order.riderId`.
2. **Delivery transitions bypass the state machine — MEDIUM.** `codCollected` and
   `markDelivered` write `status: 'delivered'` directly **without** `assertTransition`
   (`orders.service.ts:605`, `:637`), so an order could jump to `delivered` from an
   illegal prior state. (`riderAdvance` in dispatch *does* gate batch logic but also
   writes status directly, `dispatch.service.ts:203`.) The state machine is only truly
   enforced in `updateOrderStatus`.
3. **DTO contract drift — MEDIUM.** `getOrder` returns the **raw Prisma row**
   (`cartSubtotalAtPricing`, `totalAmount`, no `deliveryAddress` snapshot object, no
   `rider`) while `OrderDetailResponse` promises `cartSubtotal`, `total`,
   `deliveryAddress`, `rider` (`order.dto.ts:43`). The client already hacks around this
   (a cast comment in `OrderTrackingScreen` notes "not `total` as in the DTO"). The
   serialization layer should own this mapping; today the contract is not honoured.
4. **`rider:location` rejects valid zero coordinates — LOW.** Guard `if (!data?.lat ||
   !data?.lng) return` (`realtime.plugin.ts:113`) drops `lat`/`lng === 0`. Harmless for
   Chirawa's coordinates, but it's a latent correctness bug (use `== null` checks).
5. **Client ETA is misleading — MEDIUM (UX).** Straight-line ÷ a fixed 20 km/h ignores
   the real road network and the already-computed `Order.distanceKm`; it will routinely
   under/over-state arrival. ETA should be server-owned (see §3.3).

### 2.4 Required backend APIs (target)

Existing endpoints to **keep**: `GET /orders`, `GET /orders/:id`, `GET
/orders/group/:groupId`, `DELETE /orders/:id`, seller transition endpoints, rider
`pickup`/`start-delivery`/`cod-collected`/`delivered`, `GET
/delivery/orders/:id/rider-location`, plus all socket events.

New / changed endpoints:

| Method & path | Purpose | Phase |
|---|---|---|
| `GET /api/v1/orders/:id` *(fix serialization)* | Return true `OrderDetailResponse`: mapped money fields, `deliveryAddress` snapshot, **populated `rider {name, maskedPhone, photoUrl?, vehicle?}`**, `eta` block, `payment` block, `refunds[]` | MVP |
| `GET /api/v1/orders/:id/tracking` *(new, lean)* | Poll-friendly tracking projection: `status`, `statusHistory`, `eta`, `riderLocation {lat,lng,ageMs}`, `rider` card — small payload for the tracking screen's poll fallback | MVP |
| `GET /api/v1/orders/group/:groupId` *(extend)* | Add group-level `rider`, `riderLocation`, `eta` so multi-shop orders get a live map | Phase 2 |
| `POST /api/v1/delivery/orders/:orderId/accept` / `…/reject` *(new)* | Rider accept/reject within the 60 s window; reject/timeout triggers reassignment | Phase 2 |
| `POST /api/v1/delivery/orders/:orderId/proof` *(new)* | Rider uploads POD photo / confirms delivery OTP | Phase 2 |
| `GET /api/v1/orders/:id/invoice` *(new)* | Itemised, adjusted bill (reflects refunded lines) + payment state; COD amount-due | MVP |
| `GET /api/v1/refunds?orderId=` and `GET /api/v1/refunds/:id` *(new)* | Customer-visible refund objects (state, amount, destination, ETA) | MVP→P2 |
| `POST /api/v1/support/tickets` + `GET /api/v1/support/tickets?orderId=` *(new)* | Order-scoped structured support with issue types; common issues can auto-credit | Phase 2 |
| `GET /api/v1/contact/proxy/:orderId` *(new)* | Returns a **masked** call/contact handle for rider↔customer instead of the raw phone | Phase 2 |

Socket additions: `order:eta` (server-pushed ETA updates), optional
`order:rider-assigned` (surface the assignment milestone), and keep `order:status` /
`order:location` / `order:item-unavailable`.

### 2.5 Required database fields / models (target)

Additions (no destructive changes implied; all nullable/back-compatible):

**`Order`**
- `estimatedDeliveryAt DateTime?` — the server-computed promise (the ETA hero).
- `etaComputedAt DateTime?`, `etaSource String?` (`'prep+road' | 'fallback'`).
- `preparingAt DateTime?`, `readyAt DateTime?`, `outForDeliveryAt DateTime?` —
  first-class phase timestamps (currently only in history).
- `deliveryProofUrl String?`, `deliveryOtp String?` (POD / handoff verification).
- *(Decide)* normalise `riderId` semantics — store **`User.id`** consistently, or add
  `riderUserId` and migrate the comparisons (fixes §2.3.1).

**`Shop`** (for the ETA model)
- `prepTimeMinutes Int @default(...)` (per-shop average packing time) — distinct from
  the existing customer-facing `estimatedDeliveryMinutes`.

**New `Refund` model** (make refunds first-class & trackable)
- `id, orderId, paymentId?, orderItemId?, amountPaise, reason, destination
  ('original' | 'wallet'), status ('initiated' | 'processing' | 'completed' |
  'failed'), razorpayRefundId?, etaText?, initiatedAt, completedAt`.
- Backfill from existing `Payment.refundedPaise` / `OrderItem.refundedPaise` /
  `Transaction(type=refund)`.

**New `SupportTicket` / `SupportMessage` models** (Phase 2)
- `SupportTicket: id, orderId?, userId, issueType, status, resolution, createdAt`.
- `SupportMessage: id, ticketId, senderRole, body, createdAt`.

**`RiderProfile`** (rider card)
- `photoUrl String?`, optional aggregate `ratingAvg Decimal?` for the rider card.

*(Already present and reusable: `RiderLocation`, `RiderAvailability.currentLat/Lng`,
`OrderStatusHistory`, `DeliveryAssignment.accepted/rejectedAt`, `Order.distanceKm`,
`Payment` refund fields, `Notification`.)*

### 2.6 MVP vs Phase 2

**MVP — "trustworthy tracking" (close the credibility gaps on what's half-built):**
1. **Fix `Order.riderId` semantics** (§2.3.1) and add `assertTransition` to the
   delivery/COD paths (§2.3.2). *Correctness — prerequisite for everything.*
2. **Honour `OrderDetailResponse`** in `getOrder` + add the lean `GET
   /orders/:id/tracking` projection; **populate the rider card** (name + phone).
3. **Server-side ETA v1**: `estimatedDeliveryAt = now + prepTimeMinutes +
   roadTravelMinutes(distanceKm)`, computed at placement and recomputed on each phase
   transition; push via `order:eta`; show a **range pre-OFD, countdown at OFD**. Retire
   the client straight-line ETA as the source of truth (keep it only as a last-ditch
   fallback).
4. **5-phase stepper** with timestamps + plain-language copy; map shown **only from
   pickup onward**, illustration+ETA before.
5. **Refund visibility v1**: surface `Payment.refundedPaise`/line refunds as a simple
   "Refund of ₹X initiated to <method>, expected in N days" block on the order +
   notification (read-only; no new model required to start).
6. **Itemised invoice** endpoint/screen reflecting adjusted totals + COD amount-due.
7. **Cancellation UX**: show the gate/consequence *before* the attempt (reason capture
   already exists).

**Phase 2 — "premium tracking":**
1. **Refund model** + full refund timeline (states, destination, ETA) and a
   refunds/wallet history; instant-to-wallet option.
2. **Rider accept/reject + reassignment loop**; surface the assignment milestone.
3. **Number masking** proxy for all rider↔customer contact.
4. **Map polish**: route polyline + marker interpolation + geofence milestones
   ("rider reached shop / arriving").
5. **Group-level live tracking** (rider + location + ETA on `getOrderGroup`).
6. **Structured, order-scoped support** with issue types and auto-resolution.
7. **Delivery proof** (POD photo / handoff OTP), esp. for COD.
8. **Proactive lateness** detection + messaging/credit; rider photo & rating on card.

---

## 3. Product & engineering specification

### 3.1 Customer-facing status model (display, not the DB enum)

Map the 9 DB states → **5 display phases** (legible, with copy + timestamp):

| Display phase | DB states | Customer copy (en) | Map? | ETA shown |
|---|---|---|---|---|
| **Confirmed** | `paid`, `confirmed` (and `pending_payment` → "Awaiting payment") | "Order confirmed" | No (illustration) | Range |
| **Packing** | `preparing`, `ready_for_pickup` | "Your order is being packed" | No (illustration) | Range |
| **Picked up** | `picked_up` | "Rider has your order" | Map appears | Tightening |
| **On the way** | `out_for_delivery` | "On the way to you" | Live map | **Countdown** |
| **Delivered** | `delivered` | "Delivered" + receipt | Static | — |
| **Cancelled** | `cancelled` | "Cancelled" + refund status | — | — |

The stepper reads `OrderStatusHistory` for per-phase timestamps. Terminal states always
link to the **money outcome** (receipt for delivered, refund status for cancelled).

### 3.2 Screen anatomy (top → bottom)

1. **Hero**: current phase + ETA (range/countdown/time). Pre-OFD: illustration. OFD:
   live `TrackingMap` (home pin + rider pin; P2: route + interpolation).
2. **Stepper**: 5 phases with ticks + timestamps.
3. **Rider card** (from `picked_up`): initial/photo, name, masked call button.
   *(Populate from the fixed `getOrder` — §2.3.2.)*
4. **Delivery details**: address snapshot + receiver; editable until pickup (exists).
5. **Bill**: itemised, adjusted for refunded lines; payment method/state; COD
   amount-due banner.
6. **Actions**: Cancel (state-gated, with consequence), Help (→ structured support in
   P2; WhatsApp/call until then), Rate (post-delivery).
7. **Refund block** when applicable: amount, destination, status, ETA.

*(If the attached screenshots specify a different layout/visual language, reconcile
this anatomy with them here before build.)*

### 3.3 ETA specification

**v1 (MVP), server-owned:**
```
prep      = Shop.prepTimeMinutes (configurable per shop; default e.g. 8)
travel    = roadTravelMinutes(Order.distanceKm)        // distanceKm already stored
            ≈ distanceKm / townAvgSpeedKmph * 60        // townAvgSpeed default ~18–22
estimatedDeliveryAt(at placement) = now + prep + travel
```
- Recompute on each phase transition: after `ready_for_pickup`, drop `prep`; from
  `out_for_delivery`, recompute `travel` from the **live rider→drop distance**
  and push `order:eta`.
- Persist `estimatedDeliveryAt`; show a **±range** (e.g. ±5 min) pre-OFD and a
  **countdown / "by HH:MM"** at OFD.
- Keep the client straight-line calc **only** as a fallback when no server ETA exists.

**v2:** real routing/traffic provider for `travel`; learned `prepTime` per shop/hour;
lateness detection (`now > estimatedDeliveryAt + grace` → proactive message).

### 3.4 Rider assignment & contact spec

- **MVP:** keep auto-assign (zone + load balance). Surface the rider card once assigned
  / `picked_up`. **Fix `riderId` semantics first.**
- **P2:** accept/reject endpoints + 60 s window + reassignment-on-reject/timeout;
  number-masking proxy for all contact; rider photo + rating on the card.

### 3.5 Live location spec

- **MVP:** reuse the existing socket (`order:location`) + Redis last-known + HTTP
  fallback. Show map **from pickup**. Fix the zero-coordinate guard (§2.3.4).
- **P2:** client marker interpolation between ticks; route polyline; geofence
  milestones ("reached shop", "arriving"); group-level location.

### 3.6 Payment / billing spec

- `GET /orders/:id/invoice`: item lines (with per-line refund/oos annotation), item
  total, delivery fee, discount, grand total, **payment method + state**; for COD a
  prominent **amount-due** (net of any refunded lines). Prepaid shows "Paid".
- Reflect `OrderItem.fulfillmentStatus = unavailable_refunded` in the bill.

### 3.7 Cancellation spec

- Keep the state gate (`pending_payment | paid | confirmed`). **Show the gate +
  refund consequence before** the user taps cancel. Keep reason capture. Post-gate,
  route to support (P2) with the refund policy stated.

### 3.8 Refund spec

- **MVP (read-only visibility):** derive a "Refund of ₹X to <method>, expected in N
  days" block from existing `Payment.refundedPaise` / line refunds + notification.
- **P2 (first-class):** `Refund` model with `initiated → processing → completed/
  failed`, amount, destination (`original | wallet`), ETA text, `razorpayRefundId`;
  refunds list in-app; instant-to-wallet option; itemised partial refunds tied to the
  line.

### 3.9 Support spec

- **MVP:** keep order-scoped WhatsApp/call (pre-fill order id, already done).
- **P2:** `SupportTicket`/`SupportMessage`, structured issue types ("missing item",
  "didn't arrive", "quality", "wrong item"), order context auto-attached, and
  auto-resolution rules (e.g. missing item under ₹X → instant wallet credit) with
  escalation to human.

### 3.10 Build order (dependency-aware)

1. **Correctness first:** fix `riderId` semantics (§2.3.1) + enforce transitions on
   delivery/COD paths (§2.3.2). *Blocks reliable tracking.*
2. **Serialization:** real `OrderDetailResponse` + lean `/tracking` projection +
   populated rider card.
3. **ETA v1** (server) + stepper + map-from-pickup.
4. **Invoice** + **refund visibility v1** + cancellation-consequence UX.
5. **P2** items in §2.6 order, each independent.

### 3.11 Open questions for product

1. **Captive fleet vs gig?** Decides whether rider accept/reject (§3.4) is MVP or P2.
2. **Refund destination default** — original method vs instant wallet credit? (Affects
   trust vs delight and the `Refund.destination` default.)
3. **Surface rider assignment as a milestone, or hide until OFD?** (q-commerce vs
   marketplace pattern — §1.2.)
4. **POD requirement for COD?** (Photo and/or OTP — §2.5.)
5. **`estimatedDeliveryMinutes` (static, per shop) vs computed `estimatedDeliveryAt`** —
   confirm the computed promise supersedes the static field on the tracking screen.
6. **Multi-shop group tracking** priority — is a single live map over split orders an
   MVP expectation, or acceptable to show per-child in v1?
