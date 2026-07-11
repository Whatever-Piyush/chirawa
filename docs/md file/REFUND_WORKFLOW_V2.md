# REFUND_WORKFLOW_V2.md

**Invariant:** an order may never be **fulfillable** (`status ∈ {paid, confirmed, preparing,
ready_for_pickup, picked_up, out_for_delivery}`) once a full refund has been *requested*.
**Two principles:** (a) **revoke-first** — fulfillability is revoked atomically *before* money moves;
(b) **single executor** — every refund (customer / seller / rider / admin / capture-after-cancel)
funnels through **one** Refund executor + **one** reconciler. No path touches Razorpay directly.

## 1. Codex findings → resolution

| # | Finding | Root cause (file:line) | Resolution |
|---|---|---|---|
| F1 | Refund succeeds but cancellation fails | `initiateRefund` refunds, *then* a separate txn cancels; lost race throws *"cancel manually"* (payments.service.ts:206–229) | cancel + claim + refund-intent in **one** txn **T1** (§4); no post-refund cancel step to fail |
| F2 | Auto-refund **before** cancellation | `cancelOrder`/`sellerReject`/item-unavailable call `refundCapturedOrderPayment` then `updateOrderStatus` (orders.service.ts:609–616, 561–567, 763–767) | invert: T1 cancels first; gateway refund is an idempotent follow-up (T2) |
| F3 | Capture-after-cancel recovery | `refundCancelledCapture` is ad-hoc inside `settleOrdersForRazorpayOrder` (payments.service.ts:80–115) | becomes one **entry point** into the shared executor (§8) |
| F4 | Refund idempotency ownership | 4 divergent CAS claims; `createRefund` has **no** idempotency key (razorpay.service.ts:83); `refundOrderLine` doesn't even claim (326–360) | executor owns one persisted key per intent (§5) |
| F5 | Refund reconciliation ownership | `reconcilePendingPayments` covers only `pending→paid` (payments.service.ts:239–260); nothing finalizes refunds | dedicated reconciler owns refund liveness + the invariant guard (§7) |

## 2. State machines

**Order** (unchanged; `transitionOrderStatus` is the only writer): `pending_payment→{paid,cancelled}
→ paid→{confirmed,cancelled} → … → out_for_delivery→{delivered,cancelled}`; **`delivered`,
`cancelled` terminal.**
**Payment:** `pending→{captured,failed}`; full refund: `captured→refund_pending→refunded`; partial:
stays `captured`, `refundedPaise` increments.
**Refund (new durable record):** `requested → submitted → processed`; `submitted→failed→(retry)
submitted`. **`processed` terminal-success; never reversed.** Fields: `kind(full|line|manual)`,
`idempotencyKey`, `gatewayRefundId`, `amountPaise`, `state`, `attempts`, `nextRetryAt`,
`source`, `adminId?`, `reason`.

**Coupling invariants** (the contract between the three machines):
- **I1** Refund `requested|submitted|processed` (kind=full) ⟹ Order = `cancelled`.
- **I2** Payment `refund_pending|refunded` ⟹ Order = `cancelled` ∧ a Refund record exists.
- **I3** Order `cancelled` ∧ a captured payment existed ⟹ exactly one full Refund eventually `processed` (reconciler guarantees liveness).
- **I4** Order fulfillable ∧ any processed full Refund ⟹ **violation** → reconciler force-cancels + alerts.

## 3. Ownership (exact)

| Concern | **Sole owner** | Primitive | Who may write |
|---|---|---|---|
| **Order status** | `order-status` (`transitionOrderStatus`) | `assertTransition` + CAS `updateMany WHERE status=from` + history | only this fn; the saga *requests* a transition, never writes `status` directly |
| **Payment status** | payments service | CAS `updateMany WHERE status=expected` | capture → `markOrderPaid`; refund claim/finalize → executor; nobody else |
| **Refund status** | **Refund executor** (one component) | durable record + state CAS | orchestrators create `requested`; executor advances `submitted`; webhook/reconciler finalize `processed/failed` |

Order status never *implicitly* follows refund status. The **saga orchestrator** is the only place
that sequences them, and it does so inside the single transaction **T1**.

## 4. Saga orchestration (revoke-first)

- **T1 (one DB txn, atomic):** `assertTransition(order→cancelled)` → CAS `order→cancelled` → CAS
  `payment captured→refund_pending` → insert `Refund(requested, idempotencyKey)` → history. **Commit ⟹
  order non-fulfillable.** Refund amount is known here, so the cancel notification still quotes it.
- **T2 (executor, external):** `createRefund(idempotencyKey)` → `requested→submitted`, store
  `gatewayRefundId`. Idempotent; safe to retry.
- **T3 (webhook/reconciler):** `refund.processed` → `submitted→processed`, payment
  `refund_pending→refunded`, write `refund` ledger row.

**We never un-cancel.** A permanently failing refund stays `cancelled` + owed/retried — the safe
failure (goods are never re-exposed). COD/unpaid: no captured payment ⇒ T1 is the whole operation.

## 5. Idempotency strategy

**One** deterministic key per intent — `rfnd:{paymentId}:{kind}:{lineId|full}` — persisted in the
Refund record in **T1**, *before* any gateway call; **retries reuse it** (never per-attempt). Passed as
the Razorpay idempotency header (same mechanism the payout path already uses, `X-Payout-Idempotency`,
razorpay.service.ts:205) ⟹ a retried create returns the **original** refund, never a second.
Defense layers: unique constraint on `Refund.idempotencyKey`; the `captured→refund_pending` CAS admits
exactly one full-refund claimant; reconciler cross-checks `gatewayRefundId` before re-issuing. The
executor owns the key — callers never construct gateway calls.

## 6. Webhook behavior

Add `refund.processed` and `refund.failed` to `processWebhook`, recorded through the existing
`PaymentWebhookEvent` table (unique `eventId`, **process-then-record**) so re-delivery is a no-op.
- `refund.processed` → match `gatewayRefundId` → run T3 (idempotent; no-op if already `processed`).
- `refund.failed` → `submitted→failed`, set `nextRetryAt` (reconciler retries).
- `payment.captured` on an already-`cancelled` order → route to §8, **not** `markOrderPaid`.
Webhooks are the **fast path**; the reconciler is the **durable backstop** — neither is trusted alone.

## 7. Reconciliation behavior

A single `refundReconciler` (extend the 15-min worker) **owns refund liveness**. Each pass:
1. Refund in `{requested, submitted, failed}` past SLA → resume T2 / poll Razorpay by
   `gatewayRefundId` / retry with the **same** key.
2. Order `cancelled` ∧ captured-or-`refund_pending` ∧ no `processed` full Refund → open/resume one.
3. **Invariant guard (I4):** order fulfillable ∧ processed full Refund → **force `→cancelled` + alert**.
4. Settled order later gaining a `processed` refund → emit settlement clawback (§10).
Bounded retries with backoff (`attempts`, `nextRetryAt`); exhausted → **dead-letter + admin alert** (no
owed refund silently lost). Idempotent — re-running converges.

## 8. Capture-after-cancel

A `payment.captured` (webhook or verify/settle) landing on a `cancelled` order = money taken for an
order that will never ship. The current `refundCancelledCapture` (payments.service.ts:80–115) becomes
**one entry point into the shared executor**: claim the `pending` payment row
(`pending→refunded`, CAS — at-most-once), open `Refund(kind=full, source=capture_after_cancel,
idempotencyKey)`, run T2/T3. Order is already terminal `cancelled` (no transition). Guard: refund
**only** if `cancelled`; if the capture lands on a fulfillable order, it's a normal payment.

## 9. Manual (admin) refund

`initiateRefund` becomes a thin caller of the same saga: validate (`assertTransition(→cancelled)`,
captured payment exists), then **T1 → executor → reconciler**. This **deletes the "cancel manually"
hard-fail** (F1): cancel is atomic with the claim, so there is no post-refund lost-race window. If T1's
CAS loses (order already cancelled by another path), attach idempotently to the existing Refund.
Admin discretionary partial refunds use `kind=manual` (no cancel). `adminId` + `reason` recorded on the
Refund + ledger + status history.

## 10. Settlement implications

Settlement reads **refund-adjusted goods value**, not raw `OrderItem` amounts (today
settlement.job.ts:85–87 sums `unitPrice×qty` for **all** lines — over-pays refunded lines):
- Settled goods per order = `Σ lines(unitPrice×qty) − Σ processed line refunds`; exclude
  `fulfillmentStatus='unavailable_refunded'` lines. Cancelled orders never settle (not `delivered`).
- **Hold:** an order with an open (non-`processed`) Refund is **not settled** until the Refund is
  terminal — prevents paying out goods that are mid-refund.
- **Clawback:** a refund that turns `processed` *after* its order settled (late finalize / settled
  capture-after-cancel) → reconciler emits a **negative adjustment** against the seller's next period,
  keyed to the Refund record. Closes the over-pay gap by construction.
