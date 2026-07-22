# BUG-001 — State-Machine Verification of `codCollected()`

**Pre-implementation check.** Verifies how `codCollected()` interacts with the order state machine.
**No code changes.** All findings confirmed by reading source on branch `chore/harness-phase-0a`.

---

## Verdict (the three questions)

| # | Question | Answer | One-line evidence |
|---|----------|--------|-------------------|
| 1 | Can `codCollected()` **only** be called from `out_for_delivery`? | **NO** | It has **no `order.status` guard** of any kind (`orders.service.ts:666-691`). |
| 2 | Does `codCollected()` use **`assertTransition()`**? | **NO** | `assertTransition` is called **only** inside `updateOrderStatus` (`orders.service.ts:502`); `codCollected` writes `status:'delivered'` directly. |
| 3 | Can `codCollected()` be triggered from **other states**? | **YES** | Any assigned COD order in `confirmed` / `preparing` / `ready_for_pickup` / `picked_up` (and re-run on `delivered`) passes its guards. |

**Bottom line:** `codCollected()` is **not** state-machine-gated. It force-writes `delivered` from
whatever state the order is in, skipping the legal chain. The only legal predecessor of `delivered`
per the state machine is `out_for_delivery` — that constraint is **not enforced** here.

---

## Q1 — Is it restricted to `out_for_delivery`? → NO

`codCollected()` (`apps/api/src/modules/orders/orders.service.ts:666-691`) has exactly three guards:

```ts
const order = await prisma.order.findUnique({ where: { id: orderId } });
if (!order) throw new NotFoundError('Order');
if (order.riderId !== riderProfileId) throw new ForbiddenError('Not your delivery');
if (order.paymentMethod !== 'cod')   throw new BusinessRuleError('Yeh COD order nahi hai');
// → no check of order.status anywhere
await prisma.$transaction([
  prisma.order.update({ where: { id: orderId },
    data: { status: 'delivered', deliveredAt: new Date(), codCollectedPaise: amountPaise } }),
  ...
]);
```
There is **no `order.status` comparison**. Existence + ownership + payment-method are the only gates.

---

## Q2 — Does it use `assertTransition()`? → NO

The state machine is defined at `orders.service.ts:78-98`:
```ts
export const ORDER_TRANSITIONS = { /* … */ out_for_delivery: ['delivered', 'cancelled'], delivered: [], … };
export function assertTransition(from, to) { if (from === to) return; if (!ORDER_TRANSITIONS[from]?.includes(to)) throw new BusinessRuleError(`Illegal order transition: ${from} → ${to}`); }
```
`assertTransition` is invoked in **one place only** — `updateOrderStatus` (`orders.service.ts:502`).
Repo confirmation: the sole production call site of `assertTransition` is line 502; every seller
action, customer cancel, and rider item-unavailable cancel routes through `updateOrderStatus`
(lines 551, 575, 594, 610, 621, 643, 774).

`codCollected()` **does not call `updateOrderStatus` and does not call `assertTransition`** — it
performs a raw `prisma.order.update({ data: { status: 'delivered' } })` (`:673-675`), bypassing the
state machine entirely. (Its prepaid sibling `markDelivered`, `:700-721`, bypasses it the same way.)

---

## Q3 — Can it be triggered from other states? → YES

**Why an assigned COD order can be in many states when `codCollected` is called:**

1. `Order.riderId` (the only state-relevant gate) is set at **assignment time**, which is triggered
   when the order becomes **`confirmed`** — `dispatch.plugin.ts:18-19` listens for
   `ORDER_STATUS_CHANGED` with `status === 'confirmed'`, then assignment writes `order.riderId`
   (`dispatch.service.ts:118`, `batching.service.ts:128`).
2. COD orders are **created at `confirmed`** (`placeOrder`: `initStatus = isCod ? 'confirmed' : …`,
   `orders.service.ts:265-266`).
3. Therefore, from `confirmed` onward, a COD order already satisfies `codCollected`'s
   `riderId === caller && paymentMethod === 'cod'` gate — **before** pickup or out-for-delivery.

**Resulting reachable trigger states:**

| Order state when `codCollected` is called | Accepted? | Effect |
|---|---|---|
| `confirmed` | **YES** | force → `delivered` (skips preparing/ready/picked_up/out_for_delivery) |
| `preparing` | **YES** | force → `delivered` (skips 3 states) |
| `ready_for_pickup` | **YES** | force → `delivered` (skips 2 states) |
| `picked_up` | **YES** | force → `delivered` (skips out_for_delivery) |
| `out_for_delivery` | **YES** | → `delivered` (the *only* legal case) |
| `delivered` | **YES** | re-runs → **second `codBalancePaise` increment** (no idempotency guard) |
| `cancelled` | No — *incidentally* | cancel nulls `order.riderId` (`releaseOrderAssignment`, `orders.service.ts:127`) → ownership guard throws; **not** a status check |
| `pending_payment` / `paid` | N/A for COD | COD never enters these and has no rider assigned |

So `codCollected` succeeds from **five** live states, only one of which (`out_for_delivery`) is the
legal predecessor of `delivered`. The `delivered` re-run is a money bug (double-credit). `cancelled`
is blocked only as a side effect of `riderId` being nulled, not by design.

---

## Contrast — where the state machine *is* (and isn't) enforced

| Path | Mechanism | State-machine enforced? |
|------|-----------|--------------------------|
| Seller accept/reject/preparing/ready, customer cancel, item-unavailable cancel | `updateOrderStatus` → `assertTransition` (`:502`) | **Yes** |
| Rider pickup → `picked_up` (`markPickedUp`) | `riderAdvance` (`dispatch.service.ts:188-218`) — direct write | **No** (no `assertTransition`; no from-state check) |
| Rider start-delivery → `out_for_delivery` (`startDelivery`) | `riderAdvance` — direct write | **No** assertTransition; only an ad-hoc batch "all picked up" guard (`:199-203`) |
| **Rider COD completion → `delivered` (`codCollected`)** | direct write, **no guards** | **No — and no from-state guard at all** |
| Rider prepaid completion → `delivered` (`markDelivered`) | direct write | **No** from-state guard |

The entire **rider status-advance surface bypasses `assertTransition`**; `codCollected` is the most
permissive (it has no status gate whatsoever, not even the batch check `startDelivery` has).

---

## Consequence (link to BUG-001)

Combined with BUG-001 (client-supplied amount), a rider assigned to a **freshly-`confirmed`** COD
order can immediately `POST /orders/:id/cod-collected` with `{ "amountPaise": 0 }` and mark it
`delivered` **before the seller has prepared it or the rider has picked it up** — recording ₹0
collected. The missing state guard widens the BUG-001 window from "at delivery" to "any time after
assignment," and the missing idempotency guard allows a repeat call to double-credit the rider
balance.

This confirms the adjacent items flagged in `BUG_001_FIX_PLAN.md` §9:
- **§9.1 idempotency** (the `delivered`-re-run double-credit), and
- **§9.2 state assertion** (no `out_for_delivery` precondition).

Both are real, not hypothetical. Whether to fold the `order.status === 'out_for_delivery'` assertion
into the BUG-001 fix or ship it as an immediate fast-follow is the implementer's scope call — but the
verification answer is unambiguous: **today `codCollected` is callable from multiple non-terminal
states and does not use the state machine.**

---

*No source code was modified. Line numbers reflect branch `chore/harness-phase-0a` and may drift.*
