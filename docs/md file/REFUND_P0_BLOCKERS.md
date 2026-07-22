# REFUND_P0_BLOCKERS.md

Prioritization of **money-loss defects** in the refund / cancel / settlement path, re-confirmed against
live source (`file:line` below). Scope = defects that can cause a wrong charge, wrong refund, double
refund/credit, fulfillment-after-refund, or seller/rider/platform money corruption. Architecture,
scalability, dashboard edge cases, and post-launch work are **excluded**. No redesign — fixes are
surgical.

---

## A) P0 BLOCKERS — must fix before launch

### P0-1 — Settlement pays sellers for item-unavailable lines that were refunded to the customer
- **Evidence:** `apps/api/src/worker/jobs/settlement.job.ts:85-87` and `:313-315` sum
  `item.unitPrice * item.quantity` over **all** order items, never inspecting `fulfillmentStatus` or
  subtracting `refundedPaise`. The refund path that creates the mismatch:
  `apps/api/src/modules/orders/orders.service.ts:778-789` refunds the line (prepaid) and decrements
  `cartSubtotalAtPricing` / `totalAmount`, but leaves the `OrderItem`'s `unitPrice`/`quantity` intact.
  The seller's own estimate (`apps/api/src/modules/sellers/sellers.service.ts:99-101`) uses the
  **decremented** `cartSubtotalAtPricing` — so the actual payout exceeds even what the seller app shows.
- **Reproduction:** 2-line prepaid order A ₹100 + B ₹100. Rider reports B unavailable → customer
  refunded ₹100 (Razorpay), order delivers with A. Nightly settlement sums A+B = ₹200 → seller paid
  ₹200 for ₹100 of delivered goods. The ₹100 leaves the platform twice (customer refund + seller payout).
- **Business impact:** direct, recurring **platform loss** equal to the refunded goods value on every
  multi-line order with an unavailable line that still delivers.
- **Status:** **OPEN.**
- **Minimal fix:** in both sum sites, derive goods value from `cartSubtotalAtPricing` (already
  decremented, already what the seller estimate uses), or exclude
  `fulfillmentStatus = 'unavailable_refunded'` lines / subtract `refundedPaise` (add those fields to the
  `items` select at `:67` / `:303`). No schema change.
- **Severity:** P0.

### P0-2 — Refund succeeds but the order is left fulfillable (refund ↔ cancel not atomic)
- **Evidence:** the external refund and the order-cancel are separate operations in every path:
  - Admin: `apps/api/src/modules/payments/payments.service.ts:198-216` claims the payment + calls
    `createRefund`, then a **separate** `$transaction` cancels (`:219-228`); on a lost CAS it throws
    *"Refund issued but order status changed; cancel manually"* (`:229`) — money refunded, order **not**
    cancelled. A retry then finds no captured payment (`:190`) and still never cancels.
  - Customer cancel: `orders.service.ts:609-616` (`refundCapturedOrderPayment` then `updateOrderStatus`),
    which throws *"Order status changed concurrently"* (`:490`) **after** the refund.
  - Seller reject `:561-567`; single-line item-unavailable `:763-767` — same shape.
- **Reproduction:** admin refunds order X (`confirmed`) at the instant the seller advances it
  `confirmed→preparing`. Claim + `createRefund` succeed; the cancel CAS (`WHERE status='confirmed'`)
  matches 0 rows → throws "cancel manually." X stays `preparing` (fulfillable) and refunded; the
  rider/seller proceed to deliver it.
- **Business impact:** customer keeps **both** the goods and the money — full order-value loss per
  occurrence; clears only by manual DB intervention.
- **Status:** **PARTIALLY FIXED** — double-refund is prevented (claim-before-refund CAS), but the
  refund↔cancel atomicity is not: an order can remain fulfillable after a completed refund.
- **Minimal fix:** flip the order to `cancelled` in the **same transaction** as the payment claim
  (claim + cancel atomic), **before** the external `createRefund`; the existing failure-revert already
  restores the claim if the gateway call fails. No new components.
- **Severity:** P0.

---

## B) P1 BACKLOG — important, not launch-blocking

### P1-1 — Capture-after-cancel missed when BOTH webhook and verify are lost
- **Evidence:** capture-after-cancel runs only via `settleOrdersForRazorpayOrder` →
  `refundCancelledCapture` (`payments.service.ts:80-115`), triggered by the webhook (`:157`) or client
  verify (`:132`). The reconciler scans only `status:'pending_payment'`
  (`apps/api/src/worker/jobs/reconciliation.job.ts:27-29`) — a `cancelled` order whose Payment row is
  still `pending` is never polled.
- **Reproduction:** customer cancels a `pending_payment` order; the UPI collect captures a moment later;
  webhook delivery fails **and** the client never calls verify → money captured at Razorpay, never refunded.
- **Business impact:** customer charged for a cancelled order, not refunded. Requires a double failure
  (Razorpay retries webhooks ~24h), so low-probability but real money-out.
- **Status:** OPEN.
- **Minimal fix:** extend the existing reconciler to also scan `cancelled` orders with a `pending`
  Payment carrying a `razorpayOrderId`; on a gateway `captured`, route into the existing
  `refundCancelledCapture`. Reuses current code.
- **Severity:** P1.

### P1-2 — Crash between line-claim commit and line refund → customer under-refunded, retry blocked
- **Evidence:** `orders.service.ts:733-739` commits the `OrderItem` claim
  (`fulfilled→unavailable_refunded`, `refundedPaise` set) in its **own** statement; the actual refund
  (`refundOrderLine`, `:780`) + ledger run afterward. A crash in between leaves the line marked refunded
  with no money returned; the retry fails the CAS at `:733` → *"Yeh item pehle hi report ho chuka hai"*
  (`:738`) so the refund never issues.
- **Reproduction:** rider reports a line unavailable; process dies after `:736` commits, before `:780`.
- **Business impact:** customer charged for the missing item, silently under-refunded by one line.
- **Status:** PARTIALLY FIXED — double-report is prevented by the CAS; the crash-window under-refund is not.
- **Minimal fix:** move the `OrderItem` claim into the same `$transaction` as the refund record + total
  decrement, so the claim cannot persist unless the refund is recorded.
- **Severity:** P1.

### P1-3 — Refund assumed successful; gateway terminal state never confirmed
- **Evidence:** `processWebhook` handles only `payment.captured` / `payment.failed`
  (`payments.service.ts:153`, `:161`) — there is **no** `refund.processed` / `refund.failed` handler.
  All helpers treat `createRefund` returning as success (mark `refunded` + ledger + cancel) without
  checking the returned refund status or any later gateway failure.
- **Reproduction:** `createRefund` accepted as `pending`; the refund later fails at the gateway. Records
  say the customer was refunded; they were not.
- **Business impact:** customer not refunded though the system believes so. Recoverable; not a platform
  money-loss. `refund.failed` is uncommon.
- **Status:** OPEN.
- **Minimal fix:** add `refund.processed` / `refund.failed` handlers, recorded through the existing
  `paymentWebhookEvent` idempotency table; on failure, flag for retry/alert. Additive.
- **Severity:** P1.

---

## C) P2 BACKLOG

### P2-1 — `refundedPaise` under-reports after a partial-then-full refund (accounting/display only)
- **Evidence:** `refundOrderLine` **increments** `refundedPaise` (`payments.service.ts:348`); a later
  full cancel via `refundCapturedOrderPayment` **overwrites** `refundedPaise = order.totalAmount`
  (`:288`, the already-decremented total), dropping the earlier line-refund amount. The **actual**
  Razorpay refunds are correct (line + decremented total = original captured); only the cached field
  under-counts.
- **Business impact:** the Tracking-V2 refund card (derived from `refundedPaise`) shows a refunded
  amount lower than reality. **No money movement error.**
- **Status:** OPEN.
- **Minimal fix:** have the full-refund claim `increment` `refundedPaise` (or set it to total-refunded-
  to-date) instead of overwriting.
- **Severity:** P2.

---

## Verified FIXED — considered, **not** blockers (do not re-raise)
- **COD collected amount was client-supplied (BUG-001):** now server-derived
  `amountDue = order.totalAmount`, client value ignored (`orders.service.ts:648`), with an idempotent
  delivered-state guard (`:644`).
- **Double refund on the full-refund paths:** prevented by the claim-before-refund CAS
  (`payments.service.ts:198-202`, `:286-290`).
- **Double report / double refund on item-unavailable:** prevented by the `OrderItem` CAS
  (`orders.service.ts:733-736`).
- **Capture-after-cancel (when a webhook/verify signal arrives):** prevented from double-refunding by
  the `pending→refunded` claim CAS (`payments.service.ts:96-100`).
- **Partial-then-full refund double-pay:** not a defect — the `totalAmount` decrement
  (`orders.service.ts:787`) makes the subsequent full refund cover only the residual.
