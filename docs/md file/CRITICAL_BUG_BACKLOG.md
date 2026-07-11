# Critical Bug Backlog

**Source:** synthesized from `FEATURE_VERIFICATION_MATRIX.md`, `PHASED_VERIFICATION_PLAN.md`,
`HARNESS_GAP_ANALYSIS.md`, `COD_MIGRATION_PLAN.md`, `COD_OPERATIONS_DESIGN.md` — then
**each item re-confirmed against live source** (file:line evidence below).
**Date:** 2026-06-20 · **Branch:** `chore/harness-phase-0a`

## Inclusion rules applied

Every entry is a **confirmed defect** — code that demonstrably does the wrong thing or omits a
control that the codebase itself declares. This backlog deliberately **excludes**:

- **"Code Verified Only" / "Not Verified" features** — that is *absence of runtime verification*,
  not evidence of a defect (52 of 52 features in the matrix are un-runtime-tested; that is a test
  gap, not a bug list).
- **Harness/test-coverage findings** (`HARNESS_GAP_ANALYSIS.md` F1–F25) — those are gaps in the
  *verification harness*, not application bugs. The one exception (F19) is a genuine application
  defect and appears here as BUG-001.
- **Intentional-by-design behavior** — see "Explicitly excluded" at the end (referral hidden by
  flag, Razorpay prod hard-fail, env-gated dev OTP bypass).
- **No fixes are proposed.** "Fix Complexity" is an effort/risk estimate only.

**Severity ↔ group:** P0 = Critical · P1 = High · P2 = Medium.

| ID | Title | Group |
|----|-------|-------|
| BUG-001 | COD collection amount is client-supplied and unvalidated | **P0** |
| BUG-002 | Daily settlement over-pays sellers for unavailable/refunded lines | **P0** |
| BUG-003 | Rider COD cash is never reconciled (balance increment-only, no ledger) | **P1** |
| BUG-004 | COD float cap is configured but never enforced | **P1** |
| BUG-005 | Seller "settlement paid" notification is never sent | **P2** |
| BUG-006 | AuditLog has no writers — no audit trail exists | **P2** |
| BUG-007 | Rider Earnings screen shows hard-coded salary and zero earnings | **P2** |

---

# P0 — Critical

## BUG-001 — COD collection amount is client-supplied and unvalidated

- **Severity:** Critical (P0)
- **Business Impact:** Direct revenue leakage / theft vector on **every COD order**. The cash a
  rider records is whatever their device sends; the platform has no server-side check that it
  equals what was owed. A rider can mark an order delivered while recording ₹0 (or any amount) and
  keep the difference. Because COD is the **default** checkout path (`CheckoutScreen.tsx:154`), this
  is the primary money-in flow.
- **User Impact:** Seller is later settled for goods value the platform may never have actually
  collected; the customer's order completes normally so they see nothing wrong. The financial
  records (`Order.codCollectedPaise`, rider `codBalancePaise`) reflect the *under-reported* figure,
  so the discrepancy is invisible downstream.
- **Exact Files:**
  - `apps/api/src/modules/orders/orders.service.ts:666-691` (`codCollected` — no amount check)
  - `apps/api/src/modules/orders/orders.routes.ts:118-126` (`amountPaise` taken straight from request body)
  - `apps/rider-app/src/services/api.service.ts:112-113` (`collectCod` sends device-side amount)
- **Reproduction Steps:**
  1. Place a COD order; note its total, e.g. `SELECT total_amount FROM orders WHERE id=:oid;` → `50000`.
  2. As the assigned rider, call `POST /api/v1/orders/:oid/cod-collected` with body `{"amountPaise": 1}`.
  3. Response is `200` "Cash collection confirm ho gaya"; no error.
  4. Verify: `SELECT cod_collected_paise FROM orders WHERE id=:oid;` → `1`; rider `cod_balance_paise` incremented by `1`. The ₹499.99 gap is unrecorded.
- **Evidence:** The transaction in `codCollected` (`orders.service.ts:672-684`) updates the order,
  writes status history, and increments `codBalancePaise` **using `amountPaise` verbatim**, with no
  comparison to `order.totalAmount`. Independently flagged in `HARNESS_GAP_ANALYSIS.md` F19
  ("records whatever `amountPaise` the client sends … no server check that it equals the order
  total") and `COD_OPERATIONS_DESIGN.md` F1.
- **Root Cause:** The collected amount is treated as caller-supplied input rather than being derived
  from the authoritative `order.totalAmount` on the server; no validation/guard exists.
- **Fix Complexity:** **S** — single service function; main decision is policy for genuine short
  collections (reject vs. structured short-record), per `COD_OPERATIONS_DESIGN.md` open question C1.

---

## BUG-002 — Daily settlement over-pays sellers for items reported unavailable/refunded

- **Severity:** Critical (P0)
- **Business Impact:** Platform pays sellers for goods that were **not delivered and were refunded**.
  On a multi-line order where the rider reports a line unavailable, the order total and (for prepaid)
  the customer's payment are reduced — but the seller's settlement still credits the full original
  goods value of every line. The platform absorbs the difference on every such order (a refund to the
  customer *and* a full payout to the seller for the same unsold item).
- **User Impact:** Seller is over-credited (will not self-report); customer is correctly refunded.
  The seller's in-app "unsettled" estimate (which uses the decremented subtotal) will **not match**
  what is actually paid out, creating reconciliation disputes.
- **Exact Files:**
  - `apps/api/src/worker/jobs/settlement.job.ts:85-87` (`runDailySettlement` sums `unitPrice × quantity` for **all** items)
  - `apps/api/src/worker/jobs/settlement.job.ts:313-315` (`processSingleSellerSettle` — same flaw)
  - `apps/api/src/modules/orders/orders.service.ts:788-796` (line marked `unavailable_refunded`; order totals decremented; **OrderItem keeps original `unitPrice`/`quantity`/`subtotal`**)
- **Reproduction Steps:**
  1. Place a delivered-bound order with two lines: A (₹100) and B (₹100); `total_amount` = ₹200 (+fee).
  2. Rider reports line B unavailable: `POST /api/v1/delivery/orders/:oid/items/:itemB/unavailable`.
     → `order_items.B.fulfillment_status='unavailable_refunded'`, `refunded_paise=10000`;
     `orders.total_amount` and `cart_subtotal_at_pricing` decremented by ₹100; customer refunded (prepaid) or cash-due reduced (COD).
  3. Complete delivery so the order reaches `delivered`.
  4. Run settlement for the period (`single-seller-settle` for that shop, or the daily job).
  5. Verify: `SELECT total_product_paise FROM settlements WHERE shop_id=:shop AND period_date=:d;`
     → includes line B's ₹100 (₹200 total), though only line A (₹100) was delivered.
- **Evidence:** `settlement.job.ts:85-87` reduces over `order.items` with
  `s + (item.unitPrice * item.quantity)` and never inspects `fulfillmentStatus` or subtracts
  `refundedPaise`. `orders.service.ts:790` sets the line to `unavailable_refunded` but leaves its
  monetary fields intact. Documented in `COD_OPERATIONS_DESIGN.md` G1.
- **Root Cause:** Settlement computes goods value from raw `OrderItem` line amounts, which are *not*
  zeroed when a line is refunded; the per-line `fulfillmentStatus`/`refundedPaise` (added by the
  Phase-5 safety net) is ignored by the settlement sum.
- **Fix Complexity:** **S** — computation change in two job functions (exclude/`refundedPaise`-adjust
  refunded lines); the seller "unsettled" estimate in `sellers.service.ts:86-102` should align.

---

# P1 — High

## BUG-003 — Rider COD cash is never reconciled (balance increment-only, no ledger record)

- **Severity:** High (P1)
- **Business Impact:** The platform has **no mechanism to recover or account for COD cash** held by
  riders. `RiderProfile.codBalancePaise` only ever increases; there is no deposit/hand-over flow,
  nothing decrements it, and COD collection writes **no `Transaction` ledger row** — so the only
  record of cash received is a single mutable counter with no immutable audit trail. Under COD-first
  operation this is the central money-tracking gap (it is the subject of `COD_OPERATIONS_DESIGN.md`
  §B2).
- **User Impact:** Riders accumulate an ever-growing notional balance they can never clear in-app;
  ops has no system record of who owes how much cash or what was handed over (dispute-prone). Sellers'
  settlements (B3) are not provably funded by collected cash.
- **Exact Files:**
  - `apps/api/src/modules/orders/orders.service.ts:680-684` (only `increment` of `codBalancePaise`; no `Transaction.create` in the txn)
  - `apps/api/prisma/schema.prisma:73-74` (`rider_cod_collection`, `rider_cod_settlement` enum values — declared)
  - `apps/api/prisma/schema.prisma:189` (`codBalancePaise` field)
- **Reproduction Steps:**
  1. Complete several COD deliveries (BUG-001 repro) as one rider.
  2. `SELECT cod_balance_paise FROM rider_profiles WHERE id=:rid;` → grows with each collection.
  3. `SELECT count(*) FROM transactions WHERE type IN ('rider_cod_collection','rider_cod_settlement');` → **0** (never written).
  4. Search the API for any endpoint/job that decrements `codBalancePaise` or records a deposit → none exists.
- **Evidence:** `codCollected`'s `$transaction` array (`orders.service.ts:672-684`) contains only
  `order.update`, `orderStatusHistory.create`, `riderProfile.update{ increment }` — **no ledger
  write**. Repo-wide search confirms `rider_cod_collection`/`rider_cod_settlement` are "NEVER WRITTEN
  IN CODE (enum-only)" and `codBalancePaise` has no decrement site. Documented in
  `COD_OPERATIONS_DESIGN.md` §B2.1–B2.4 and `COD_MIGRATION_PLAN.md` blocker B2.
- **Root Cause:** Only the collection half of rider cash handling was built; the deposit/settlement
  half and the ledger entries (despite reserved enum types) were never implemented.
- **Fix Complexity:** **L** — new model + endpoints + ledger writes + reconciliation read surface
  (full design in `COD_OPERATIONS_DESIGN.md` §B2).

---

## BUG-004 — COD float cap is configured but never enforced

- **Severity:** High (P1)
- **Business Impact:** The documented cash-risk control limiting how much COD cash a rider may hold
  (`COD_FLOAT_CAP_PAISE`, ₹2000) does nothing. A rider can carry unlimited platform cash, increasing
  loss exposure on theft/absconding/loss — the exact risk the cap was meant to bound.
- **User Impact:** No functional user impact today (silent); the control simply has no effect. There
  is no block or warning when a rider exceeds the cap.
- **Exact Files:**
  - `apps/api/src/config/env.schema.ts:92` (`COD_FLOAT_CAP_PAISE` defined, default 200000)
  - `apps/api/prisma/seed.ts:94` (`cod_float_cap_paise` seeded into AppConfig)
  - *(Negative evidence)* the value is read **nowhere** in dispatch/assignment/order code.
- **Reproduction Steps:**
  1. Keep default `COD_FLOAT_CAP_PAISE=200000`.
  2. Deliver COD orders to one rider until `cod_balance_paise > 200000`.
  3. Assign/deliver another COD order to that rider → proceeds with no block or warning.
  4. Confirm: repo search for `COD_FLOAT_CAP_PAISE` / `cod_float_cap` returns only the env schema,
     `.env.example`, the seed, and docs — **no read site** in business logic.
- **Evidence:** Repo-wide search shows `COD_FLOAT_CAP_PAISE` appears only in `env.schema.ts:92`,
  `.env.example:91`, `apps/api/.env.example:46`, `seed.ts:94`, and audit docs — never in
  dispatch/assignment/`codCollected`. Corroborated by `FEATURE_VERIFICATION_MATRIX.md` E13 ("Partial
  (config only — no enforcement found)") and `RUNTIME_VERIFICATION_HARNESS.md:511-518`.
- **Root Cause:** The cap configuration was added but the enforcement check (at COD assignment or
  collection time) was never implemented.
- **Fix Complexity:** **S–M** — depends on chosen enforcement point (assignment-time gate vs.
  collection-time warning) and hard-block vs. soft-warn policy (`COD_OPERATIONS_DESIGN.md` C2).
  Tightly coupled to BUG-003.

---

# P2 — Medium

## BUG-005 — Seller "settlement paid" notification is never sent

- **Severity:** Medium (P2)
- **Business Impact:** Sellers are told on every delivery that "Settlement kal milega" (settlement
  arrives tomorrow) but receive **no notification when a settlement is actually paid** — the
  `settlementPaid` push/SMS templates exist yet are invoked by nothing. Erodes seller trust in the
  payout process; increases "where's my money?" support load.
- **User Impact:** Seller gets a promise at delivery time and silence at payout time; must open the
  app and check the Settlement screen manually to learn anything.
- **Exact Files:**
  - `apps/api/src/modules/notifications/notification.templates.ts:65` (`settlementPaid` FCM template — defined, unused)
  - `apps/api/src/modules/notifications/sms.service.ts:55` (`settlementPaid` SMS template — defined, unused)
  - `apps/api/src/worker/jobs/settlement.job.ts` (payout success paths at `:179-200`, `:254-272` send **no** push/SMS/event)
  - `apps/api/src/modules/notifications/notifications.plugin.ts:122` (the "Settlement kal milega" promise on delivery)
- **Reproduction Steps:**
  1. In a configured environment, drive a settlement to `status='paid'` (payout processed, or reconcile sweep).
  2. Observe: no FCM/SMS to the seller; no `notifications` row for a settlement-paid event.
  3. Confirm: repo search shows `settlementPaid` is referenced only at its two definition sites — never called.
- **Evidence:** `settlementPaid` appears only at `notification.templates.ts:65` and
  `sms.service.ts:55` (definitions); `settlement.job.ts` contains no `emit`/`sendPush`/notification
  call on payout success. The job's own comment marks this open: "(TODO follow-up) Notify seller via
  FCM + SMS" (`settlement.job.ts:17`). Matrix lists E4 as "Implemented (seller-notify TODO)".
- **Root Cause:** The settlement worker runs in the worker process (no event-bus listeners) and was
  never wired to enqueue/send the seller notification on payout completion; the templates were
  written ahead of the wiring.
- **Fix Complexity:** **S** — invoke the existing templates on the `paid` transition (note the
  worker→notification delivery path constraint described in `reconciliation.job.ts:81-95`).

---

## BUG-006 — AuditLog has no writers; no audit trail is produced

- **Severity:** Medium (P2)
- **Business Impact:** The platform records **no audit trail** despite having a dedicated `AuditLog`
  table and an `AuditAction` enum enumerating money/security-sensitive actions
  (`refund_issued`, `payment_event`, `order_cancelled`, `admin_action`, `security_event`). For a
  payments platform this means no forensic record of refunds, admin actions, or security events —
  a gap for incident investigation and dispute resolution.
- **User Impact:** None directly user-facing; impacts ops/compliance ability to reconstruct who did
  what.
- **Exact Files:**
  - `apps/api/prisma/schema.prisma:93-102` (`AuditAction` enum)
  - `apps/api/prisma/schema.prisma:988-1004` (`AuditLog` model)
  - *(Negative evidence)* no `auditLog.create` / `prisma.auditLog` write anywhere in `apps/api/src`.
- **Reproduction Steps:**
  1. Exercise actions the enum names: issue a refund, cancel an order, perform an admin action, log in.
  2. `SELECT count(*) FROM audit_log;` → **0**.
  3. Confirm: repo search for `auditLog.create` / `prisma.auditLog` in `apps/api/src` returns nothing.
- **Evidence:** Repo search for audit writers returned "NO WRITERS FOUND". The model and enum exist
  but are never inserted into. Corroborated by `FEATURE_VERIFICATION_MATRIX.md` E10 ("Partial (table
  only — no writers found)").
- **Root Cause:** The audit schema was created but the write calls at the relevant action sites were
  never added.
- **Fix Complexity:** **M** — requires instrumenting each audited action site, not a single change.

---

## BUG-007 — Rider Earnings screen shows a hard-coded salary and zero earnings

- **Severity:** Medium (P2)
- **Business Impact:** The rider Earnings screen displays incorrect/static financial information — a
  hard-coded "₹7,500" salary for every rider regardless of their actual `monthlySalaryPaise`, and a
  per-day earnings figure that is computed as a literal zero. It does not surface the rider's COD
  cash balance. Misleading money display for the workforce.
- **User Impact:** Every rider sees the same "₹7,500" even if their configured salary differs; the
  "today's earnings" value is always 0; outstanding COD cash they are holding is not shown.
- **Exact Files:**
  - `apps/rider-app/src/screens/earnings/EarningsScreen.tsx:32` (hard-coded `₹7,500`)
  - `apps/rider-app/src/screens/earnings/EarningsScreen.tsx:17` (`todayEarnings = ... reduce((s, o) => s + 0, 0)`)
  - `apps/api/prisma/schema.prisma:185` (actual per-rider `monthlySalaryPaise`, ignored by the screen)
- **Reproduction Steps:**
  1. Log in as any rider (ideally one whose `monthly_salary_paise` ≠ 750000).
  2. Open the Earnings screen.
  3. Observe: "Monthly Salary" always reads "₹7,500"; the earnings sum is 0; no COD balance shown.
- **Evidence:** `EarningsScreen.tsx:32` renders the literal string `₹7,500`; line 17 computes
  `todayEarnings` as `reduce((s, o) => s + 0, 0)` with the comment "Salary-based, not per-order". The
  screen never reads `monthlySalaryPaise` or `codBalancePaise`. Matrix C7 status: "Partial (display
  from profile/COD; no settlement endpoint)".
- **Root Cause:** The screen was stubbed with placeholder values and never wired to the rider's
  actual profile figures (`monthlySalaryPaise`, `codBalancePaise`) or a real earnings source.
- **Fix Complexity:** **S** — display wiring to existing profile data (no settlement endpoint exists
  for historical earnings; see BUG-003).

---

## Explicitly excluded (considered, **not** bugs — for transparency)

| Candidate | Why excluded |
|-----------|--------------|
| **E8 Referral Credit Unlock "dead"** (`orders.service.ts:894-905` only logs) | **By design.** Referral/loyalty/wallet are intentionally hidden for launch (`growthLoops:false`); the matrix itself specifies "verify inert — confirm no credits granted." Working as intended. |
| **Razorpay production hard-fail** (`env.schema.ts:94-107`) | **Intentional guard**, not a defect — it deliberately blocks prod boot on placeholder keys. (It is a *COD-first migration blocker* per `COD_MIGRATION_PLAN.md` B1, not a bug in current behavior.) |
| **Dev OTP bypass `123456`** | **Correctly env-gated** to `NODE_ENV === 'development'` (`otp.service.ts:101`) — disabled in production. Not a vulnerability as written. |
| **Dev-mock payment/webhook signature skips** (`HARNESS` F1/F2) | Gated behind the production hard-fail above; in production (real keys) signatures **are** enforced. These are dev conveniences + a *harness* coverage gap, not an application defect. |
| **All "Code Verified Only" features (52/52)** | Un-runtime-tested ≠ defective. This is the verification backlog (`PHASED_VERIFICATION_PLAN.md`), not a bug list. |

*No fixes are proposed in this document. Severity reflects current confirmed behavior on branch
`chore/harness-phase-0a`; line numbers may drift as the tree changes.*
