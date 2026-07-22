# F-1 Root Cause — `POST /payments/verify/:id` → HTTP 500

**Scope:** F-1 only. No code changed. No fix applied. Investigation + smallest safe fix.

**Symptom:** `POST /api/v1/payments/verify/:orderId` returns 500 with
`Unique constraint failed on the fields: (razorpay_payment_id)` when the order has
**more than one `pending` `payments` row**. The order stays `pending_payment`.

**One-line cause:** two code paths each create a `pending` `Payment` row for the same
order without deduping, and the capture step writes the *same* `razorpayPaymentId` to
**every** pending row of the order at once — which the `@unique` column rejects.

---

## 1. Endpoint traces (exact file:line)

### A) `POST /api/v1/orders` (place order)
- Route: `apps/api/src/modules/orders/orders.routes.ts:22`
- Non-COD branch creates the payment **inline**:
  - `orders.routes.ts:30` `if (parsed.data.paymentMethod !== 'cod')`
  - `orders.routes.ts:34` `await paymentsService.createCartPaymentOrder(order.orderIds, …)`
  - returns `razorpayOrderId` in the place response (`orders.routes.ts:35`)
- Whole handler is idempotent per cart: `orders.routes.ts:45-46`
  (`idemKey = … ?? auto:${cartId}` → `runIdempotent`), so a replay returns the cached
  body and does **not** re-create payments.
- `createCartPaymentOrder`: `apps/api/src/modules/payments/payments.service.ts:43-69`
  - filters orders to `status === 'pending_payment'` (`:46`) — a *status* check only
  - **creates one Payment row per order** (`:56-60`), no check for an already-existing
    `pending` Payment row.

**Result:** for a UPI order, `POST /orders` leaves **exactly one** `pending` Payment row
per child order (verified at runtime: 1 row after place).

### B) `POST /api/v1/payments/orders/:orderId` (create payment order — standalone)
- Route: `apps/api/src/modules/payments/payments.routes.ts:22-35`
  - handler calls `createPaymentOrder` (`payments.routes.ts:29`)
- `createPaymentOrder`: `apps/api/src/modules/payments/payments.service.ts:16-35`
  - guard is a *status* check only: `:20` `if (order.status !== 'pending_payment') throw`
  - **creates a Payment row unconditionally**: `:24-26` (dev-mock) / `:31-33` (configured)
  - **no check for an existing `pending` Payment row** for the order.

**Result:** calling this **in addition to** `POST /orders` leaves the order with **two**
`pending` Payment rows (verified at runtime: 2 rows, distinct `razorpay_order_id`,
~16 ms apart).

### C) `POST /api/v1/payments/verify/:orderId` (verify / capture)
- Route: `apps/api/src/modules/payments/payments.routes.ts:39-63` → `verifyClientPayment` (`:54`)
- `verifyClientPayment`: `payments.service.ts:117-134`
  - already-settled short-circuit `:124-126`
  - signature check skipped in dev-mock `:127`
  - `:132` `await settleOrdersForRazorpayOrder(razorpayOrderId, razorpayPaymentId, 'upi')`
- `settleOrdersForRazorpayOrder`: `payments.service.ts:72-88`
  - finds order ids by `razorpayOrderId` (`:73-76`) → per order calls `markOrderPaid` (`:86`)
- `markOrderPaid`: `payments.service.ts:366-417` — **the failing statement**:
  ```
  387   await tx.payment.updateMany({
  388     where: { orderId, status: 'pending' },
  389     data:  { razorpayPaymentId, status: 'captured', capturedAt: new Date(), method },
  390   });
  ```
  `updateMany` matches **all** `pending` rows of the order and writes the **same**
  `razorpayPaymentId` to each.

### The constraint it violates
- `apps/api/prisma/schema.prisma:656`
  `razorpayPaymentId String? @unique @map("razorpay_payment_id")`
- With ≥2 pending rows, `:387` tries to set one value on two rows → Postgres unique
  violation → Prisma throws inside the `$transaction` → 500.

---

## 2. Why multiple `pending` payment rows exist

1. Two creators, neither deduping by `(orderId, status='pending')`:
   - `createCartPaymentOrder` (`payments.service.ts:56-60`) — runs on `POST /orders`.
   - `createPaymentOrder` (`payments.service.ts:24-26 / 31-33`) — runs on `POST /payments/orders/:id`.
   Each only checks order *status* is `pending_payment`; it does not look at existing
   `payments` rows. Calling **both** for one order ⇒ 2 pending rows.
2. No DB guard against it: `payments` has only `razorpayPaymentId @unique` and
   `@@index([orderId])` (`schema.prisma:656`, `:669`). There is **no** unique constraint
   on `(orderId, status)` or on a single active payment per order, so two `pending` rows
   are perfectly legal at the DB level — until capture tries to give them the same id.
3. The bug is **per-order**, not multi-shop. On the intended multi-shop path
   `createCartPaymentOrder` writes one row **per child order** sharing one
   `razorpayOrderId`; `markOrderPaid` runs per order and its `where:{orderId,status:'pending'}`
   still matches a single row. So multi-shop alone is fine — the failure needs **two
   pending rows for the same order**, which today only the standalone endpoint produces.

**How it was triggered:** the only non-doc caller of `POST /payments/orders/:id` is the
test harness `pay_order` helper — `scripts/harness/10_fixtures.sh:48`
(`auth CUST POST "/payments/orders/$oid"`), called before `verify`. That second call
created the duplicate row that broke capture.

---

## 3. Intended contract

Determined from callers + git history + existing repo audits:

- **`POST /orders` SHOULD create the payment.** It is the current, live path: it creates
  one Razorpay order for the cart grand total and one `Payment` row per child order
  (`orders.routes.ts:34` → `createCartPaymentOrder`, `payments.service.ts:43-69`), and
  returns `razorpayOrderId` to the client. The customer app consumes exactly this:
  - `apps/customer-app/src/screens/orders/CheckoutScreen.tsx:356-366` opens the Razorpay
    sheet with the place-response data, then calls `api.verifyPayment(orderId, …)`.
  - api-client surface: `packages/api-client/src/index.ts:386-390` exposes **only**
    `verifyPayment` (`POST /payments/verify/:id`).

- **`POST /payments/orders/:id` should NOT be on the client path — it is the redundant
  one.** It is the original single-order endpoint (`payments.routes.ts:22` introduced in
  commit `34baa0f`, 2026-05-25, "Step 7 … Razorpay payments"), made redundant when
  payment creation moved inline onto `POST /orders` for multi-shop carts. It is already
  documented as dormant/latent-risk:
  - `docs/md file/BILLING_FORENSIC_AUDIT.md:117` — "latent risk (not currently active) …
    the single-order endpoint is still reachable and is the historical bug."
  - `COD_MIGRATION_PLAN.md:156` — "Keep Dormant … Unreachable once checkout is COD-only."
  It also undercharges a multi-shop cart (only the primary order's `totalAmount`,
  `payments.service.ts:30`), so it is not safe to use as the create path.

**Answer:** keep `POST /orders` as the sole creator; `POST /payments/orders/:id` is the
one to neutralize (dedupe) or remove. The 500 is the *symptom*; the duplicate pending
row is the *defect*.

---

## 4. Smallest safe fix (proposed — NOT applied)

Goal: eliminate the >1-pending-row condition at its source, without touching the live
`POST /orders` → `verify` path or the capture logic (i.e. no payments redesign).

**Primary fix — make `createPaymentOrder` reuse an existing pending payment
(idempotent), instead of creating a duplicate.**
File: `apps/api/src/modules/payments/payments.service.ts`, inside `createPaymentOrder`,
immediately after the status guard at `:20` and before the create at `:22`:

```ts
// Reuse an existing pending payment for this order rather than creating a duplicate.
// POST /orders already creates the payment for non-COD checkout; a second create here
// produced a 2nd pending row that broke capture (updateMany on @unique razorpay_payment_id).
const existing = await prisma.payment.findFirst({
  where: { orderId, status: 'pending' },
  orderBy: { createdAt: 'desc' },
});
if (existing?.razorpayOrderId) {
  return {
    razorpayOrderId: existing.razorpayOrderId,
    razorpayKeyId:   env.RAZORPAY_KEY_ID,
    amountPaise:     order.totalAmount,
    currency:        'INR',
    isDev:           !isRazorpayConfigured(),
  };
}
```

Why this is the smallest safe change:
- ~12 lines, confined to the dormant endpoint's service function.
- Does **not** touch `POST /orders`, `createCartPaymentOrder`, `verifyClientPayment`, or
  `markOrderPaid` — the live path and capture stay byte-for-byte the same.
- Removes the only runtime way to get two `pending` rows per order, so `markOrderPaid`'s
  `updateMany` at `:387` always matches one row ⇒ no unique violation.
- Keeps `POST /payments/orders/:id` functional for any stray caller (e.g. the harness
  fixture at `scripts/harness/10_fixtures.sh:48`) — it now returns the payment the order
  already has.

**Alternatives (noted, larger / not recommended for "smallest"):**
- *Remove the endpoint* `POST /payments/orders/:id` (delete route `payments.routes.ts:22-35`).
  Clean (no client uses it) but deletes a surface the harness fixture still calls, and
  doesn't harden against a duplicate row arriving any other way.
- *Harden capture* at `payments.service.ts:387` to capture a single pending row instead
  of `updateMany`. This edits the money-capture path (closer to a payments redesign) and
  would leave orphan pending rows behind — out of scope per "do not redesign payments."
- *DB constraint* (partial unique index "one pending payment per order"). Correct as
  defense-in-depth but requires a migration and could 500 legitimate concurrent creates —
  larger than the minimal fix.

---

## Evidence index (file:line)

| Item | Location |
|------|----------|
| `POST /orders` route | `apps/api/src/modules/orders/orders.routes.ts:22` |
| inline payment create on place | `apps/api/src/modules/orders/orders.routes.ts:30,34` |
| place idempotency | `apps/api/src/modules/orders/orders.routes.ts:45-46` |
| `createCartPaymentOrder` (creates rows) | `apps/api/src/modules/payments/payments.service.ts:43-69` (create `:56-60`) |
| `POST /payments/orders/:id` route | `apps/api/src/modules/payments/payments.routes.ts:22-35` |
| `createPaymentOrder` (creates row, no dedup) | `apps/api/src/modules/payments/payments.service.ts:16-35` (create `:24-26`/`:31-33`) |
| `POST /payments/verify/:id` route | `apps/api/src/modules/payments/payments.routes.ts:39-63` |
| `verifyClientPayment` → settle | `apps/api/src/modules/payments/payments.service.ts:117-134` (`:132`) |
| `settleOrdersForRazorpayOrder` | `apps/api/src/modules/payments/payments.service.ts:72-88` (`:86`) |
| **failing capture `updateMany`** | `apps/api/src/modules/payments/payments.service.ts:387-390` |
| unique column violated | `apps/api/prisma/schema.prisma:656` |
| client uses only verify | `apps/customer-app/src/screens/orders/CheckoutScreen.tsx:362`; `packages/api-client/src/index.ts:386-390` |
| only non-doc caller of dormant endpoint | `scripts/harness/10_fixtures.sh:48` |
| dormant-endpoint origin | commit `34baa0f` (2026-05-25) |
