# Runtime Verification Report

**Date:** 2026-06-21
**Method:** Flows driven against the **running** dev API (`http://localhost:3000`, PID 77290,
`tsx watch src/index.ts`, `NODE_ENV=development`) backed by `chirawa_development`
(Postgres `chirawa_postgres`) and Redis `chirawa_redis` (`:6379`). DB/Redis observed
directly via `docker exec`; events captured by subscribing to the event-bus channel
`chirawa:events:v1`; settlement exercised by invoking the real worker job code
(`runDailySettlement` / `processSingleSellerSettle`) via `tsx` against the same DB.
No source code was modified.

**Actors (chirawa_development):** customer `9000000077`, seller `9001110001`
(owns shop `2259f27d…`), admin `9999900001`, rider `7700110001`
(profile `a69c6e6c…`). OTP dev-bypass `123456`.

**Payment mode:** dev-mock (`RAZORPAY_KEY_*` are placeholders ⇒ `isRazorpayConfigured()`
is false). Refunds therefore make **no external Razorpay call** — they update the
`payments` row + write the `transactions` ledger only. Payouts: RazorpayX unconfigured.

---

## Result summary

| # | Flow | Result |
|---|------|--------|
| 1 | COD collection | ✅ PASS |
| 2 | Settlement generation | ✅ PASS (generation correct) |
| 3 | Customer cancel + refund | ✅ PASS |
| 4 | Seller reject + refund | ✅ PASS |
| 5 | Item unavailable + refund | ✅ PASS |

**Runtime failures found:** 1 (F-1, payment verify 500). It does **not** sit on the
current customer-app path (see F-1), so flows 3/4/5 passed once driven with the real
client contract.

---

## F-1 — `POST /payments/verify/:id` returns **HTTP 500** when an order has >1 pending payment row

**Severity:** real, reproducible 500; off the current app's happy path (see "Scope").

**Trigger / trace:**
```
POST /api/v1/orders            (paymentMethod=upi)  → 201  (creates Payment row #1, returns razorpayOrderId)
POST /api/v1/payments/orders/:id                    → 200  (creates Payment row #2 — duplicate pending row)
POST /api/v1/payments/verify/:id                    → 500
{"success":false,"error":{"code":"INTERNAL_ERROR",
 "message":"Invalid `tx.payment.updateMany()` invocation in payments.service.ts:387 …
            Unique constraint failed on the fields: (`razorpay_payment_id`)"}}
```

**Root cause (observed):**
`Payment.razorpayPaymentId` is `@unique` (schema.prisma). `markOrderPaid`
(`payments.service.ts:387`) captures payment with:
```ts
await tx.payment.updateMany({
  where: { orderId, status: 'pending' },
  data:  { razorpayPaymentId, status: 'captured', … },   // same id written to EVERY pending row
});
```
When an order has two pending `payments` rows, `updateMany` writes the *same*
`razorpayPaymentId` to both → unique-constraint violation → Prisma throws → 500.
The order stays `pending_payment`; the customer cannot pay.

**How two pending rows arise:** `POST /orders` for non-COD now creates the payment
order inline (`orders.routes.ts:34` → `createCartPaymentOrder`) **and** the standalone
`POST /payments/orders/:id` (`createPaymentOrder`) creates another — neither dedupes an
existing pending row.

**DB evidence (orders left with 2 pending rows by `/payments/orders/:id`):**
```
110fbb62…  -> pending_rows=2
737b7779…  -> pending_rows=2
965351e6…  -> pending_rows=2
3b96c86b…  -> pending_rows=2
d369c4df…  -> pending_rows=2
```
Confirmed counts: after `POST /orders` (upi) = **1** payment row; after one
`POST /payments/orders/:id` = **2** rows (16 ms apart, distinct `razorpay_order_id`s).

**Scope / blast radius:** the **current customer app does not call**
`POST /payments/orders/:id`. `CheckoutScreen.tsx:362` (`api.verifyPayment`,
`packages/api-client/src/index.ts:386`) uses the `razorpayOrderId` returned by
`POST /orders` and calls `verify` directly. With a single payment row the real path
works end-to-end (verified: `verify` → 200, order `paid`, payment `captured`,
`customer_payment` ledger txn 4000). The 500 is reached only when the orphaned
`/payments/orders/:id` endpoint is exercised (it remains live and reachable).

---

## Flow 1 — COD collection ✅

Order `59c37430…` · product Chilli Green · total 4000 (goods 1500 + delivery 2500).

| Stage | Order status | `cod_collected_paise` | rider COD balance (`a69c6e6c…`) |
|-------|--------------|-----------------------|---------------------------------|
| place (COD) | `confirmed` | NULL | 0 |
| after `cod-collected` | `delivered` | **4000** | **4000** |

- Status history: `confirmed → preparing → ready_for_pickup → picked_up → out_for_delivery → delivered`.
- `payments`: none (COD). `transactions`: none for COD collection (cash recorded on the
  order + rider balance only).
- Delivery path used in-process admin assign (`assigned:true, riderId a69c6e6c…, zone "Zone 3 — North Residential"`).
- **Events:** `order:new:for_seller`, `order:status:changed` (each transition through
  `delivered`), `order:assigned:to_rider`, `order:eta:changed` (per milestone).

---

## Flow 2 — Settlement generation ✅

Shop `2259f27d…` / seller profile `09b5d3f2…`. Delivered-today set prepared:
COD `59c37430…` (goods 1500) + prepaid `7793c21b…` (goods 2000).

- `runDailySettlement(prisma)` (canonical daily job, targets **yesterday**):
  `settled: 0, skipped: 6` — 0 orders delivered yesterday (clean no-op).
- `processSingleSellerSettle({sellerProfileId, shopId, periodDate=today})` →
  **1 settlement row created**:

```
status=pending  totalOrders=2  totalProductPaise=3500  netPayablePaise=3500
platformFeePaise=0  needsAttention=true  failureReason="No UPI ID on seller profile"
payoutId=-  paidAt=-
```

- `totalProductPaise = 3500` = item snapshots only (1500 + 2000); **delivery fees excluded**.
  Independent recompute via `settlementGoodsPaise(orders)` = **3500** (matches).
- **Idempotent:** second invocation → still **1** settlement row (upsert).
- `transactions(referenceType='settlement')` = **0** (no payout processed → no ledger; correct).

Observed runtime state (not failures):
- Seller has **no UPI** (all 10 seed sellers: `upi_id` empty) ⇒ settlement is held
  `pending` + `needsAttention` rather than paid. RazorpayX also unconfigured (dev).
- The settlement run was invoked manually because **no worker process is running**
  (see "Environment").

---

## Flow 3 — Customer cancel + refund (prepaid) ✅

Order `5bb1e699…` · Coriander · prepaid, taken to `confirmed`.

| | Order | Payment | Ledger |
|--|-------|---------|--------|
| before | `confirmed` | `captured` refunded=0 | `customer_payment` 4000 |
| after `DELETE /orders/:id` | `cancelled` (reason "RV customer cancel") | `refunded` refunded=**4000** | + `refund` 4000 "Auto-refund on cancellation: RV customer cancel" |

- History: `pending_payment → paid → confirmed → cancelled`.
- **Events:** `order:status:changed status=cancelled refundedPaise=4000`,
  `order:cancelled:for_seller`.

---

## Flow 4 — Seller reject + refund (prepaid) ✅

Order `95900f1d…` · Sunfeast YiPPee · prepaid, taken to `confirmed`.

| | Order | Payment | Ledger |
|--|-------|---------|--------|
| before | `confirmed` | `captured` refunded=0 | `customer_payment` 4000 |
| after `POST /orders/:id/reject` | `cancelled` (reason "RV seller reject") | `refunded` refunded=**4000** | + `refund` 4000 "Auto-refund on cancellation: Seller rejected: RV seller reject" |

- History: `pending_payment → paid → confirmed → cancelled`.
- **Events:** `order:status:changed status=cancelled refundedPaise=4000`.
  (No `order:cancelled:for_seller` — the seller initiated it; consistent with `sellerRejectOrder`.)

---

## Flow 5 — Item unavailable + refund (prepaid, single line) ✅

Order `0ca66f93…` · Maggi · prepaid, `confirmed`, rider assigned (active assignment).
Endpoint: `POST /delivery/orders/:orderId/items/:itemId/unavailable`.
Response: `{"cancelled":true,"refundedPaise":4000,"suggestion":null}`.

| | Order | Order item | Payment | Product | Rider |
|--|-------|-----------|---------|---------|-------|
| before | `confirmed` rider=`a69c6e6c…` | `fulfilled` refunded=0 subtotal=1500 | `captured` refunded=0 | `available` | assigned |
| after | `cancelled` (reason "Item unavailable: Maggi…") | `unavailable_refunded` refunded=**1500** | `refunded` refunded=**4000** | `out_of_stock` | released (`rider_id`=NULL) |

- Single-line order ⇒ full order cancel + full refund (4000, incl. delivery fee);
  line `refundedPaise`=1500 (subtotal). `getOrder` de-dupes via `max(paymentRefund, lineRefund)`.
- `transactions`: `customer_payment` 4000 then `refund` 4000.
- **Events:** `order:assigned:to_rider`, `order:status:changed status=cancelled refundedPaise=4000`,
  `order:item:unavailable {cancelled:true, refundedPaise:4000}`.
- Side effect (by design): product flipped `out_of_stock` + `invalidateShopCache`.
  Product restored to `available` after the run.

---

## Wallet / ledger balances

- No customer wallet is touched by these flows (wallet/growth-loops are hidden for launch).
- **Rider COD balance** (`rider_profiles.cod_balance_paise`, profile `a69c6e6c…`): `0 → 4000`
  (single COD delivery).
- **`transactions` ledger** entries written, by flow: COD — none; cancel/reject/unavailable —
  one `refund` each (4000); settlement payout — none (not processed); prepaid pay — `customer_payment`.

---

## Redis state observed

- **Event bus** `chirawa:events:v1`: live, 2 subscribers (API bridge + capture),
  84 business event messages captured across the run. Cross-process pub/sub bridge working.
- **Cart**: `cart:<customerId>` cleared after order placement (`EXISTS` = 0).
- **BullMQ backlog** (see Environment): `order-assignment` delayed=**56**,
  `settlement` delayed=1, `reconciliation` delayed=1, `cleanup` delayed=4; all `active`=0.

---

## Environment observations (runtime state, not code failures)

- **Worker process not running.** `apps/api/src/index.ts` registers no BullMQ workers
  in-process; workers live in the separate `pnpm worker` (`src/worker/index.ts`) process,
  which was not running. Consequence at runtime: the `order-assignment` queue has 56
  delayed jobs unconsumed and the repeatable `settlement`/`reconciliation`/`cleanup`
  jobs do not fire. Auto-dispatch and the daily settlement therefore do **not** run on
  their own in this environment. In-process **admin manual assign**
  (`POST /delivery/orders/:id/assign`) works, and settlement was confirmed by invoking
  the job functions directly.
- **Seller UPI absent** across all seed sellers ⇒ generated settlements are
  `pending` + `needsAttention` (no payout possible); RazorpayX also unconfigured.
- **Dev-mock note:** because mock `razorpayPaymentId`s are not globally unique, a
  timestamp-only mock id can collide with the `@unique` column and 500 a `verify` in
  dev-mock only. This is a test-harness artifact (real Razorpay payment ids are unique)
  and is distinct from F-1 (which is the multi-pending-row case and is mode-independent).

---

## Test artifacts left in `chirawa_development`

Orders created by this run: `59c37430…` (delivered, COD), `7793c21b…` (delivered,
prepaid), `5bb1e699…` / `95900f1d…` / `0ca66f93…` (cancelled+refunded), plus several
`pending_payment` orders with duplicate payment rows produced while reproducing F-1
(`110fbb62…`, `737b7779…`, `965351e6…`, `3b96c86b…`, `d369c4df…`). One settlement row
(`2565f644…`, pending). Maggi product restored to `available`.
