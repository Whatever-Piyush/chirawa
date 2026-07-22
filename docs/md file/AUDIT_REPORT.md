# Independent Audit Report — Chirawa

**Auditor stance:** Builder evidence treated as untrusted. Every PASS below is backed by
evidence the auditor reproduced independently (re-run tests, live API calls, direct DB/Redis
inspection, baseline diffing). Builder reports were used only to enumerate *claims*, never as proof.

**Date:** 2026-06-21
**Branch:** `chore/harness-phase-0a` (the fixes under audit are **uncommitted** working-tree changes)
**Environment:** live dev API on `:3000` (PID 37538, `tsx`), Postgres `chirawa_development`
(`chirawa_postgres:5432`), Redis (`chirawa_redis:6379`), worker `src/worker/index.ts` running.

**Note on source of claims:** No file named `BUILDER_REPORT.md` exists. The claimed fixes were
reconstructed from today's builder reports (`F1_ROOT_CAUSE.md`, `RUNTIME_VERIFICATION_REPORT.md`,
`RELEASE_AUDIT.md`) **plus** the uncommitted code diff and 6 new test files, which are the actual
artifacts. `F1_ROOT_CAUSE.md` says the fix was "NOT applied"; the working tree shows it **was**
applied (and expanded) — the audit verified the *code as it stands*, not the report's stale wording.

---

## Verification harness used (independent)

| Check | Method | Result |
|---|---|---|
| Unit/integration suite | `vitest run` (48 files, 331 tests) | **331 passed / 0 failed** |
| New test files actually ran | grep suite log | all 6 executed (dedup 6, capture-after-cancel 3, order-status 11, dispatch.transitions 5, cancel-refund 4, update-status 4) |
| Type/build baseline | `tsc --noEmit` on working tree **and** on stashed committed baseline | 27 errors (working) vs 29 (baseline) → **0 new, 2 removed** |
| Working-tree integrity | stash → typecheck → `stash pop`, compared `git status` + diff hash | restored byte-identical (`b41a63ab`) |
| Money/state invariants | 7 SQL invariants on live DB | 6 clean; 1 = pre-existing F-1 test pollution |
| F-1 fix | **live** API: standalone payment-create ×3 on a real order | pending rows stayed **1** (dedup works at runtime) |
| Role guards | route source inspection | intact on every money/dispatch endpoint |
| Worker/queues | `ps`, worker log, BullMQ depths via Redis | running, healthy, all queues drained, `failed=0` |
| Prod run model | root `Dockerfile` | ships via **`tsx`**, no `tsc` step → typecheck debt non-blocking |

---

## Claimed fixes — per-claim verdicts

### A. Payments

#### A1 — F-1: `createPaymentOrder` dedupes the pending payment row
- **Claim:** the standalone `POST /payments/orders/:id` no longer creates a 2nd `pending`
  Payment row, which previously caused a unique-violation **500** at capture
  (`markOrderPaid` writes one `razorpayPaymentId` across all pending rows; column is `@unique`).
- **Verification steps:** (1) read `payments.service.ts:22-41` — reuses an existing
  `pending` row with a non-null `razorpayOrderId`. (2) `createPaymentOrder.dedup.test.ts` builds
  a stateful Prisma double that **enforces the `razorpay_payment_id` UNIQUE constraint like
  Postgres**; its regression-guard test genuinely reproduces the 500, and the dedup tests prove
  one `create`. (3) **Live runtime:** logged in as the order owner, called the endpoint **3×**
  on real order `5548c7e7…`.
- **Evidence:** endpoint returned the **existing** `razorpayOrderId` (`order_SyMl7QFgxHGCR2`,
  HTTP 200) each time; DB pending-row count held at **1** before and after all 3 calls. Unit
  suite green. DB also still holds 5 *historical* 2-row orders from the builder's own repro
  (proves the bug was real pre-fix).
- **Verdict:** **PASS**

#### A2 — capture-after-cancel refund (`refundCancelledCapture`)
- **Claim:** a payment captured (webhook/verify) on an **already-cancelled** order is now
  refunded instead of silently kept.
- **Verification steps:** read `payments.service.ts:97-138` (settle loop branches to
  `refundCancelledCapture` when `status==='cancelled'`); read the helper (claims pending→refunded
  first, reverts on external failure, ledger last). Re-ran `capture-after-cancel.test.ts`.
- **Evidence:** 3 tests pass — claim-before-refund ordering asserted via `invocationCallOrder`;
  idempotent on claim-loss (count 0 → no double refund); revert on gateway failure.
  Invariant **INV2** (captured rows with `refunded_paise>0`) = **0**.
- **Verdict:** **PASS**

#### A3 — webhook `payment.failed` narrowed to pending rows
- **Claim:** a late/duplicate `payment.failed` can no longer flip a `captured` payment to `failed`.
- **Verification steps:** read `payments.service.ts:185-189` (`where` now includes
  `status:'pending'`); `webhook.idempotency.test.ts` updated assertion re-run.
- **Evidence:** test passes asserting `where: { razorpayOrderId, status:'pending' }`. INV2/INV7 clean.
- **Verdict:** **PASS**

#### A4 — `markOrderPaid` routed through the state machine
- **Claim:** capture now flips `pending_payment→paid` via the CAS primitive + history, atomically
  with payment capture and ledger.
- **Verification steps:** read `payments.service.ts:397-420`; covered by `createPaymentOrder.dedup`
  verify-flow test (single row → `paid` + `captured` + `customer_payment` ledger).
- **Evidence:** test green; INV7 (dup `razorpay_payment_id`) = 0.
- **Verdict:** **PASS**

### B. Refunds

#### B1 — `initiateRefund` (admin) P0-2: claim + cancel **before** external refund
- **Claim:** admin refund claims the payment **and** cancels the order atomically *before* calling
  Razorpay; illegal (e.g. delivered) orders rejected up-front; failure reverts the claim but leaves
  the order cancelled (safe direction).
- **Verification steps:** read `payments.service.ts:209-265`; re-ran `refund.service.test.ts`
  `initiateRefund` block (6 tests).
- **Evidence:** tests assert — V4 delivered rejected before any claim/refund; claim-loss (count 0)
  → no refund, order not cancelled; **both** claim and cancel precede `createRefund`
  (`invocationCallOrder`); gateway failure reverts claim, order **stays** cancelled; concurrent
  status advance during the txn aborts with no refund. Live invariant **INV4** (cancelled order
  with a still-captured payment) = **0**.
- **Verdict:** **PASS**

#### B2 — `refundCapturedOrderPayment` (defect #2): atomic claim-before-refund
- **Claim:** concurrent cancellation refunds run the external refund **at most once**; failure
  reverts to `captured` (retryable); ledger only after success.
- **Verification steps:** read `payments.service.ts:305-345`; re-ran `refund.service.test.ts`
  first block (6 tests).
- **Evidence:** claim CAS `WHERE status='captured'`; loser (count 0) returns null, no external
  call; failure does claim→revert (2 updateMany calls) and no ledger; COD/no-captured short-circuit.
  INV2/INV3 (`refunded` with `paise=0`) both 0.
- **Verdict:** **PASS**

#### B3 — P0-2 cancel-first / refund-last in `cancelOrder`, `sellerRejectOrder`, item-unavailable
- **Claim:** order is flipped to `cancelled` (fulfillability revoked) **before** the external
  refund, so a successful refund can never leave a fulfillable order.
- **Verification steps:** read all three sites in `orders.service.ts`; re-ran
  `orders.cancel-refund-order.test.ts`, `orders.unavailable.test.ts`.
- **Evidence:** tests green; ordering matches code. **INV4 = 0** across the whole live DB
  (no cancelled order retains an un-refunded captured payment) — strong end-state corroboration.
- **Verdict:** **PASS**
- **Residual (low):** the `order:status:changed …refundedPaise` notification is emitted by the
  cancel step *before* the external refund settles; on a rare gateway failure the customer is
  notified of a refund that needs a retry. Safe direction (platform never overpays); cosmetic.

### C. Orders / state machine

#### C1 — `order-status.ts`: single state machine + `transitionOrderStatus` CAS
- **Claim:** one enforcement point — `assertTransition` (legal-jump guard) + atomic compare-and-set
  (`updateMany WHERE status=from`) + history; `delivered`/`cancelled` terminal.
- **Verification steps:** read the module; re-ran `order-status.test.ts` (11 tests).
- **Evidence:** covers full legal forward path, V1/V2/V4 terminal-backward rejections **with
  no-write assertions**, lost-race (count 0 → false, no history), cancelReason/cancelledAt stamping,
  extraData merge, same-status no-op. All green.
- **Verdict:** **PASS**

#### C2 — `updateOrderStatus` (Defect #1) routed through CAS, throws on concurrent change
- **Claim:** seller/admin/rider status writes can no longer silently clobber a concurrent transition.
- **Verification steps:** read `orders.service.ts:491-509`; re-ran `orders.update-status.test.ts` (4).
- **Evidence:** green; CAS returns false → `BusinessRuleError('Order status changed concurrently')`.
- **Verdict:** **PASS**

#### C3 — BUG-001 `cod-collected`: server-derived amount, idempotent, CAS-credited
- **Claim:** recorded cash = **server** `order.totalAmount` (client `amountPaise` advisory only);
  retried collection does not re-credit; only the flipping call credits the rider.
- **Verification steps:** read `orders.service.ts:659-700` + `orders.schema.ts` (amount now
  optional) + `orders.routes.ts` (zod-validated); re-ran `orders.cod-collected.test.ts`.
- **Evidence:** tests green; **INV6 = 0** — every delivered COD order in the live DB has
  `cod_collected_paise == total_amount` (no client value ever recorded). **Security-positive:**
  a malicious rider can no longer under/over-report collected cash.
- **Verdict:** **PASS**

#### C4 — `markDelivered` (non-COD) idempotent + CAS (V5)
- **Claim:** retried delivery succeeds without re-stamping; illegal source state (e.g.
  `picked_up→delivered`) rejected.
- **Evidence:** `orders.delivered.test.ts` incl. "V5 rejects forward-skip" passes.
- **Verdict:** **PASS**

#### C5 — item-unavailable atomic line claim + H-1 cart idempotency
- **Claim:** line flips `fulfilled→unavailable_refunded` exactly once (double-tap safe);
  `POST /orders` always dedupes via `auto:${cartId}`.
- **Evidence:** `orders.unavailable.test.ts` green; route reads `?? auto:${cartId}` and always
  calls `runIdempotent`.
- **Verdict:** **PASS**
- **Residual (low, latent):** single-line path claims the line *before* `updateOrderStatus`. If
  that CAS throws on a concurrent transition, the line is left flagged `unavailable_refunded`
  while the order is **not** cancelled and **no** refund issues — and settlement (P0-1) would then
  underpay the seller for that line. Narrow race (requires a simultaneous status move); no
  double-refund or customer-facing money loss. Recommend reordering the line-claim after the
  status flip, or wrapping both in one transaction.

### D. Dispatch

#### D1 — `riderAdvance` routed through CAS (V1/V2)
- **Claim:** rider pickup/start-delivery transitions use the CAS primitive; reverse moves rejected;
  ETA + event only fire when the row actually moved.
- **Verification steps:** read `dispatch.service.ts:204-226`; re-ran `dispatch.transitions.test.ts`
  (5) and `dispatch.eta-ordering.test.ts`.
- **Evidence:** green; `if (moved) { computeAndPersistEta; emit }` guards the side effects.
- **Verdict:** **PASS**

### E. Settlement

#### E1 — P0-1: `settlementGoodsPaise` subtracts per-line refunds
- **Claim:** a refunded item-unavailable line (`refundedPaise = unitPrice·qty`) contributes **0**,
  so a seller is no longer paid for refunded goods. Shared by both settle paths.
- **Verification steps:** read `settlement.job.ts:35-46` + both call sites; **checked the second
  path's query selects `refundedPaise`** — `processSingleSellerSettle` uses `include:{items:true}`
  (full include), so `item.refundedPaise` is present (no `NaN` from an undefined field). Re-ran
  `settlement.job.test.ts`.
- **Evidence:** tests green incl. "excludes refunded lines (P0-1)"; live settlement row
  `2565f644` = `totalProductPaise 3500` (goods 1500+2000, fees excluded); **INV5** (null/negative
  settlement amounts) = **0**.
- **Verdict:** **PASS**

### F. Cross-cutting — security / role guards
- **Claim (implicit):** money/dispatch endpoints remain correctly role-gated.
- **Evidence:** `POST /payments/refund/:id` → `requireRole('admin')`; `/orders/:id/cod-collected`
  & `/orders/:id/delivered` → `requireRole('rider')`; seller transitions → `requireRole('seller')`;
  customer cancel/rating → service-level ownership check (`customerId !== userId → Forbidden`);
  delivery item-unavailable → rider guard **plus** active-assignment ownership check;
  `/delivery/orders/:id/assign` → `requireRole('admin')`. Auth was not modified; live login
  (dev OTP bypass) succeeded.
- **Verdict:** **PASS**

---

## Items the audit could NOT fully verify (UNVERIFIED — not failures)

These are **dev-environment limitations**, not defects. They are logic-verified by unit tests but
never exercised against a real gateway at runtime:

| Path | Why unverified | Mitigation |
|---|---|---|
| Real Razorpay `createRefund` (refund money actually leaving) | dev-mock (`RAZORPAY_KEY_*` placeholders) → no external call | unit-tested; the external call itself is **pre-existing/unchanged** code |
| RazorpayX payout execution + reconciliation | RazorpayX unconfigured; seed sellers have no UPI | `settlement.job.test.ts` covers the payout state machine |
| Webhook capture at runtime | no webhook fired during the session | `webhook.idempotency` + `capture-after-cancel` unit tests |

---

## Critical Issues Remaining

**None that fail an audited flow.** Every payment, settlement, refund, dispatch, and role-guard
claim independently reproduced as **PASS**. Remaining items are non-blocking:

1. **F-1 test pollution (data, not code):** 5 orders in `chirawa_development` carry 2 `pending`
   payment rows (4 `pending_payment` + 1 `cancelled`), created 04:52–05:14 today during the
   builder's own F-1 reproduction. They would 500 on `verify` and would error (caught, non-fatal)
   in the reconcile worker. The fix prevents *new* ones; these are repro residue. **Confirm the
   production DB has none** (a fresh prod DB will not).
2. **Latent race (low):** single-line item-unavailable line-claim ordering (see C5).
3. **Notification-before-settlement (cosmetic):** refund amount announced before the external
   refund completes (see B3).

## Security Risks Remaining

- **No new risks introduced.** One **improvement**: `cod-collected` no longer trusts a
  client-supplied amount (C3) — closes a rider cash-manipulation vector.
- Role guards on all money/dispatch endpoints intact (Section F).
- **Defense-in-depth gap (pre-existing, noted by builder):** there is no DB unique constraint
  enforcing "one pending payment per order." The F-1 fix removes the only known runtime path to a
  duplicate, but a partial-unique index would harden capture against any future path. Recommended,
  not required.

## Production Blockers

- **No hard code blocker.** The `tsc`/`pnpm build` typecheck fails with **27 pre-existing** errors
  (29 on the committed baseline) — but the root `Dockerfile` ships production via
  `tsx apps/api/src/index.ts` with **no compile step**, so this never reaches runtime. The fixes
  under audit add **zero** new type errors (they removed two). Pre-existing tech debt, non-blocking;
  flagged because it means there is **no type-safety net** in CI for route handlers.
- **Process:** the fixes are **uncommitted**. They must be committed (and the suite run in CI)
  before any deploy.

## Deployment Recommendation

**GO — conditional.** No payment, settlement, refund, dispatch, auth, or role-guard flow **failed**
audit; all reproduced as PASS with independent evidence (331 green tests, clean money invariants
INV2–INV7, a live runtime F-1 reproduction, intact role guards, a healthy worker with drained
queues). The strict "any of these flows fails → DO NOT DEPLOY" trigger is therefore **not met**.

Deploy only after these conditions:
1. **Commit** the working-tree changes and run the full suite in CI (currently green locally).
2. **Staging smoke test with real Razorpay test keys** for the two UNVERIFIED money paths —
   admin refund (`createRefund`) and RazorpayX payout/reconciliation — since both were exercised
   only in dev-mock.
3. **Verify the production database** holds no order with >1 `pending` payment row (the F-1 fix
   prevents new ones; confirm none pre-exist).
4. *(Recommended, non-blocking)* reorder the single-line item-unavailable line-claim (C5) and add
   the partial-unique payment index as defense-in-depth.

> If conditions (1)–(3) cannot be met before launch — in particular if the real-gateway refund/
> payout paths cannot be validated in staging — downgrade to **HOLD** until they are, because those
> paths remain UNVERIFIED against a live gateway.
