# YMAL → Place Order Race — Root‑Cause Analysis & Fix Plan

**Status:** Analysis + plan only. **No code changed.** All references are to the live codebase.
**Scope:** the Checkout "You Might Also Like" add → Place Order race that drops the added
item. **Out of scope:** multi‑shop splitting, tracking.

---

## 1. Exact root cause

The client fires **two causally‑dependent requests without ordering them**, and the server
cart is a single per‑user key that Place Order **consumes and deletes**:

1. **Add is fire‑and‑forget + optimistic.** `ProductCard.onAdd` calls `void addItem(product)`
   (`apps/customer-app/src/components/product/ProductCard.tsx:97`). `addItem` updates the
   optimistic `count` **synchronously** (`CartContext.tsx:113`) and only *then* awaits
   `POST /cart/items` and `refresh()` (`CartContext.tsx:129-131`). `subtotalPaise` updates
   **only inside `refresh()`** (`CartContext.tsx:100`).
2. **Place Order does not await the add.** `handlePlaceOrder` immediately calls
   `api.placeOrder({ cartId, addressId, paymentMethod })`
   (`CheckoutScreen.tsx:291-293`) and `canPlaceOrder` never considers in‑flight cart
   mutations (`CheckoutScreen.tsx:363` = `!!addressId && !placing && !!cart && withinHours`).
3. **The server cart is one key per user, and Place Order destroys it.** `placeOrder` reads
   `cart:{userId}` (`orders.service.ts:152`), builds the order from whatever is there **at
   that instant**, then **deletes** the cart (`orders.service.ts:319` → `cart.service.ts:
   clearCart 317-320`). It **ignores the `cartId` in the payload** — there is no check that
   the order is consuming the cart the customer actually confirmed.
4. **A late add recreates the cart with a NEW id.** `addItem` computes
   `cartId = existingCart?.cartId ?? crypto.randomUUID()` (`cart.service.ts:219`). After
   Place Order deleted the cart, the delayed add finds no cart and **mints a fresh one** →
   the added item lands in an **orphan cart**, not the order.

> **Root cause, one line:** Place Order and the YMAL add are unordered concurrent writes to
> the single `cart:{userId}` key; when `POST /orders` wins, it orders the pre‑add cart and
> deletes it, and the in‑flight add resurrects a new cart holding the lost item.

Two aggravating facts that the fix must also address:
- **No idempotency on the client.** The api‑client request layer sends only
  `Content-Type` + `Authorization` (`packages/api-client/src/index.ts:63-107`); `placeOrder`
  (`:380`) sends no `Idempotency-Key`. The **backend already supports** it
  (`orders.routes.ts:42-45`, `shared/utils/idempotency.ts`) but it is **dormant** → rapid
  double‑tap can create duplicate orders (only loosely guarded by the `placing` flag,
  `CheckoutScreen.tsx:289`, which has an async‑state window; `pulseAndPlace:278-284` adds a
  small animation delay but does not serialize).
- **No cart version/fingerprint.** The `carts` table has no version column; the Redis cart
  payload carries only `updatedAt` (`cart.service.ts:47-55`). So the server cannot today
  detect "the cart changed since the customer confirmed it."

---

## 2. Exact files involved

| File | Role in the bug / fix |
|---|---|
| `apps/customer-app/src/components/product/ProductCard.tsx` | `onAdd` fires `void addItem` (`:88-98`) — the YMAL add entry point |
| `apps/customer-app/src/context/CartContext.tsx` | optimistic `addItem`/`setQuantity` (`:109-158`), `refresh` (`:86-107`), `count`/`subtotalPaise` (`:66-69`,`:100`). **No pending‑mutation state, no `finally`.** |
| `apps/customer-app/src/screens/orders/CheckoutScreen.tsx` | `canPlaceOrder` (`:363`), `handlePlaceOrder` (`:286-322`), bill watcher (`:254-264`), `reloadCart` (`:235-245`) |
| `packages/api-client/src/index.ts` | `request` core (`:63-107`, no custom‑header hook), `addToCart` (`:299`), `placeOrder` (`:380`) |
| `apps/api/src/modules/orders/orders.service.ts` | `placeOrder` reads + deletes `cart:{userId}` (`:152`,`:319`); ignores payload `cartId` |
| `apps/api/src/modules/orders/orders.routes.ts` | already wires `Idempotency-Key` → `runIdempotent` (`:42-45`) |
| `apps/api/src/modules/orders/orders.schema.ts` | `placeOrderSchema` (would gain an optional `expectedCart*` field for Option D) |
| `apps/api/src/modules/cart/cart.service.ts` | single‑key cart, `cartId` regen (`:219`), `clearCart` (`:317-320`) — where a version/fingerprint would live |
| `apps/api/src/shared/utils/idempotency.ts` | existing SETNX idempotency (reused for duplicate‑order prevention) |

---

## 3. Event sequence diagrams

### 3.1 Failing path (today)

```
Redis cart:{u} = { id:C1, items:[Maggi], subtotal:1500 }
Client: cart.cartId=C1, count=1, subtotalPaise=1500

User taps ADD (Atta) ─ ProductCard.onAdd → void addItem(Atta)
   └ CartContext.addItem: setQuantities count→2  (SYNC, optimistic)
                          await POST /cart/items  ──────────────┐ (in flight)
User taps PLACE ORDER  (button enabled: canPlaceOrder ignores pending)
   └ handlePlaceOrder: POST /orders {cartId:C1}  ───────────┐   │
                                                            ▼   │
   SERVER POST /orders FIRST:                                   │
      redis.get(cart:{u}) = {C1,[Maggi]}                        │
      create order = [Maggi]; redis.del(cart:{u})               │
                                                            ┌───┘
   SERVER POST /cart/items (Atta) arrives LATE:           ▼
      loadCart → null → cartId = randomUUID() = C2
      saveCart {C2,[Atta]}
   addItem.refresh() → GET /cart = {C2,[Atta]} → bill flips to [Atta]

RESULT: Order = [Maggi]   |   Orphan cart = {C2,[Atta]}   ← item lost
```

### 3.2 Fixed path (recommended — Option E core)

```
User taps ADD (Atta) ─ addItem: pending++ (SYNC); enqueue mutation; POST /cart/items
User taps PLACE ORDER
   └ handlePlaceOrder:
        setPlacing(true)
        await cart.flushPending()      ← resolves when pending==0 (add committed + refreshed)
        await reloadCart(addressId)     ← bill now {C1,[Maggi,Atta]}; cartId stable C1
        POST /orders { cartId:C1, expectedItemCount:2, Idempotency-Key:K }
   SERVER POST /orders:
        cart:{u} = {C1,[Maggi,Atta]}; fingerprint matches → order=[Maggi,Atta]; del cart
RESULT: Order = [Maggi,Atta]   |   no orphan cart   |   no loss
   (residual stale → 409 → client refresh+re-preview+confirm; double-tap → idempotent replay)
```

---

## 4. Why the current implementation fails

- **Optimism without serialization.** The UI commits the add visually (`count` + fly‑to‑cart
  animation) before the server has it; nothing makes a *subsequent* action wait for the
  add. The Place Order button is a *different* control on the same screen with no knowledge
  of the in‑flight write.
- **The gate is incomplete.** `canPlaceOrder` (`CheckoutScreen.tsx:363`) checks address /
  `placing` / cart‑loaded / hours — **not** "is a cart mutation in flight."
- **The server has no consistency anchor.** `placeOrder` consumes `cart:{userId}` regardless
  of the `cartId` the client sent, so it cannot tell that the customer confirmed a different
  (larger) cart than the one present at order time.
- **Destroy‑then‑recreate.** Because Place Order deletes the cart and `addItem` regenerates a
  cartId, a lost add doesn't just vanish — it spawns an orphan cart, which is why the runtime
  repro showed `cart 95add219 → order [Maggi]` + `new cart 01b8a2d2 [Atta]`.

---

## 5. Options evaluated

### Option A — Disable Place Order while a cart mutation is pending
Track `pendingMutations` in `CartContext` (increment at the start of `addItem`/`setQuantity`,
decrement in a **`finally`** — note neither currently has one). Expose `isMutating`; set
`canPlaceOrder = … && !isMutating` (`CheckoutScreen.tsx:363`).

- **Complexity:** Low (~20 lines in CartContext + 1 condition).
- **Risk:** Low; additive client state. Main hazard: a hung request keeps the button disabled
  → the decrement **must** be in `finally`, ideally with a watchdog timeout.
- **UX impact:** Place Order briefly greys during each add; under slow network it can feel
  "dead" for seconds. Mitigate with a "Updating cart…" caption.
- **Runtime cost:** negligible.
- **Edge cases handled:** multiple YMAL adds (counter N), rapid tapping, failed add (finally).
  **Not handled:** duplicate orders, concurrent mutation from another device.

### Option B — Await `addItem` completion before enabling checkout
Honor the Place Order tap but **await** outstanding mutations before issuing the order
(`await cart.flushPending()` inside `handlePlaceOrder`), instead of disabling the button.

- **Complexity:** Low–Med (needs a `flushPending()`/tail‑promise in CartContext).
- **Risk:** Low.
- **UX impact:** **Best** — the tap is never rejected; a short spinner, then the order
  proceeds *with* the item. No dead button.
- **Runtime cost:** the user waits out the in‑flight add (already happening anyway).
- **Edge cases handled:** the core race, multiple adds, slow network. **Not handled alone:**
  duplicate orders; a truly concurrent external mutation between flush and `POST /orders`.

> Note: B subsumes the *useful* part of **Option C**. A bare "refresh before placeOrder"
> (GET /cart then order) does **not** fix the race — if the add is still in flight, the
> refresh reads pre‑add state and the order still misses the item. Refresh is only valuable
> *after* awaiting pending mutations (to resync the bill). So C alone is **insufficient**.

### Option C — Force cart refresh before placeOrder
`await reloadCart()` then `placeOrder`.

- **Complexity:** Very low.
- **Risk:** **Gives false confidence** — does not close the window (see note above).
- **UX impact:** minor delay.
- **Runtime cost:** one extra GET /cart.
- **Edge cases:** fixes the *bill staleness*, not the *item loss*. Useful only combined with B.

### Option D — Backend cart versioning / optimistic concurrency
Add a monotonic `version` (or fingerprint = item‑count + subtotal + line hash) to the cart
(Redis payload and/or a `carts.version` column). Client sends the **expected** version with
`placeOrder` (`orders.schema.ts`); server rejects with **409** if the live cart differs.

- **Complexity:** Med–High (Redis payload shape + optional migration; `orders.schema.ts`;
  client must track and send the value; new 409 handling).
- **Risk:** Med — introduces an order‑rejection path that must auto‑recover (refresh +
  re‑preview + confirm), or it degrades UX into "order failed."
- **UX impact:** neutral if 409 auto‑recovers silently; bad if surfaced as a raw error.
- **Runtime cost:** trivial.
- **Critical caveat:** to catch *this* race, the client must bump its expected version
  **optimistically on Add** (before the POST). If it only knows the server‑confirmed version,
  it sends the pre‑add value, which still matches the pre‑add server cart → the bug is **not**
  caught. So pure‑backend D is **defense‑in‑depth**, not a standalone fix.
- **Edge cases handled:** concurrent mutation from another tab/device; converts silent loss
  into an explicit, recoverable signal. **Not handled alone:** the in‑process race without
  optimistic client versioning.

### Option E — Combined (recommended)
**Client serialization (B) as the primary fix** + **A's pending state for button feedback** +
**D‑lite server safety net** + **wire the existing Idempotency‑Key**:
1. `CartContext`: serialize mutations through a queue; expose `pendingCount`/`isMutating` and
   `flushPending()`; decrement in `finally`.
2. `CheckoutScreen.handlePlaceOrder`: `await flushPending()` → `await reloadCart()` →
   `placeOrder(...)`. Show "Updating cart…" while flushing (don't hard‑disable).
3. `placeOrder` request sends an **`Idempotency-Key`** (one UUID per checkout attempt) →
   reuses `runIdempotent` (`orders.routes.ts:42-45`) → rapid double‑tap returns the *same*
   order. Requires adding a header hook to `packages/api-client/src/index.ts:request`.
4. **Server safety net:** `placeOrder` accepts an optional `expectedItemCount` (or fingerprint)
   and **rejects (409)** if the live `cart:{userId}` doesn't match what the client confirmed;
   also stop ignoring the payload `cartId` (reject if it doesn't match the live cart's id).
   Surface the already‑computed `droppedLines` too.

- **Complexity:** Med (mostly client; small, backward‑compatible server additions).
- **Risk:** Low–Med; each piece is independently shippable and additive.
- **UX impact:** Good — taps honored, brief sync, no silent loss, no duplicate orders.
- **Runtime cost:** one awaited refresh per checkout; trivial server checks.
- **Edge cases handled:** all of the requirements in §6.

---

## 6. Recommendation & justification

**Adopt Option E**, with **client serialization (B) + pending feedback (A) as the part that
actually closes the reported race**, and the backend fingerprint check + idempotency as
defense‑in‑depth. Rationale against the required guarantees:

| Requirement | How E satisfies it |
|---|---|
| **Prevent item loss** | `flushPending()` guarantees the add has committed to `cart:{userId}` *before* `POST /orders` consumes it → order always sees the item. Server fingerprint 409 catches any residual/external staleness instead of losing silently. |
| **Prevent duplicate orders** | `Idempotency-Key` per checkout → `runIdempotent` replays the first order on retry/double‑tap (`idempotency.ts`); the `placing` flag remains a first line. |
| **Preserve good UX** | Place Order is *awaited*, not dead‑disabled (B); a short "Updating cart…" state; 409 auto‑recovers (refresh + re‑preview) rather than erroring. |
| **Slow network** | `flushPending()` simply awaits the in‑flight add (with a watchdog); no race regardless of latency. |
| **Rapid tapping** | Mutation queue serializes adds; idempotency dedups order taps. |
| **Multiple YMAL adds** | `pendingCount` tracks N in‑flight; `flushPending` resolves only at 0; queue preserves order. |
| **Concurrent cart mutations** | Server fingerprint/version check (D‑lite) rejects an order whose live cart ≠ the confirmed cart (e.g., second device). |

Why not a single simpler option: **A** alone hurts UX and ignores duplicates; **C** alone
doesn't close the window; **D** alone can't catch the in‑process race without client changes.
E layers a *correctness* guarantee (serialization) with a *safety net* (fingerprint) and a
*duplicate guard* (idempotency) — each small, each independently testable.

**Suggested phasing:** (1) CartContext `pendingCount`/`flushPending` + `finally`; (2)
`handlePlaceOrder` await + refresh (closes the reported bug); (3) Idempotency‑Key wiring; (4)
server fingerprint 409 + payload‑`cartId` validation + `droppedLines` surfacing.

---

## 7. Testing requirements

### 7.1 Unit tests
**CartContext (`apps/customer-app`)**
- `addItem` increments `pendingCount` synchronously and decrements in `finally` on **both**
  success and failure (mock `api.addToCart` resolve/reject).
- `flushPending()` resolves only after all in‑flight mutations settle; resolves immediately
  when none are pending.
- Rapid `addItem` ×N → `pendingCount` reaches N then returns to 0; serialization preserves
  call order.
- On `addToCart` rejection: toast shown, `refresh()` reverts optimistic `count`, `pendingCount`
  still returns to 0.

**CheckoutScreen**
- `handlePlaceOrder` does **not** call `api.placeOrder` until `flushPending()` resolves
  (assert call order with a deferred mock).
- `handlePlaceOrder` calls `reloadCart` before `placeOrder`.
- A generated `Idempotency-Key` is stable across retries of the *same* checkout attempt and
  changes for a new attempt.

**Backend (`apps/api`, vitest — mirror existing `orders` tests)**
- `placeOrder` with `expectedItemCount`/fingerprint mismatch → 409; match → success.
- `placeOrder` with a payload `cartId` ≠ live cart id → 409.
- `runIdempotent`: same key replays the first order; in‑flight second caller → 409 (already
  covered by `idempotency.ts`; extend for the order route).

### 7.2 Integration tests
- **Race (mocked latency):** stub `addToCart` to resolve after a delay; dispatch ADD then
  Place Order; assert the placed order contains **both** items and **no** new cart exists.
- **Double‑tap Place Order:** two near‑simultaneous taps → exactly **one** order (idempotency),
  no second Razorpay/COD order.
- **Multiple YMAL adds then Place Order:** all added items present in the order.
- **Stale cart (concurrent):** mutate the server cart out‑of‑band after preview → `placeOrder`
  → 409 → client refreshes + re‑previews (no silent loss).

### 7.3 Runtime verification plan (curl + DB, mirrors prior YMAL/billing runs)
Setup: dev API `:3000`, returning customer, single‑shop pinned cart (Maggi + YMAL Atta), an
address; lift the operating‑hours gate only for order placement, then revert (as before).

Prove each:
1. **Happy path still works** — baseline {Maggi}; add YMAL Atta (await commit); `GET /cart`
   count 2 / ₹300; preview ₹310; place order → `order_items = {Maggi, Atta}`.
2. **Race can no longer occur** — reproduce the old failure timing (fire `POST /cart/items` in
   background, immediately `POST /orders`). With the fix, the client path awaits the add;
   simulate by asserting that the order route, given an `expectedItemCount=2` while the live
   cart still has 1, returns **409** (not a silent 1‑item order). Then after the add lands,
   retry → order has both items.
3. **No duplicate cart items** — after add+order, `order_items` has exactly one row per
   product (no double‑add from optimistic + retry).
4. **No orphan carts** — after a placed order, `GET /cart` is empty and `carts` has **no**
   leftover row for the user with the "lost" item (the §4 `01b8a2d2` symptom is gone).
5. **Order always contains all user‑confirmed items** — for happy path, multiple‑adds, and
   the recovered‑409 case, assert `Σ order_items == cart items at confirm time`, and that the
   placed order's `cartId`/fingerprint matches what the client sent.

Pass criteria: (1) unchanged; (2) impossible to produce a short order silently (either the
item is present or the attempt 409s and recovers); (3)/(4) clean; (5) exact set equality.

---

## 8. Notes / explicitly deferred
- Pure **Option C** (refresh‑before‑order) is documented as **insufficient** and should not be
  shipped alone.
- The **server fingerprint** is the only mechanism that covers *cross‑device* concurrent cart
  edits; the client serialization covers the *single‑session* YMAL race (the reported bug).
- Idempotency requires a small change to `packages/api-client/src/index.ts:request` to pass a
  per‑call header; the backend side already exists and is tested.
