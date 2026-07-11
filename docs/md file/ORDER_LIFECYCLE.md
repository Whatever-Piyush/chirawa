# ORDER_LIFECYCLE.md

> Traced to code. Citations `path:line`. The order state machine is the spine of the
> whole platform; everything else (seller, rider, settlement) hangs off these transitions.

---

## 0. The state machine (the one source of truth)

Defined in `apps/api/src/modules/orders/order-status.ts:7`:

```
pending_payment ─► paid ─► confirmed ─► preparing ─► ready_for_pickup ─► picked_up ─► out_for_delivery ─► delivered
       │             │         │            │               │                │              │
       └─────────────┴─────────┴────────────┴───────────────┴────────────────┴──────────────┘
                                    └─► cancelled   (from any non-terminal state)
delivered = terminal,  cancelled = terminal
```

**Every** status write goes through one primitive — `transitionOrderStatus(tx, orderId, from, to, actor, extra)`
(`order-status.ts:58`):

1. `assertTransition(from, to)` — rejects illegal jumps **before** writing (`:21`).
2. Atomic **compare-and-set**: `updateMany WHERE status = from` — a concurrent writer that
   already moved the row gets `count === 0` and the call returns `false` (lost race), never
   clobbering (`:73`).
3. Stamps the per-status timestamp column (`confirmedAt`, `preparingAt`, … `:31`).
4. Appends an `OrderStatusHistory` row with the actor's role/id/reason (`:76`).

Always runs inside the caller's transaction, so the flip is atomic with the caller's other
writes (cash credit, payment capture, refund ledger). A same-status write is an idempotent
no-op (`:22`).

### Who owns each transition
| Transition | Owner (actor) | Code |
|------------|---------------|------|
| `pending_payment → paid` | Payments (customer paid) | `markOrderPaid` `payments.service.ts:387` |
| `pending_payment → confirmed` | **COD** starts at `confirmed` directly | `placeOrder` `orders.service.ts:261` |
| `paid → confirmed` | Seller accept / auto-accept | `sellerAcceptOrder` `:519`, `autoAcceptOrder` `:543` |
| `confirmed → preparing` | Seller | `sellerMarkPreparing` `:590` |
| `preparing → ready_for_pickup` | Seller | `sellerMarkReady` `:601` |
| `ready_for_pickup → picked_up` | Rider | `riderAdvance` `dispatch.service.ts:227` |
| `picked_up → out_for_delivery` | Rider (batch-gated) | `dispatch.service.ts:228` |
| `out_for_delivery → delivered` | Rider | COD: `codCollected` `:659`; prepaid: `markDelivered` `:708` |
| `* → cancelled` | Customer / Seller / Admin / Rider | see §7 |

---

## 1. Actors & ownership

| Actor | Role in an order | Authorization basis |
|-------|------------------|--------------------|
| Customer | Places, pays, can cancel pre-fulfillment, rates after delivery | `order.customerId === userId` |
| Seller | Accepts/rejects, prepares, marks ready | `order.shop.seller.userId === userId` |
| Rider | Picks up, delivers, collects COD, reports unavailable item | active `DeliveryAssignment` / `order.riderId === profileId` |
| Admin | Force-refund/cancel, manual assign, monitor | `requireRole('admin')` |
| System (worker) | Auto-accept, dispatch, payment reconcile, settle | no ownership check (gated by current status) |

---

## 2. Phase A — Cart → Checkout (`placeOrder`, `orders.service.ts:137`)

**Pre-conditions checked, in order:**
1. **Operating hours** 9 AM–8 PM IST, else `422 SHOP_CLOSED` (`:139`).
2. Cart exists in Redis (`cart:{userId}`) and is non-empty (`:147`).
3. Address exists, not deleted, owned by caller (`:152`).

**Aggregation resolve (Catalog Engine Phase 5).** "Aggregated" cart lines (fungible —
their `MasterCatalog` row is approved) are re-routed at checkout to the fewest in-stock
shops, then nearest, re-validating stock + price (`resolver.resolveCart`, `:169`). Pinned
lines (Chirawa Specials / legacy) keep their shop. A line nobody stocks is **dropped** and
surfaced to the client as "just sold out" (`droppedLines`, `:348`). If everything drops →
`BusinessRuleError` (`:184`).

**Per-shop split.** Resolved items are grouped by shop; **each shop becomes its own child
`Order`** (`:270`). A multi-shop cart creates one `OrderGroup` over N children (`:266`);
single-shop carts stay ungrouped (legacy).

**Pricing (flat).** One combined delivery fee for the whole cart (`pricing.service.ts`):
- cart < ₹100 → **₹25**; else any Chirawa Special shop → **₹15**; else **₹10**.
- The fee is carried by **one** child order (a Special shop if present, else the first);
  other children pay 0 (`orders.service.ts:221-228`).
- `distanceKm = 0`, `distanceSource = 'flat'` — no distance billing.

**Promo.** Customer code validated, else first-time customers auto-get `FIRSTORDER`
(free delivery). Discount applied at the **group** subtotal, landing on the fee-carrier
order (`:236-258`).

**Transaction body** (`:263-312`, all-or-nothing):
- create `OrderGroup` (if multi-shop) → for each shop: create `Order` (status =
  `pending_payment`, or `confirmed` for COD with `confirmedAt` set) → create `OrderItem`s →
  **`decrementStockOrThrow`** → write initial `OrderStatusHistory`.
- promo redemption + usage increment.

**Oversell protection** (`decrementStockOrThrow`, `:50`): for each tracked product
(`stockQty != null`), atomic conditional decrement `WHERE stockQty >= quantity`. `count === 0`
on a tracked product → reject the **whole** order (rolls back). Hitting 0 flips
`stockStatus → out_of_stock`. Untracked products (null) are skipped.

**Post-commit:** clear Redis + DB cart (`:314`); for each child order emit
`NEW_ORDER_FOR_SELLER` (if COD — see note) + `ORDER_STATUS_CHANGED`; compute initial ETA (`:317-332`).

**DB records written:** `Order`(N), `OrderItem`(M), `OrderGroup`(0/1),
`OrderStatusHistory`(N), `PromoRedemption`(0/1), `Product.stockQty` decrements.

**Idempotency** (`orders.routes.ts:45`): checkout dedupes on `Idempotency-Key` header, else
falls back to a server key `auto:{cartId}` — a double-tap or retry never creates duplicate
orders or duplicate Razorpay charges.

---

## 3. Phase B — Payment

### COD
Order is created already at `confirmed` (`:261`) — no payment phase. Seller is notified
immediately. Cash is collected at delivery (§6).

### Prepaid (UPI/card)
1. Checkout returns order(s) + the route calls `createCartPaymentOrder(orderIds)` — **one**
   Razorpay order for the **grand total**, one `Payment` row per child order sharing that
   `razorpayOrderId` (`payments.service.ts:64`, `orders.routes.ts:34`). (Fixes the prior bug
   where multi-shop carts under-charged.)
2. Client pays via Razorpay SDK; on success calls verify.
3. **Verify** (`verifyClientPayment`, `:138`): signature check (when configured), then
   `settleOrdersForRazorpayOrder` marks **every** linked order paid.
4. **Webhook** (`processWebhook`, `:157`) is the durable backstop: idempotent on
   `PaymentWebhookEvent.eventId`; **processes first, records after success** so a transient
   failure lets Razorpay retry (`:165-199`).
5. **Reconciliation** (every 15 min): orders stuck `pending_payment` >30 min are polled
   against Razorpay; a captured payment is marked paid (`reconciliation.job.ts:19`).

**`markOrderPaid`** (`:387`, the convergence point of all three paths) in one transaction:
`pending_payment → paid` (CAS) + flip pending `Payment` rows to `captured` + write
`customer_payment` `Transaction`. Then emits `ORDER_STATUS_CHANGED(paid)` and
`NEW_ORDER_FOR_SELLER` (`:420-435`). Idempotent: no-ops once paid/confirmed/delivered/cancelled.

**Capture-after-cancel edge:** if a capture lands on an already-cancelled order, the money
is auto-refunded instead of silently kept (`refundCancelledCapture`, `:114`).

---

## 4. Phase C — Seller acceptance

- **Accept** (`sellerAcceptOrder`, `:519`): allowed from `paid` or `confirmed`; stamps
  `sellerAcceptedAt`; drives `paid → confirmed` (online) or no-ops (COD already confirmed).
- **Auto-accept** (`autoAcceptOrder`, `:543`): a 3-min BullMQ timer (`SELLER_ACCEPT_MS`,
  `queues.ts:40`) scheduled on `NEW_ORDER_FOR_SELLER` by **seller-timeout.plugin** (runs in
  the **API** process so the resulting `confirmed` emit reaches dispatch + notifications).
  Increments `SellerProfile.missedAcceptances` to flag chronically unresponsive sellers.
  A stable `jobId` (`autoAcceptJobId`) dedupes the API-tier timer against the worker's
  reconciliation path (`queues.ts:45`).
- **Reject** (`sellerRejectOrder`, `:564`): cancels the order (refund-first ordering, §7).

`confirmed` is the trigger that opens dispatch (§5).

---

## 5. Phase D — Dispatch (confirmed → rider assigned)

Triggered by `ORDER_STATUS_CHANGED` where status === `confirmed`
(`dispatch.plugin.ts:18`). Fire-and-forget so it never blocks the transition.

**Batching** (`batching.service.ts`): the order joins or opens a **Batch** —
- same `DeliveryZone` (point-in-polygon, nearest-centroid fallback, `dispatch.service.ts:21`),
- within **800 m** of the batch anchor (`BATCH_RADIUS_M`),
- inside the **3-min** accumulation window (`BATCH_WINDOW_MS`),
- max **3** orders (`BATCH_MAX_SIZE`).

Outcomes (`addConfirmedOrderToBatch:39`): `joined`/`none` (existing batch's job covers it),
`new` (schedule assignment after the window), `assign-now` (batch full → assign immediately).

**Assignment** (`assignBatch`, `:110`) via the `assign-batch` worker job:
- candidate = **online** riders (`RiderAvailability.status='online'`), preferring those in
  the order's zone (`RiderZone`), else any online rider (3 km town simplification).
- pick the one with **fewest active deliveries** (`pickBestRider`, load-balancing, `:34`).
- in one transaction: create `DeliveryAssignment`(s), set `Order.riderId`,
  `Batch.status='assigned'`. Emit one `ORDER_ASSIGNED_TO_RIDER` for the whole batch.

**No rider available:** the job **retries every 60 s up to 10 attempts** (~10 min), then
**escalates by SMS** to `AppConfig['support_phone']` (`assignment.job.ts:35-57`). The order
stays `confirmed`/`preparing`/`ready_for_pickup` and unassigned (visible in the admin
dispatch view as `unassigned`).

> Note: dispatch starts at `confirmed`, **in parallel** with the seller preparing. The
> rider can be assigned and en route before the seller marks ready.

---

## 6. Phase E — Pickup → Delivery (rider)

All rider transitions go through `riderAdvance` (`dispatch.service.ts:189`), which verifies
an active `DeliveryAssignment`, then `transitionOrderStatus`, recomputes ETA, emits
`ORDER_STATUS_CHANGED`.

- **Pickup** `ready_for_pickup → picked_up` (`markPickedUp`).
- **Start delivery** `picked_up → out_for_delivery` (`startDelivery`). **Batch gate:** can't
  start until **every** order in the batch is picked up (`:200-204`).
- **Deliver:**
  - **COD** → `codCollected` (`:659`): `out_for_delivery → delivered` + credits
    `RiderProfile.codBalancePaise` by the **server-derived** order total (the client-sent
    amount is advisory only, `:671`). Idempotent: a retried collection on an already-delivered
    order returns success **without** re-crediting (`:667`). Keyed by **RiderProfile.id**.
  - **Prepaid** → `markDelivered` (`:708`): same transition, no cash recorded. COD orders are
    rejected here (must use `cod-collected`).

**Live tracking:** the customer subscribes to `order:{orderId}`; the rider pushes
`rider:location` ~every 8 s (Redis 30 s TTL + broadcast + DB). Customer cold-start / stale
fallback reads the last Redis location via `GET /delivery/orders/:id/rider-location` (`:233`).

**ETA** (`eta.service.ts`): recomputed at **every** phase transition (no provider calls).
`ETA = prep_remaining + travel + dwell + handover`. Travel = Haversine(shop→drop) × 1.3
road-factor ÷ 14 km/h town speed (`:15-20`). Floor 5 min. Sent to the client as a
**duration + serverNow** (clock-skew safe, `realtime.plugin.ts:208-224`).

---

## 7. Cancellation & refunds

**Who can cancel, and from where:**
| Path | Allowed from | Code |
|------|-------------|------|
| Customer cancel | `pending_payment`, `paid`, `confirmed` | `cancelOrder` `:612` |
| Seller reject | `paid`, `confirmed` | `sellerRejectOrder` `:564` |
| Admin refund | any state where `→cancelled` is legal (not delivered) | `initiateRefund` `payments.service.ts:204` |
| Rider item-unavailable (sole line) | `confirmed`/`preparing`/`ready_for_pickup` | `riderReportItemUnavailable` `:738` |

**The P0-2 safety ordering (every cancel path obeys it):**
> **Revoke fulfillability FIRST, refund LAST.** Flip the order to `cancelled` (and free the
> rider/batch) *before* the external Razorpay refund. A refund-gateway failure leaves a
> **cancelled order with a refund owed** — never a **refunded order that can still be
> fulfilled** (`orders.service.ts:626-650`).

**Atomic refund claim** (`refundCapturedOrderPayment`, `:295`): the `Payment` row is claimed
`captured → refunded` **before** any external call. Concurrent callers: exactly one wins
(`count===1`); the rest no-op. On gateway failure the claim is reverted so the refund is
retryable. Ledger (`refund` `Transaction`) is written **only after** the refund succeeds.

**Refund destinations:**
- Prepaid → Razorpay refund to original method (`Payment.refundedPaise`).
- COD → no money moved; the cash due is reduced (line refunds reduce `Order.totalAmount`).

**Item-unavailable safety net** (`riderReportItemUnavailable`, `:738`): rider finds a line
missing at the shop →
(a) flip that shop's `Product → out_of_stock` + bust catalog cache;
(b) atomic line claim `fulfilled → unavailable_refunded` (at-most-once, `:759`);
(c) if it was the **only** line → cancel + full refund + free rider; else refund just that
line (prepaid) or reduce cash due (COD), order proceeds;
(d) suggest the cheapest other in-stock shop carrying the same master;
(e) emit `ORDER_ITEM_UNAVAILABLE` to the customer (ask, don't auto-substitute).

**Address/receiver edits** allowed only pre-pickup (`EDITABLE_STATUSES` =
{pending_payment, paid, confirmed, preparing}, `:854`).

---

## 8. Phase F — Settlement & rating

- **Rating** (`rateOrder`, `:827`): customer, only after `delivered`, once
  (`ratedAt` guard).
- **Settlement** (next day 11 AM IST): the order's goods value flows into the seller's daily
  settlement — see **SELLER_LIFECYCLE.md §5** and `settlement.job.ts`. Goods value =
  `Σ(unitPrice×qty − refundedPaise)` so refunded item-unavailable lines aren't paid out
  (`settlementGoodsPaise`, `settlement.job.ts:41`).

---

## 9. Realtime events by phase

| Phase | Event(s) | Recipients |
|-------|----------|-----------|
| Placed (COD) / Paid | `NEW_ORDER_FOR_SELLER`, `ORDER_STATUS_CHANGED` | seller (alarm + FCM), customer |
| Confirmed | `ORDER_STATUS_CHANGED(confirmed)` | customer FCM; **dispatch** trigger |
| Assigned | `ORDER_ASSIGNED_TO_RIDER` | rider (alarm + FCM) |
| Preparing/Ready/Pickup/OFD | `ORDER_STATUS_CHANGED`, `ORDER_ETA_CHANGED` | customer (socket + FCM at picked_up/OFD) |
| Delivered | `ORDER_STATUS_CHANGED(delivered)` | customer FCM+SMS, seller FCM |
| Cancelled | `ORDER_STATUS_CHANGED(cancelled)` (+`refundedPaise`), `ORDER_CANCELLED_FOR_SELLER` | customer (refund amount), seller, rider |
| Item unavailable | `ORDER_ITEM_UNAVAILABLE` | customer |

---

## 10. Failure modes & guarantees

| Failure | Guard | Result |
|---------|-------|--------|
| Double-tap checkout | Idempotency-Key / `auto:{cartId}` (`orders.routes.ts:45`) | One order, one charge |
| Oversell | atomic conditional decrement (`:50`) | Whole order rolled back |
| Two writers race a transition | CAS in `transitionOrderStatus` (`:73`) | Loser no-ops; no clobber |
| App crash mid-payment / webhook lost | 15-min reconciliation (`reconciliation.job.ts`) | Order marked paid, seller alerted **durably** |
| Duplicate webhook | `PaymentWebhookEvent` unique + process-then-record | Processed once |
| Refund gateway fails | claim reverted, order stays cancelled | Refund retryable; never fulfillable-but-refunded |
| Capture after cancel | `refundCancelledCapture` (`:114`) | Auto-refunded |
| Seller ignores order | 3-min auto-accept (`seller-timeout.plugin`) | Order progresses |
| No rider online | retry 60s×10 → SMS escalation | Founder manually assigns |
| Worker→API event dropped (bridge lossy) | durable BullMQ + direct FCM in job (`reconciliation.job.ts:96`) | Critical effects still happen |
| COD double-confirm | idempotent delivered-state return (`:667`) | No double cash credit |

**Launch-critical (must hold for go-live):**
1. State machine + CAS — no illegal/lost transitions.
2. Refund safety ordering (P0-2) — money safety.
3. Payment reconciliation — no paid-but-stuck orders.
4. Oversell protection — no selling stock you don't have.
5. Auto-accept + no-rider escalation — orders never silently stall.
6. Idempotent checkout — no duplicate charges.
