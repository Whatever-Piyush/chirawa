# REFUND_WORKFLOW_DESIGN.md

**Invariant (the one rule):** *No order may be in a `refund-succeeded` state while it is still
**fulfillable**.* An order is **fulfillable** iff `status ∈ {paid, confirmed, preparing,
ready_for_pickup, picked_up, out_for_delivery}` — i.e. a seller can still prepare it or a rider can
still deliver it. Scope: full refund + cancel durability. (Partial line refunds attach to the same
refund record but revoke only the *line*, not the order — out of scope here.)

---

## 1. P0-1 / P0-2 — the defects this closes

**P0-1 — Non-atomic money-out → cancel window, with no refund reconciliation.**
Every full-refund path moves money and then, in a **separate** operation, flips the order to
`cancelled`:
- `cancelOrder` → `refundCapturedOrderPayment(...)` *then* `updateOrderStatus(...,'cancelled')` (orders.service.ts:609–616)
- `sellerRejectOrder` (561–567) and single-line `riderReportItemUnavailable` (763–767) — same shape
- admin `initiateRefund` → `createRefund(...)` *then* a **distinct** `$transaction` for the cancel (payments.service.ts:206–229)

If the process dies (or the DB write throws) **after Razorpay refunds but before the order is
cancelled**, the order stays `paid`/`confirmed`/`preparing`/… — **refunded *and* fulfillable**. The
only reconciliation that exists (`reconcilePendingPayments`, reconciliation.job.ts) covers
`pending_payment → paid` **only**; nothing detects `payment.refunded ∧ order.fulfillable`. The admin
path even surfaces the violation as manual toil: on a lost CAS it throws *"Refund issued but order
status changed; cancel manually"* (payments.service.ts:229) — money gone, order still fulfillable, a
human in the loop.

**P0-2 — Split ownership + no gateway idempotency/confirmation.**
`refundCapturedOrderPayment` explicitly *"does NOT change order status — the caller owns the status
transition"* (payments.service.ts:270–273). Money-movement and fulfillability-revocation live in
**different layers**, coupled only by convention. Any caller exception or lost CAS
(`updateOrderStatus` throws *"Order status changed concurrently"*, orders.service.ts:490) **after** the
refund leaves the same refunded-but-fulfillable state. Compounding it: `createRefund`
(razorpay.service.ts:83) carries **no idempotency key** (only payouts use `X-Payout-Idempotency`), so a
crash-retry can issue a **second** refund; and `processWebhook` handles only
`payment.captured`/`payment.failed` — there is **no `refund.processed`/`refund.failed` handler**, so a
refund's *terminal* outcome is never confirmed asynchronously.

Both are one root cause: **money leaves in a step that is neither atomic with, nor reconciled against,
the revocation of fulfillability.**

---

## 2. Refund lifecycle — durable record + Razorpay idempotency

Promote the refund to a **first-class durable record** (extend `Payment`, or a `Refund` row keyed by
`paymentId`) written **before** any external call:

| Field | Purpose |
|---|---|
| `refundState` | `requested → gateway_pending → succeeded` / `failed` |
| `idempotencyKey` | deterministic, persisted **before** the call (e.g. `rfnd:{orderId}:{paymentId}`) |
| `gatewayRefundId` | Razorpay refund id once accepted (dedupe + audit) |
| `amountPaise`, `reason`, `attempts`, `nextRetryAt` | reconciliation inputs |

**State machine:** `requested → gateway_pending → succeeded`; `gateway_pending → failed → (retry)
gateway_pending`. **`succeeded` and `cancelled` are terminal — never reversed.**

**Idempotency (req. 3):** pass the persisted `idempotencyKey` on the refund create call (the same
header mechanism the payout path already uses). A retry after a crash **reuses the same key** →
Razorpay returns the *original* refund instead of creating a second one. Cross-check on
`gatewayRefundId` before re-issuing. **Truth source for terminal state is the
`refund.processed` / `refund.failed` webhook** (new handler), not the synchronous create return
(Razorpay refunds settle asynchronously).

---

## 3. Cancel lifecycle — **revoke-first inversion**

Invert today's order. **Revoke fulfillability first, atomically with the refund intent, in one DB
transaction; move money second; finalize third.**

1. **`assert + lock` (one txn):** `assertTransition(status → cancelled)`; CAS `Order.status →
   cancelled` (revoke fulfillability) **+** claim `Payment captured → refund_pending` **+** insert
   the `refundState=requested` record **+** status-history — all-or-nothing. The instant this commits
   the order is **non-fulfillable**; the refund amount is already known, so the customer notification
   still quotes it.
2. **Move money:** call Razorpay with the idempotency key → on accept, `requested → gateway_pending`.
3. **Finalize:** on `refund.processed` webhook (or reconcile poll) → `gateway_pending → succeeded` +
   write the `refund` ledger row.

**We never un-cancel.** If the refund permanently fails, the order *stays* cancelled and we keep
owing/retrying the refund — the **safe** failure (we never re-expose goods we've already refunded).
**COD / unpaid:** no captured payment ⇒ no gateway step; step 1 *is* the whole operation.

```
fulfillable ──cancel request──▶ cancelled + refund_pending ──gateway──▶ cancelled + succeeded
   (P0 window collapses: the only intermediate state is "cancelled, refund owed" — safe + reconcilable)
```

---

## 4. Reconciliation — the saga coordinator

A periodic sweep (extend the existing reconciliation worker) drives every record to a consistent
terminal state. It is the durable backstop; the new refund webhooks are the fast path.

| Detected divergence | Action |
|---|---|
| `refund_pending`/`gateway_pending` **and** `attempts` exhausted not yet | re-issue with the **same** idempotency key; advance state |
| `cancelled` **and** refund **not** `succeeded` past SLA | retry gateway; after N attempts → **dead-letter + admin alert** |
| `refund succeeded` **and** order still **fulfillable** (defense-in-depth for any legacy path) | force `→ cancelled` + history; alert |
| Razorpay refund exists but **no** local record (e.g. capture-after-cancel) | adopt `gatewayRefundId`, mark `succeeded` (extends `refundCancelledCapture`, payments.service.ts:93) |

Add **`refund.processed` / `refund.failed`** to `processWebhook`, recorded through the existing
`PaymentWebhookEvent` idempotency table so re-delivery is a no-op.

---

## 5. Failure recovery — saga + compensation

Each step is idempotent and crash-resumable from the persisted record. Crash matrix:

| Crash point | Persisted state on restart | Recovery |
|---|---|---|
| After step-1 commit, before gateway | `cancelled` + `requested` | order already safe; reconcile issues the refund |
| After gateway accept, before finalize | `cancelled` + `gateway_pending` + `gatewayRefundId` | webhook/poll finalizes; idempotency key prevents a 2nd refund |
| Gateway returns terminal failure | `cancelled` + `failed` | bounded retry (backoff on `nextRetryAt`); then dead-letter + alert; **order stays cancelled** |
| Gateway timeout/unknown | `cancelled` + `gateway_pending` | reconcile re-issues with same key → original refund returned (no double pay) |

**Rules:** (a) **forward-only** — compensation fixes money forward (retry/dead-letter), never reverses
a cancel; (b) bounded retries with backoff, then a `refund_failed` dead-letter queue + admin alert so
no owed refund is silently lost; (c) idempotency key + `gatewayRefundId` guarantee **at-most-once**
money movement across every retry and concurrent caller.

**Net:** fulfillability is revoked atomically and first; money movement is an idempotent, webhook-
confirmed, reconciled follow-up. The P0 "refunded-but-fulfillable" window is structurally impossible.
