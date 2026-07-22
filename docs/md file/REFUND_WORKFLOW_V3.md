# REFUND_WORKFLOW_V3.md

**Scope:** amends `REFUND_WORKFLOW_V2.md`. Every V2 concept stands — revoke-first, single Refund
executor + single reconciler, the three state machines, the ownership table, transactions **T1–T3**,
invariants **I1–I4** — **except the sections amended below.** Closes 7 residual blockers. No code.

## B1 — Capture-after-cancel when webhook **and** verify are both lost
*(amends §7 Reconciliation, §8 Capture-after-cancel)*
Today only a `payment.captured` webhook or the client verify call triggers capture-after-cancel, and
`reconcilePendingPayments` scans only `pending_payment` orders — so a `cancelled` order whose capture
was lost is **invisible**. Add a reconciler sweep: every `cancelled` order with a `pending` Payment row
that carries a `razorpayOrderId`, has no terminal Refund, and is within a bounded lookback, is polled
via `fetchPaymentsByOrderId(razorpayOrderId)`. A `captured` payment at the gateway routes into the §8
executor (claim `pending→refunded` CAS → open `Refund(source=capture_after_cancel)` → run). Webhook,
verify, and **poll** are now three independent triggers into one path; losing any two still refunds.

## B2 — Correct Razorpay refund idempotency contract
*(replaces §5)*
**V2 was wrong:** `X-Payout-Idempotency` is a **RazorpayX/Payouts** header; the **core Refund API has
no idempotency-key header.** Verified contract (`POST /payments/{id}/refund`): body takes `amount`
(**must be ≤ captured**), `speed:'normal'`, `notes` (≤15 kv pairs), and `receipt` (free-form client
reference — **not** enforced as a dedup key). `instance.payments.fetchMultipleRefund(paymentId)` lists
all refunds on a payment. Idempotency is therefore **client-owned, list-before-create**:
1. Persist a deterministic key in **T1**; write it into the refund's `notes.refundKey` (+ `receipt`).
2. Before any create, `fetchMultipleRefund(razorpayPaymentId)`; if an item already carries our
   `notes.refundKey`, **adopt** it (store `gatewayRefundId`, finalize) — never create a second.
3. Local at-most-once: unique `Refund.idempotencyKey` + the `captured→refund_pending` CAS gate the
   create. The gateway `amount ≤ captured` rule is a backstop, not the mechanism.

**Deterministic key:** `rfnd:{razorpayPaymentId}:{orderId}:{kind}:{lineId|full}` — recomputable from
durable state alone (load-bearing for B5 and B7).

## B3 — Unknown remote refunds (dashboard / manual)
*(amends §6 Webhook, §7 Reconciliation)*
A refund issued from the Razorpay dashboard arrives as `refund.processed`/`refund.created` (or surfaces
in `fetchMultipleRefund`) with a `gatewayRefundId` we never created. Handler and reconciler **adopt**
it: `notes.refundKey` match → finalize that intent; **no match** → create
`Refund(source=dashboard, kind=inferred from amount vs capture balance)`, update `refundedPaise`, write
the ledger. If it fully refunds a **still-fulfillable** order → enforce **I4** (force `→cancelled` +
alert). If its order already settled → emit a clawback (§10). Remote refunds are first-class — merely
*discovered* rather than *initiated*.

## B4 — Aggregate refundable balance
*(extends §3 ownership, §5)*
Authority for "how much is still refundable" is the **capture**, never a single Payment row:
`refundable(capture) = capture.amount − Σ fetchMultipleRefund(razorpayPaymentId).items[].amount`,
reconciled to the sum of local non-`failed` Refund records. The executor, holding a lock keyed on
`razorpayPaymentId`, rejects any intent exceeding `refundable`. `Payment.refundedPaise` is a **derived
projection** (cache) of processed refunds, never the source of truth. Owner: the Refund executor.

## B5 — Shared gateway payment across child orders
*(amends §4, §5)*
A multi-shop cart is one Razorpay capture → **N child Payment rows sharing one `razorpayPaymentId`**
(`createCartPaymentOrder` → `markOrderPaid`). Therefore **the unit of refundable balance and gateway
dedup is the `razorpayPaymentId` (capture), not `Payment.id`.** A child order's "full" refund is a
**partial** refund of the shared capture; refunds from all children draw down the same balance (B4) and
the gateway caps their cumulative sum at the captured amount. The `{orderId}` segment of the key keeps
each child's refund a distinct intent on the shared capture; the executor lock is **per-capture**,
serializing concurrent child refunds.

## B6 — Partial + full refund interaction
*(amends §2 Payment machine, §4)*
A line (partial) refund leaves the order **fulfillable** and the payment **`captured`**, incrementing
`refundedPaise`. A later full cancel must refund only the **residual**:
`residual(order) = order.totalAmount − Σ processed line refunds for that order`. T1 records
`Refund(kind=full, amount=residual)` and flips `captured→refund_pending`; an already-refunded line is
never re-refunded. The `captured→refund_pending` CAS **serializes** the two states: while a full refund
holds the claim no new line refund starts, and once `refund_pending/refunded` (order `cancelled`,
terminal) no line refund is possible. `residual ≤ 0` (lines already cover the total) → cancel-only, no
gateway call.

## B7 — Crash after payment claim, before Refund record
*(amends §4, §5)*
**Primary fix:** the claim (`captured→refund_pending`), the `Refund(requested)` insert, and
`order→cancelled` are **one transaction (T1)** — a standalone claim statement is forbidden, so the
window cannot exist on the happy path. **Backstop:** the reconciler treats any payment in
`{refund_pending, refunded}` with **no terminal Refund record** as orphaned → reconstruct the intent
from the **deterministic key** (B2, recomputable from `razorpayPaymentId + orderId + kind`), then
`fetchMultipleRefund` to adopt an existing gateway refund or submit one. Determinism guarantees the
reconstructed intent maps to the **same** gateway refund — at-most-once survives the crash.

## Net effect on V2
I1–I4 are unchanged and now hold under lost webhook **and** verify (B1), remote/dashboard refunds (B3),
shared captures (B5), and mid-claim crashes (B7). Idempotency is gateway-correct (B2) and balance-safe
across partial / full / remote / multi-order draws on one capture (B4/B5/B6). Two implementation
contracts this assumes: tag every refund with `notes.refundKey`, and use `fetchMultipleRefund` as the
list-before-create + reconcile primitive (both confirmed in the installed Razorpay node SDK).
