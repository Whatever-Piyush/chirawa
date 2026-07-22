# BUG-001 Implementation Report

**Bug:** COD collection — trusted client amount (D1) + state-machine bypass (D2) + non-idempotent double-credit (D3).
**Implemented per:** `BUG_001_FIX_PLAN.md` (consolidated 3-defect plan).
**Scope:** BUG-001 only. No refactoring, no unrelated fixes. **BUG-002/003/004 not started.**
**Date:** 2026-06-20 · **Branch:** `chore/harness-phase-0a`

---

## 1. Files changed (4)

| File | Change | Defects |
|------|--------|---------|
| `apps/api/src/modules/orders/orders.service.ts` | `codCollected` rewritten: server-derives `amountDue = order.totalAmount` (ignores client value, logs mismatch); `assertTransition(order.status, 'delivered')`; terminal-state early-return; interactive `$transaction` with compare-and-set `order.updateMany({ where:{ status:'out_for_delivery' }})` + `flip.count` guard; emit only when credited. Param typed `amountPaise: number \| undefined`. | D1, D2, D3 |
| `apps/api/src/modules/orders/orders.schema.ts` | Added `codCollectedSchema = z.object({ amountPaise: z.number().int().nonnegative().optional() })` + `CodCollectedInput` type. | D1 |
| `apps/api/src/modules/orders/orders.routes.ts` | Imported `codCollectedSchema`; `/:id/cod-collected` now `safeParse`s the body (400 on invalid) and passes the optional amount; dropped the `Body` from the handler generic. | D1 |
| `apps/api/src/modules/orders/__tests__/orders.cod-collected.test.ts` | New harness (callback-form `$transaction` mock + `order.updateMany`; `totalAmount` on the mock order) and all new cases. | D1, D2, D3 |

No Prisma schema/migration. No `packages/*` change. No rider-app change. (Context7 consulted for Prisma v5: interactive `$transaction(async tx => …)` returns the callback value; `updateMany` returns `BatchPayload { count }` — confirming the compare-and-set guard.)

---

## 2. Tests added

Original file had **5** tests. New file has **13** (8 net new):

| # | Test | Status |
|---|------|--------|
| 1 | Happy path — records **server-derived total**, flips via compare-and-set, credits by `RiderProfile.id` | updated |
| 2 | **D1** — mismatched client amount (`1`) ignored → records order total | **new** |
| 3 | **D1** — no amount supplied → still records server-derived total | **new** |
| 4–7 | **D2** — rejects from `confirmed` / `preparing` / `ready_for_pickup` / `picked_up` (`it.each`) | **new** |
| 8 | **D3** — retry on already-`delivered` order is idempotent (no second credit, no emit) | **new** |
| 9 | **D3** — concurrent flip (`updateMany` → `{count:0}`) does not credit again | **new** |
| 10 | BUG-1 regression — rejects rider `User.id` instead of `RiderProfile.id` | retained |
| 11 | Rejects non-COD order | retained |
| 12 | Rejects rider who doesn't own the delivery | retained |
| 13 | Rejects missing order | retained |

---

## 3. Tests passed

| Scope | Result |
|-------|--------|
| `orders.cod-collected.test.ts` (target) | **13 / 13 passed** |
| Orders module (`src/modules/orders`, 9 files) | **79 / 79 passed** |
| Full `apps/api` suite (42 files) | **284 / 284 passed** |
| Typecheck (`tsc --noEmit`) | **Baseline-neutral** (see below) |

**Typecheck detail (honest):** the repo has a **pre-existing** `tsc --noEmit` baseline of **29 errors**
(all `exactOptionalPropertyTypes: true` Fastify route-handler generics + test-helper interfaces
`StockTx`/`ReleasePrisma`/`updateOrderStatus`/`payments`/`pricing`/`razorpay`). Verified via `git stash`:
- **Committed HEAD (no changes): 29 errors** (15 in `orders.routes/service`).
- **After my change: 29 errors** (15 in `orders.routes/service`).
- **Δ = 0.** No error references `codCollected` (service errors are at lines 305/507/518/599/657/796 — outside my function), `orders.schema.ts`, or the test. The `orders.routes.ts(121)` error is the same file-wide pattern present on **every** handler (84/93/103/112/133/144/164/179), i.e. pre-existing, not introduced by this change.

The D1 warning path was observed firing in the run: `COD amount mismatch (ignored) order=order_1 sent=1 due=16000`.

---

## 4. Runtime behavior changes

1. **Recorded COD cash is now server-derived (D1).** `Order.codCollectedPaise` and the
   `RiderProfile.codBalancePaise` increment now use `Order.totalAmount`. The client-supplied
   `amountPaise` is **ignored** (advisory); a mismatch logs a `console.warn` but does not change the
   recorded value. *(Before: the client value was written verbatim → under-report theft vector.)*
2. **State machine enforced (D2).** `cod-collected` now returns **422** (`BusinessRuleError`,
   "Illegal order transition: <state> → delivered") when the order is **not** `out_for_delivery`.
   *(Before: callable from `confirmed`/`preparing`/`ready_for_pickup`/`picked_up`, force-marking
   delivered.)*
3. **Idempotent on retry (D3a).** A repeat call on an already-`delivered` order returns success
   **without** re-crediting the balance or re-emitting. *(Before: double-credit.)*
4. **Race-safe under concurrency (D3b).** Compare-and-set (`updateMany where status='out_for_delivery'`
   + `count` check) means only the call that actually flips the order credits the balance; a
   concurrent loser no-ops. *(Before: both calls credited.)*
5. **Body validation (D1).** The route now validates the body via zod (`amountPaise` optional,
   non-negative integer); malformed input → **400** `VALIDATION_ERROR`. *(Before: unchecked `as` cast.)*
6. **Rider app unaffected.** The app sends `stop.totalAmount` from `out_for_delivery`
   (`DeliveryScreen.tsx:165-168` only shows "deliver" then); the value is ignored and the state guard
   passes → identical successful outcome, no app release required.

---

## 5. Deviations from the plan

- **Optional route-level test omitted.** The plan listed an *optional* route-level malformed-body
  test (`amountPaise: "x"` → 400). It was **not added** — the orders module has no Fastify
  route-level test harness (all existing tests are service-level unit tests), and the plan marked it
  optional. The zod validation itself is in place and exercised by the route. This is the only
  deviation; all **required** test cases from the plan are present.
- No other deviations. Logic, files, signature change (`number | undefined`), guard ordering
  (idempotency check before `assertTransition`), compare-and-set, and the schema/route wiring match
  the plan exactly.

---

## 6. Scope adherence
- Only BUG-001 (D1+D2+D3) implemented; no refactoring of surrounding code; no unrelated fixes.
- `markDelivered` (prepaid sibling) left **unchanged** (plan flagged its D2/D3 alignment as a separate
  low-priority follow-up — not started).
- BUG-002 (settlement over-pay), BUG-003 (rider cash reconciliation), BUG-004 (float cap) **not
  started.**
- No changes outside `apps/api/src/modules/orders/`.
