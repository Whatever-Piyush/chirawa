# Release Audit — write-site inventory

**Scope:** inventory only. No code changed, no fixes proposed, no redesign.
**Searched:** `apps/api/src` (excluding `__tests__`).

**Legend**
- **Reviewed** — covered by this session's work (runtime-verification pass + F-1 root-cause/fix)
  and/or an existing in-repo audit/code-review marker. Cited per row.
- **Runtime tested** — exercised at runtime during this session's verification pass
  (live API on `:3000` / `chirawa_development`, settlement worker code via `tsx`).
  "No" means not hit at runtime (most have unit coverage — noted).

---

## 1. Endpoints that create `Payment` rows

| Endpoint (route) | Service write | Purpose | Reviewed | Runtime tested |
|---|---|---|---|---|
| `POST /api/v1/orders` (`orders.routes.ts:22`) → non-COD branch (`orders.routes.ts:34`) | `createCartPaymentOrder` create at `payments.service.ts:78` | On non-COD checkout, one Razorpay order for the cart grand total + **one Payment row per child order** sharing the `razorpayOrderId` | Yes — F-1 root-cause; `BILLING_FORENSIC_AUDIT.md:115` | **Yes** — UPI place in flows 3/4/5 + settlement prepaid order |
| `POST /api/v1/payments/orders/:orderId` (`payments.routes.ts:22-23`) | `createPaymentOrder` create at `payments.service.ts:45` (dev-mock) / `:52` (configured) | Standalone single-order Razorpay-order create. **Legacy/dormant** (no client/api-client caller; only `scripts/harness/10_fixtures.sh:48`). Dedup guard added this session at `payments.service.ts:29-41` (F-1) | Yes — F-1 root-cause + fix this session | **Yes** — F-1 reproduction pre- and post-fix (3× calls returned the same row) |

> Only these two paths create `Payment` rows. `processWebhook` and `reconcilePendingPayments`
> only `updateMany` existing rows (no create).

---

## 2. Code that writes `Order.status`

There are exactly **two** physical writers of `Order.status`:

| Writer | file:line | Purpose | Reviewed | Runtime tested |
|---|---|---|---|---|
| State-machine CAS writer | `order-status.ts:73` (`transitionOrderStatus`, fn at `:58`) | The single enforcement point: `assertTransition(from,to)` + atomic compare-and-set (`WHERE id=… AND status=from`) + history row. Every transition routes through here | Yes — runtime pass traced all transitions; marker "Defect #1" (`orders.service.ts:496`); `BUG_001_STATE_MACHINE_CHECK.md` | **Yes** — exercised by every flow below |
| Initial create | `orders.service.ts:276` (`placeOrder` `tx.order.create({status: initStatus})`) | Sets the starting status at creation: `confirmed` (COD) / `pending_payment` (prepaid) | Yes — runtime pass | **Yes** — all flows |

**Endpoints that drive a status transition (all via `transitionOrderStatus`):**

| Endpoint (route) | Transition call | Status change | Reviewed | Runtime tested |
|---|---|---|---|---|
| `POST /orders/:id/accept` (`orders.routes.ts:82`) | `updateOrderStatus` (`orders.service.ts:535`→`:500`) | paid/confirmed → confirmed | Yes | **Yes** — flows 3/4/5, settlement prepaid |
| `POST /orders/:id/reject` (`orders.routes.ts:91`) | `updateOrderStatus` (`orders.service.ts:580`→`:500`) | → cancelled (+ refund) | Yes — marker "P0-2" | **Yes** — flow 4 |
| `POST /orders/:id/preparing` (`orders.routes.ts:101`) | `updateOrderStatus` (`orders.service.ts:597`) | confirmed → preparing | Yes | **Yes** — flow 1, settlement prepaid |
| `POST /orders/:id/ready` (`orders.routes.ts:110`) | `updateOrderStatus` (`orders.service.ts:608`) | preparing → ready_for_pickup | Yes | **Yes** — flow 1, settlement prepaid |
| `DELETE /orders/:id` (`orders.routes.ts:74`) | `cancelOrder` `updateOrderStatus` (`orders.service.ts:631`) | → cancelled (+ refund) | Yes — marker "P0-2" | **Yes** — flow 3 |
| `POST /orders/:id/cod-collected` (`orders.routes.ts:119`) | `codCollected` `transitionOrderStatus` (`orders.service.ts:680`) | out_for_delivery → delivered | Yes — marker "BUG-001 D1/D2/D3" | **Yes** — flow 1 |
| `POST /orders/:id/delivered` (`orders.routes.ts:131`) | `markDelivered` `transitionOrderStatus` (`orders.service.ts:720`) | out_for_delivery → delivered (prepaid) | Yes | **Yes** — settlement prepaid order |
| `POST /delivery/orders/:orderId/pickup` (`delivery.routes.ts:56`) | `riderAdvance` (`dispatch.service.ts:210`) | ready_for_pickup → picked_up | Yes | **Yes** — flow 1, settlement prepaid |
| `POST /delivery/orders/:orderId/start-delivery` (`delivery.routes.ts:66`) | `riderAdvance` (`dispatch.service.ts:210`) | picked_up → out_for_delivery | Yes | **Yes** — flow 1, settlement prepaid |
| `POST /delivery/orders/:orderId/items/:itemId/unavailable` (`delivery.routes.ts:87`) | `riderReportItemUnavailable` `updateOrderStatus` (`orders.service.ts:791`) | → cancelled (single-line) (+ refund) | Yes — marker "P0-2"; runtime pass | **Yes** — flow 5 |
| `POST /payments/verify/:orderId` (`payments.routes.ts:40`) | `markOrderPaid` `transitionOrderStatus` (`payments.service.ts:403`) | pending_payment → paid | Yes — F-1; runtime pass | **Yes** — flows 3/4/5, settlement prepaid |
| `POST /payments/webhook/razorpay` (`payments.routes.ts:115`) | `processWebhook`→`markOrderPaid` (`payments.service.ts:403`) | pending_payment → paid (captured event) | Yes — runtime pass (read) | **No** — webhook not fired at runtime; unit-tested (`webhook.idempotency.test.ts`, `capture-after-cancel.test.ts`) |
| `POST /payments/refund/:orderId` (`payments.routes.ts:68`, admin) | `initiateRefund` `transitionOrderStatus` (`payments.service.ts:227`) | → cancelled (+ refund) | Yes — marker "P0-2"; runtime pass (read) | **No** — admin refund endpoint not exercised at runtime; unit-tested (`refund.service.test.ts`) |
| (worker) seller-timeout (`seller-timeout.plugin.ts:34`) | `autoAcceptOrder` `updateOrderStatus` (`orders.service.ts:559`) | paid → confirmed (auto) | Yes — runtime pass (read) | **No** — seller-timeout not triggered at runtime |

> **Non-status `Order` writes (excluded — confirmed they do not touch `status`):** riderId/batchId
> (`dispatch.service.ts:119`, `batching.service.ts:66,78,128`, `orders.service.ts:122`),
> ETA (`eta.service.ts:107`), `sellerAcceptedAt` (`orders.service.ts:531,552`),
> totals decrement (`orders.service.ts:813`), rating (`:842`), address (`:869`), receiver (`:900`).
> Other `status:'delivered'|'pending_payment'` matches in `settlement.job.ts:77,310`,
> `referral.job.ts:25`, `sellers.service.ts:88`, `reconciliation.job.ts:28` are **read filters**, not writes.

---

## 3. Code paths that write rider `codBalancePaise`

| Write site | Trigger (endpoint) | Purpose | Reviewed | Runtime tested |
|---|---|---|---|---|
| `orders.service.ts:687` (`riderProfile.update … codBalancePaise: { increment: amountDue }`) | `POST /orders/:id/cod-collected` (`orders.routes.ts:119`) → `codCollected` | Credit the rider's COD balance by the order total when a COD order is delivered; runs in the same `$transaction` as the `→ delivered` CAS | Yes — runtime pass; marker "BUG-001"; memory `seeded-sellers` context | **Yes** — flow 1 (observed `0 → 4000`) |

> **Inventory observations (no fix implied):**
> - This is the **only** write to `codBalancePaise` in `apps/api/src`. `users.service.ts:29` is a
>   `select` (read) for the rider profile response, not a write.
> - The single write is **increment-only**; no decrement / reset / cash-deposit-reconciliation
>   path exists in `apps/api/src`.

---

## 4. Code paths that write `Settlement` amounts

All settlement writes live in the **worker** (`apps/api/src/worker/jobs/settlement.job.ts`),
driven by the settlement queue (no HTTP endpoint creates settlements). The amount source of
truth is `settlementGoodsPaise` (`settlement.job.ts:41`).

| Write site | Trigger | Purpose | Reviewed | Runtime tested |
|---|---|---|---|---|
| `settlement.job.ts:103` (`settlement.create`) | `runDailySettlement` (daily cron) | Create settlement with `totalProductPaise` / `netPayablePaise` / `platformFeePaise=0` for a shop's prior-day delivered orders | Yes — runtime pass; marker "P0-1" | **No** — `runDailySettlement` ran at runtime but found 0 orders delivered yesterday (settled 0, skipped 6), so the create branch wasn't hit |
| `settlement.job.ts:329` (`settlement.upsert`) | `processSingleSellerSettle` (per-seller job) | Same amount fields, idempotent upsert per `(sellerId, periodDate)` | Yes — runtime pass; marker "P0-1" | **Yes** — created the `totalProductPaise=3500` record; idempotent on re-run |
| `settlement.job.ts:41` (`settlementGoodsPaise`) | both create paths | Amount calc: Σ(`unitPrice·qty − refundedPaise`) over delivered items (goods only, excludes delivery fee) | Yes — runtime pass; marker "P0-1" | **Yes** — recomputed = 3500, matched the record |

**Settlement status/payout-metadata updates (NOT amount fields — listed for completeness):**

| Write site | Trigger | Writes | Reviewed | Runtime tested |
|---|---|---|---|---|
| `settlement.job.ts:149` | `initiatePayout` (no UPI on seller) | status=pending, needsAttention, failureReason | Yes | **Yes** — runtime: settlement → pending + needsAttention "No UPI ID on seller profile" |
| `settlement.job.ts:160` | `initiatePayout` (RazorpayX unconfigured) | failureReason | Yes | **No** — the no-UPI branch short-circuits first |
| `settlement.job.ts:195` + ledger `:203-205` | `initiatePayout` (payout processed) | status=paid/paidAt/payoutId/upiRef + `seller_settlement` ledger `amountPaise` | Yes | **No** — no payout in dev (unit-tested `settlement.job.test.ts`) |
| `settlement.job.ts:218` | `initiatePayout` (payout in-flight) | status=processing, payoutId | Yes | **No** — unit-tested |
| `settlement.job.ts:225` / `:238` | `initiatePayout` (payout rejected / API error) | status=failed, needsAttention, failureReason | Yes | **No** — unit-tested |
| `settlement.job.ts:273` + ledger `:277-279` | `runPayoutReconciliation` (processed) | status=paid/paidAt/upiRef + `seller_settlement` ledger `amountPaise` | Yes | **No** — no in-flight payouts (unit-tested `payout.reconcile.test.ts`) |
| `settlement.job.ts:287` | `runPayoutReconciliation` (terminal failure) | status=failed, needsAttention, failureReason | Yes | **No** — unit-tested |

> **Inventory observation (no fix implied):** the worker process was **not running** during the
> runtime pass (see runtime verification), so settlement amounts were generated by invoking the
> job code directly via `tsx`; the daily-cron create branch (`:103`) and all payout-execution
> branches were not driven by a live worker.
