# COD Operations — Implementation Audit & Design

**Scope:** detailed design audit for the two COD-first blockers from `COD_MIGRATION_PLAN.md`:
**B2 — Rider Cash Reconciliation** and **B3 — Seller Settlement Loop**.
**This is a design document. Nothing here is implemented. Razorpay is NOT removed** — the
existing payout/refund code stays dormant and reusable.
**Date:** 2026-06-19 · **Branch at audit:** `chore/harness-phase-0a`

---

## 0. Why these two are one problem

Under COD-first, money physically enters the platform **through the rider** and leaves
**to the seller**. B2 and B3 are the inflow and outflow halves of a single cash loop. They
must be designed together or the books never tie out.

```
                       ┌──────────── the COD cash loop ────────────┐
                       │                                            │
  Customer ── cash ──▶ Rider ── deposit ──▶ Platform ── settle ──▶ Seller
  (pays totalAmount)   (holds cash)         (holds cash)           (goods value)
                       │                                            │
                       │  B2: collect → deposit → reconcile         │  B3: accrue → pay → close
                       └────────────────────────────────────────────┘

  Per-order money identity (the master equation):
    codCollected (= order.totalAmount)
        = sellerGoods (Σ line subtotals, delivered lines only)
        + platformDeliveryFee
        − discount
```

Today the platform implements **only the first hop** (rider collects) and **the accrual
half of the last hop** (settlement records are created). Everything in between — rider
deposit, cash verification, the platform's cash position, and actually paying the seller
when RazorpayX is dormant — is missing.

**Sequencing consequence:** B2 must lead. The cash that funds seller settlements (B3) is
physically the cash riders deposit (B2). You cannot operate B3 manually at scale without
B2's deposit/reconcile flow telling you how much cash you actually hold.

---

# B2 — Rider Cash Reconciliation

## B2.1 Current implementation

| Piece | Location | Behavior today |
|-------|----------|----------------|
| COD collection | `orders.service.ts:666-691` (`codCollected`) | Sets `Order.status='delivered'`, `deliveredAt`, `Order.codCollectedPaise = amountPaise`; increments `RiderProfile.codBalancePaise` by `amountPaise`; writes `OrderStatusHistory`; emits `ORDER_STATUS_CHANGED`. |
| Endpoint | `orders.routes.ts:118-126` (`POST /orders/:id/cod-collected`) | Rider-role only. `amountPaise` comes **from the request body**. |
| Rider client call | `apps/rider-app/.../api.service.ts:112-113` (`collectCod`) | Sends `{ amountPaise }` = `stop.totalAmount` from the device (`DeliveryScreen.tsx:78`). |
| Rider cash balance | `RiderProfile.codBalancePaise` (`schema.prisma:189`) | **Increment-only.** Surfaced read-only to the rider via `GET /users/me` (`users.service.ts:29`). |
| Float cap config | `COD_FLOAT_CAP_PAISE=200000` (`env.schema.ts:92`; seed `cod_float_cap_paise` `seed.ts:94`) | Defined; **never read in code.** |
| Rider earnings UI | `apps/rider-app/.../EarningsScreen.tsx` | Shows delivery counts + a **hard-coded** "₹7,500" salary; `todayEarnings` is literally `reduce((s,o)=>s+0,0)`. Does **not** show cash-in-hand or anything to deposit. |
| Ledger | `TransactionType.rider_cod_collection`, `rider_cod_settlement` (`schema.prisma:73-74`) | Enum values exist; **never written** by any code. |
| Salary settlement | `RiderSettlement` model (`schema.prisma:838-855`) | Model exists; **never created** by any code. Salary settlement is not implemented. |
| Security deposit | `RiderProfile.securityDepositBalance` (`schema.prisma:184`) | Field exists; **never read or written.** |

**Net:** the rider accrues a monotonically increasing `codBalancePaise` and there is no
mechanism — code, endpoint, model, or screen — to ever bring it back down.

## B2.2 Missing pieces

1. **No deposit flow.** Nothing decrements `codBalancePaise`. No "rider handed cash to ops"
   action exists anywhere (confirmed: no `deposit` concept in `apps/`/`packages/`).
2. **Collected amount is unvalidated & client-trusted.** `codCollected` accepts whatever
   `amountPaise` the rider's device sends and never compares it to `order.totalAmount`
   (`orders.service.ts:666-691`). A rider can under-report and pocket the difference; the
   books would still look internally consistent.
3. **No collection ledger entry.** `codCollected` does not write a `Transaction` — so
   there is no immutable record of cash received, only a mutable balance counter.
4. **Float cap unenforced.** `COD_FLOAT_CAP_PAISE` never gates assignment, so a rider can
   carry unlimited platform cash (corroborated by `FEATURE_VERIFICATION_MATRIX.md` E13 and
   `RUNTIME_VERIFICATION_HARNESS.md:511-518`).
5. **No rider cash position read API/screen.** Rider can't see "you owe ₹X to deposit";
   ops can't see "who is holding how much."
6. **No reconciliation/tie-out.** No way to assert `Σ collected − Σ deposited == balance`.
7. **No short-collection / write-off path.** If the customer genuinely pays less (item
   damaged, change unavailable), there's no structured way to record it.

## B2.3 Data model impact

> Additive only. No destructive migration. `codBalancePaise` stays as the authoritative
> *outstanding cash in hand* and becomes the number deposits decrement.

**New: `RiderCashDeposit`** (`rider_cash_deposits`)

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `riderId` | uuid → `RiderProfile.id` | indexed |
| `amountPaise` | int | claimed amount |
| `method` | enum `cash_handover \| bank_deposit \| upi_transfer` | |
| `reference` | varchar? | slip no. / bank ref / UPI UTR |
| `status` | enum `pending \| verified \| disputed \| rejected` | default `pending` |
| `recordedByAdminId` | uuid? | who keyed it (ops) |
| `verifiedByAdminId` | uuid? | who confirmed cash received |
| `depositedAt` | timestamp | when the rider handed/transferred |
| `verifiedAt` | timestamp? | balance only decrements on verify |
| `note` | varchar? | dispute reason / adjustment memo |
| `createdAt` | timestamp | |

- Index `(riderId, status)`, `(status, depositedAt)`.
- **Balance decrements on `verified`, not on `pending`** — a claimed-but-unconfirmed
  deposit must not reduce what the rider owes.

**`RiderProfile` additions (optional but recommended)**

| Field | Purpose |
|-------|---------|
| `codDepositPendingPaise` (int, default 0) | claimed deposits awaiting verification (so the rider sees "₹X pending verification"). |
| `lastDepositAt` (timestamp?) | drives "you haven't deposited in N days" ops nudges. |

**No schema change, but service/validation change:**
- `codCollected` must validate `amountPaise` against `order.totalAmount` server-side
  (reject mismatch, or require an explicit `shortReason` + structured short-collection
  record). The amount should be **derived from the order**, not trusted from the client.

**Reuse, don't reinvent:** `RiderSettlement` is salary/petrol and is unrelated to COD
cash — leave it for the (separate, also-unbuilt) salary-payout feature.

## B2.4 Ledger requirements

The `Transaction` table is currently **append-only and never read back** (only one
idempotency `findFirst` in `settlement.job.ts:256`). COD ops needs it to become a real,
queryable ledger with a documented sign convention.

**Sign convention (proposed):** all `amountPaise` stay **positive**; the `type` encodes
direction relative to the platform.

| Event | When | `Transaction` row |
|-------|------|-------------------|
| COD collected | inside `codCollected` txn | `type=rider_cod_collection`, `amountPaise=order.totalAmount`, `referenceType='order'`, `referenceId=orderId` (cash now owed *to* platform by rider) |
| Rider deposit verified | on deposit `verified` | `type=rider_cod_settlement`, `amountPaise=deposit.amountPaise`, `referenceType='rider_deposit'`, `referenceId=depositId` (cash discharged) |
| Short collection / write-off | on structured short record | `type=refund` or a new `cod_short` type, `referenceType='order'` |

**Invariants the ledger must let us assert (per rider):**
```
Σ rider_cod_collection (rider) − Σ rider_cod_settlement (rider) == RiderProfile.codBalancePaise
```
- Ledger writes must be **idempotent** (deterministic dedupe key per order/deposit) so a
  retried `codCollected` or deposit-verify can't double-post.
- Both the balance mutation and the ledger write must be in **the same `$transaction`**
  (today `codCollected` mutates the balance with no ledger row at all).

## B2.5 Fraud scenarios

| # | Scenario | Enabled by today's gaps | Mitigation in this design |
|---|----------|--------------------------|----------------------------|
| F1 | **Rider under-reports collected cash** (marks delivered with a lower `amountPaise`, keeps the rest) | `codCollected` trusts client `amountPaise`, no compare to `totalAmount` (`orders.service.ts:666-691`) | Derive amount from order server-side; reject mismatch or require structured `shortReason` + ops review. |
| F2 | **Rider never deposits / absconds** | No deposit flow, no cap enforcement | Float cap gate (B2.6) blocks new assignments past `COD_FLOAT_CAP_PAISE`; ops aging report on outstanding balances. |
| F3 | **Rider accumulates large float** beyond risk tolerance | Cap unenforced | Hard/soft cap at dispatch; daily deposit SLA. |
| F4 | **Collusive "item unavailable"** to shrink cash owed, rider keeps difference | `riderReportItemUnavailable` reduces `totalAmount` (`orders.service.ts:785-796`) with no second-party check | Rate/anomaly flag per rider; require customer-side confirmation signal; reconcile unavailable-rate per rider. |
| F5 | **Disputed deposit amount** (rider says they paid more than ops logged) | No deposit record, no receipt | `RiderCashDeposit` with `reference`, `status`, dual `recordedBy/verifiedBy`, immutable ledger. |
| F6 | **Phantom deposit** (ops marks verified without cash) | No segregation of duties | Separate `recordedByAdminId` vs `verifiedByAdminId`; deposit ledger row + audit log (`AuditAction.payment_event`). |

> F1 is the highest-severity item and is **independent of building the deposit flow** —
> it should be fixed regardless, because it lets a rider steal on every single COD order.

## B2.6 Admin workflows (API-only — there is no admin app)

> `apps/` contains `api`, `customer-app`, `rider-app`, `seller-app` — **no admin frontend.**
> Admin = authenticated `admin`-role API endpoints under `/api/v1/admin/*`
> (`admin.routes.ts`), consumed by ops tooling / a future console.

Proposed endpoints:
1. `GET /admin/riders/cash` — riders ranked by `codBalancePaise` desc; flag `overCap`
   (`balance >= COD_FLOAT_CAP_PAISE`), `lastDepositAt`, aging buckets.
2. `GET /admin/riders/:id/cash` — collection + deposit history (from the ledger) and
   current outstanding.
3. `POST /admin/riders/:id/deposits` — record a deposit (`pending`): amount, method, ref.
4. `POST /admin/deposits/:id/verify` — confirm cash received → decrement `codBalancePaise`,
   write `rider_cod_settlement` ledger row, set `verifiedAt`/`verifiedByAdminId` (idempotent).
5. `POST /admin/deposits/:id/dispute` — flag mismatch with note.
6. `GET /admin/cod/reconciliation?date=` — platform-wide cash-in (collections) vs
   cash-discharged (deposits) vs outstanding, with the B2.4 invariant checked.

## B2.7 Operational workflows

1. **In-field collection.** Rider taps "Collect ₹X" (`DeliveryScreen.tsx:68-78`); amount
   is the order total (server-validated). Balance + ledger update atomically.
2. **Float cap gate.** When `codBalancePaise >= COD_FLOAT_CAP_PAISE`, the dispatch/assignment
   path (`delivery/dispatch.service` / `batching.service`) stops assigning new COD orders to
   that rider and surfaces "deposit cash to resume." (New read of the existing config.)
3. **Daily deposit / handover.** Rider deposits cash (office handover, bank, or UPI to a
   platform account) → ops records (`pending`) → ops verifies on receipt (`verified`,
   balance drops). Rider app shows "cash in hand ₹X / pending ₹Y."
4. **End-of-day reconciliation.** Ops runs `GET /admin/cod/reconciliation` to confirm
   collected − deposited == Σ outstanding balances; investigate any drift.
5. **Offboarding.** A rider can't be deactivated with a non-zero `codBalancePaise` without
   a final deposit or written-off adjustment.

---

# B3 — Seller Settlement Loop

## B3.1 Current implementation

| Piece | Location | Behavior today |
|-------|----------|----------------|
| Daily accrual | `settlement.job.ts:35-113` (`runDailySettlement`, cron `30 5 * * *` `scheduler.ts:16-26`) | For each active shop, sums **all** delivered-yesterday order items (`unitPrice×qty`) → creates a `Settlement` (`status='pending'`, `platformFeePaise=0`, `netPayable=totalProduct`); idempotent on `(sellerId, periodDate)`. Then calls `initiatePayout`. |
| Single-seller variant | `settlement.job.ts:288-340` (`processSingleSellerSettle`) | Same via upsert. |
| Payout (RazorpayX) | `settlement.job.ts:116-231` (`initiatePayout`) | If no UPI → `pending` + `needsAttention`. If `!isPayoutConfigured()` → stays `pending` with `failureReason`, **never fakes payout**. If configured → RazorpayX UPI payout; `processed` → `paid` + ledger; in-flight → `processing`; failure → `failed` + `needsAttention`. |
| Payout reconcile | `settlement.job.ts:240-285` (`runPayoutReconciliation`, every 30m) | Finalizes in-flight payouts. Early-returns when `!isPayoutConfigured()`. |
| Ledger | `seller_settlement` `Transaction` | Written **only** when a payout actually processes (`settlement.job.ts:190, 264`). |
| Seller read | `sellers.service.ts:72-104` (`getSettlements`) → `GET /sellers/me/settlements` (`sellers.routes.ts:19-22`) | Last 8 periods + a live "current unsettled" running total (delivered orders newer than last settled period). |
| Seller UI | `apps/seller-app/.../SettlementScreen.tsx` | Shows sales + settlement rows with status labels `pending/processing/paid/failed` (`:21-23`). |
| Notification on delivery | `notifications.plugin.ts:122-123` | Tells seller "Settlement kal milega" (screen=Settlement). |
| `settlementPaid` push/SMS templates | `notification.templates.ts:65`, `sms.service.ts:55` | **Defined but never invoked** — settlement job sends no notifications at all (confirmed: no `emit`/`sendPush` in `settlement.job.ts`; worker has no event-bus listeners per `reconciliation.job.ts:81-95`). |

**Net:** accrual works and is sound. The **payout half is RazorpayX-only.** With RazorpayX
dormant (the COD-first default), settlements accrue forever as `pending` and there is **no
code path that can ever set one to `paid`**, no seller notification, and no admin endpoint
to intervene (`admin.routes.ts` has zero settlement endpoints).

## B3.2 Missing pieces

1. **No manual settlement path.** No admin endpoint to record an out-of-band UPI/bank
   transfer and close a settlement (`status='paid'`, `paidAt`, ref, ledger). This is the
   core B3 gap.
2. **`paid` is unreachable without RazorpayX.** So `SettlementScreen`'s "Paid ✓" state
   never appears in COD-only operation, and "Settlement kal milega" is a promise the system
   can't keep.
3. **No settlement-paid notification.** `settlementPaid` template/SMS exist but are wired to
   nothing.
4. **Over-credit on unavailable lines.** `totalProductPaise` sums *all* order items
   including `fulfillmentStatus='unavailable_refunded'` ones (`settlement.job.ts:85-87`).
   For a COD order where a line went unavailable, `Order.totalAmount` was decremented
   (`orders.service.ts:792-795`) and the rider collected less — but settlement still credits
   the seller the full original goods value. **The seller is over-paid for goods never
   delivered.** Direct money leak under COD.
5. **No settlement detail / breakdown** exposed to seller or admin (which orders, which
   lines) — blocks dispute resolution.
6. **No "pending settlements" admin work-queue.** `needsAttention` exists on the model but
   nothing surfaces it.
7. **Cash-funding link absent.** Nothing ties "we hold ₹X in deposited rider cash (B2)" to
   "we owe ₹Y in seller settlements," so ops can't see whether payouts are funded.

## B3.3 Data model impact

> The `Settlement` model (`schema.prisma:809-836`) is already 90% sufficient — it has
> `status`, `payoutId`, `upiRef`, `needsAttention`, `failureReason`, `paidAt`. Additive only.

**`Settlement` additions (recommended):**

| Field | Purpose |
|-------|---------|
| `settlementMethod` (enum `razorpayx \| manual_upi \| manual_bank \| cash \| adjustment`) | distinguishes a manual payout from a RazorpayX one; `razorpayx` keeps current behavior. |
| `settledByAdminId` (uuid?) | who recorded the manual payout (audit / segregation of duties). |
| `manualRef` (varchar?) | UTR / bank ref for a manual transfer (or reuse `upiRef`). |

**Computation change (no schema):** exclude `unavailable_refunded` lines (or subtract
`OrderItem.refundedPaise`) from `totalProductPaise`/`netPayablePaise` so the seller is paid
only for **delivered** goods. Applies to both `runDailySettlement` and
`processSingleSellerSettle`, and to the seller's "current unsettled" estimate
(`sellers.service.ts:86-102`, which sums `cartSubtotalAtPricing` — also unaware of line refunds).

**Optional `SettlementAdjustment`** (`settlement_adjustments`): id, settlementId, amountPaise
(signed semantics via type), reason, adminId — for post-hoc corrections without mutating the
original record.

`SettlementStatus` enum (`pending/processing/paid/failed` `schema.prisma:80-85`) is reused
as-is; the manual path drives `pending → paid` directly.

## B3.4 Ledger requirements

| Event | When | `Transaction` row |
|-------|------|-------------------|
| RazorpayX payout processed | existing | `type=seller_settlement`, `amountPaise=netPayable`, `referenceType='settlement'`, `referenceId=settlementId` (`settlement.job.ts:190`) |
| **Manual payout recorded** | new admin action | **same shape** — `type=seller_settlement`, `referenceType='settlement'` — so reporting is uniform regardless of rail |
| Platform delivery-fee revenue (optional) | on delivery/settlement | `type=platform_fee` for revenue recognition (currently never written) |

- The manual "mark paid" **must reuse the existing idempotency guard pattern**
  (`settlement.job.ts:256-271`: check for an existing `seller_settlement` row before writing)
  so a manual mark + a later RazorpayX reconcile can't double-post.
- Settlement payout and the ledger write stay in one `$transaction` (as today).

**Tie-out the loop (B2 ↔ B3):**
```
platform cash on hand  =  Σ verified rider deposits (B2)  −  Σ seller_settlement paid (B3)  −  platform costs
seller owed (period)   =  Σ delivered-line goods value   −  already-settled
```

## B3.5 Fraud scenarios

| # | Scenario | Enabled by | Mitigation |
|---|----------|-----------|------------|
| G1 | **Over-payment on undelivered lines** | `totalProductPaise` includes `unavailable_refunded` items (`settlement.job.ts:85-87`) | Exclude refunded lines / subtract `OrderItem.refundedPaise` from netPayable. |
| G2 | **Phantom manual payout** (admin marks paid, no transfer sent) | manual path has no second control | `settledByAdminId` + `manualRef` required; `AuditAction.payment_event` log; reconcile against bank statement. |
| G3 | **Double payment** (manual mark, then RazorpayX reconciles the same settlement) | two rails on one record | Idempotent ledger guard + status check before any payout/mark. |
| G4 | **Seller disputes amount** | no line breakdown exposed | Settlement detail endpoint with per-order/line breakdown. |
| G5 | **Settling unfunded** (paying sellers more than deposited COD cash) | no funding link | Reconciliation view (B3.4 tie-out) gates/【warns before bulk payout. |
| G6 | **Backdated/duplicate delivery inflating a period** | accrual keys on `deliveredAt` window | `(sellerId, periodDate)` uniqueness already prevents dup records; monitor re-deliveries. |

## B3.6 Admin workflows (API-only)

1. `GET /admin/settlements?status=pending|needs_attention|all&period=` — the work queue
   (surfaces `needsAttention`/`failureReason`).
2. `GET /admin/settlements/:id` — detail: orders + line breakdown, computed vs paid, refunds.
3. `POST /admin/settlements/:id/pay` — record a manual payout: `method`, `manualRef`,
   `amountPaise` (defaults to `netPayable`) → `status='paid'`, `paidAt`, `settledByAdminId`,
   ledger row (idempotent), fire `settlementPaid` notification.
4. `POST /admin/settlements/pay-batch` — mark a whole period paid after a bulk bank run.
5. `POST /admin/settlements/:id/recompute` — re-derive amounts (e.g. after the G1 fix).
6. `POST /admin/settlements/:id/adjust` — record a `SettlementAdjustment`.
7. `GET /admin/cod/reconciliation` — the shared B2/B3 cash tie-out (funding check).

## B3.7 Operational workflows

1. **Accrual (unchanged).** Daily cron creates `pending` settlements per shop
   (`scheduler.ts:16-26`).
2. **Manual payout run (COD-default).** Ops pulls `GET /admin/settlements?status=pending`,
   checks funding against deposited rider cash, sends UPI/bank transfers, then records each
   via `POST /admin/settlements/:id/pay` (or batch). Seller sees "Paid ✓" + ref and gets the
   `settlementPaid` push/SMS.
3. **RazorpayX revival (later, optional).** Flip `RAZORPAYX_ACCOUNT_NUMBER` to real and the
   dormant payout path resumes automatically — `settlementMethod` distinguishes the two eras
   in reporting. (Razorpay stays in the codebase precisely for this.)
4. **Exception handling.** `needsAttention` settlements (no UPI, failed payout) are worked
   from the admin queue. `failureReason` carries the cause.
5. **Funding discipline.** Don't pay sellers beyond verified deposited cash (B3.4 tie-out).

---

## C. Cross-cutting design decisions to confirm (open questions)

1. **Short collection (F1):** hard-reject any `amountPaise != order.totalAmount`, or allow a
   structured short-collection with `shortReason` + ops review? (Recommend: reject by
   default; allow short only with reason + audit.)
2. **Float cap (B2.6):** hard block new assignments at the cap, or soft warn? Default cap is
   ₹2000 — realistic for the route density, or revisit?
3. **Deposit rails:** office cash handover only, or also bank/UPI deposit with slip upload?
   (Affects whether image upload / `reference` validation is needed.)
4. **Settlement funding gate (G5):** block bulk payout when it exceeds deposited cash, or
   warn-only?
5. **Ledger as source of truth:** make `Transaction` authoritative and derive balances from
   it, or keep `codBalancePaise`/settlement status as the truth with the ledger as audit?
   (Recommend: balances authoritative + ledger reconciled against them via the invariants.)
6. **Commission:** `platformFeePaise` is hard-0 today (`settlement.job.ts:97`). If commission
   is introduced, `netPayable` math and the tie-out change — design now or defer?

## D. Suggested build order (when greenlit — not now)

1. **Fix F1 first** (validate COD amount server-side) — highest-severity, smallest change,
   independent of everything else.
2. **B2 deposit + ledger** (`RiderCashDeposit`, collection/deposit ledger rows, admin
   deposit/verify endpoints, rider cash-in-hand read).
3. **B2 float-cap gate** in dispatch.
4. **B3 G1 fix** (exclude undelivered lines from netPayable) + recompute.
5. **B3 manual payout** endpoint + `settlementPaid` notification wiring.
6. **Shared reconciliation** endpoint (B2/B3 tie-out).

## E. Notes & caveats

- **Nothing here was implemented.** No code, schema, or migration was changed.
- **Razorpay is retained.** All RazorpayX payout/refund code stays dormant and is the
  reuse path for §B3.7(3).
- Line numbers reflect the working tree at audit time and may drift.
- The `Transaction` ledger is currently **write-only** (no reporting reads anywhere) — both
  B2 and B3 require giving it a read/reconciliation surface, which is itself net-new.
- Two latent bugs surfaced by this audit that exist **independent of COD-first** and are
  worth tickets regardless: **F1** (unvalidated COD amount) and **G1** (settlement over-pays
  for undelivered lines).
