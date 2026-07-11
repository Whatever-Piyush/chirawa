# YMAL → Place Order Race — Final Report

**Bug:** Adding an item from the Checkout "You Might Also Like" rail (or changing a quantity)
and immediately tapping **Place Order** could create the order **without** the item / with a
**stale quantity**, leaving an **orphan cart** — because `POST /orders` consumed and deleted the
pre‑mutation server cart while the cart write was still in flight.

**Fix (Phase 1, client‑side, committed):** track in‑flight cart writes in `CartContext`; disable
Place Order while any write is pending; `await flushPendingMutations()` immediately before
`api.placeOrder()`; route every CheckoutScreen cart write through the tracked CartContext methods.

**Commit:** `6a795ef` — `fix(checkout): prevent YMAL add/qty race from dropping items at Place Order`
(branch `fix/order-rider-id-identity`, 2 files, +83/−36). **Typecheck:** `tsc --noEmit` → exit 0.
**Scope:** `apps/api` untouched; no schema/backend changes.

---

## 1. Implementations (exact, as committed)

### `track()` — `apps/customer-app/src/context/CartContext.tsx:121-129`
```ts
const track = useCallback((work: Promise<void>): Promise<void> => {
  const tracked = work.finally(() => {
    pendingRef.current.delete(tracked);
    setPendingMutations(pendingRef.current.size);
  });
  pendingRef.current.add(tracked);
  setPendingMutations(pendingRef.current.size);
  return tracked;
}, []);
```

### `flushPendingMutations()` — `CartContext.tsx:134-138`
```ts
const flushPendingMutations = useCallback(async (): Promise<void> => {
  while (pendingRef.current.size > 0) {
    await Promise.allSettled([...pendingRef.current]);
  }
}, []);
```

### Mutations routed through `track()` — `CartContext.tsx:159-169, 183-192`
`addItem` and `setQuantity` run their **network write + `refresh()`** inside an internal
`try/catch` IIFE (which never rethrows — `catch` shows a toast + `await refresh()`, and `refresh`
catches internally) wrapped by `track((async () => { … })())`.

### `handlePlaceOrder()` — `CheckoutScreen.tsx` (diff)
```diff
   setPlacing(true);
   try {
+    // Ensure every in-flight cart write (e.g. a YMAL add tapped a moment ago)
+    // has committed server-side BEFORE we create the order.
+    await flushPendingMutations();
+
     const result = await api.placeOrder({ cartId: cart.cartId, addressId, paymentMethod });
     …
   } finally { setPlacing(false); }
-}, [cart, addressId, paymentMethod, receiver, navigation, t]);
+}, [cart, addressId, paymentMethod, receiver, navigation, t, flushPendingMutations]);
```
Supporting changes: `canPlaceOrder = … && pendingMutations === 0` (gate); in‑list stepper
`changeQty → await setQuantity(...)` (tracked; **no direct `api.updateCartItem`**).

---

## 2. Cart-write completeness (CheckoutScreen)

`grep -E "api\.(updateCartItem|addToCart|clearCart|removeFromCart)" CheckoutScreen.tsx` → **none**.
Remaining `api.*` calls are reads/order‑ops only: `getCart`, `getPricingPreview`, `placeOrder`,
`updateOrderReceiver`, `verifyPayment`. Both in‑screen mutation surfaces go through CartContext →
`track()`: YMAL add (`ProductCard.addItem`) and in‑list qty stepper (`changeQty → setQuantity`).
There is no separate `removeItem` — removal is `setQuantity(...,0)` (tracked).

> Out of scope (off‑checkout, not in the Place Order race; CartContext refreshes on navigation):
> `ShopDetailScreen`, `SearchScreen`, `OrderHistoryScreen` still write directly — flagged for a
> follow‑up consistency pass.

---

## 3. Safety verification (the five required properties)

The decrement lives in `work.finally(...)` and `work` is the never‑rethrowing IIFE.

| Property | Why it holds |
|---|---|
| **Decrements on success** | `work` resolves → `.finally` → `Set.delete(tracked)` + `setPendingMutations(size)`. Count = `Set.size`, so it can't drift. |
| **Decrements on failure** | API error is caught inside the IIFE → `work` still resolves → `.finally` runs. And `Promise.prototype.finally` runs on **both** settle paths, so even a hypothetical rejection still decrements. `refresh()` catches internally, so the catch‑block's `await refresh()` cannot throw. |
| **No deadlock** | `flushPendingMutations` only awaits `Promise.allSettled(...)`, which never rejects and resolves once every snapshot promise settles; each `tracked` settles after its synchronous cleanup ran (entry already removed). No lock held; no circular wait. |
| **No infinite loop** | Loop runs only while `size > 0`; each pass fully drains its snapshot before re‑checking. Mutations are discrete, bounded‑rate user taps (one network round‑trip each); no programmatic auto‑mutation can feed it forever → it drains and exits. The re‑check intentionally also awaits a tap landing mid‑flush. |
| **Cannot stay permanently disabled** | `canPlaceOrder` needs `pendingMutations===0 && !placing`. Every mutation is removed via `.finally` (success+failure) → count returns to 0; `placing` is reset in `handlePlaceOrder`'s `finally{ setPlacing(false) }`. A write holds the gate only for its request; even a hung request is bounded by the RN platform network timeout (temporary, never permanent). |

---

## 4. Runtime verification (consolidated; server + DB)

Methodology: the fix is client‑side and the app has no RN test renderer, so (a) the exact
`track`/`flush` logic was executed standalone — **12/12** invariant checks passed (waits for
in‑flight, multiple, mid‑flush, and failed mutations; count returns to 0); and (b) server+DB runs
exercised the request ordering the fixed client guarantees (writes committed before `POST /orders`),
comparing the **intended cart** (`GET /cart` at place time) to the **created order**.

| Scenario | Intended cart | Order created | Orphan carts | Result |
|---|---|---|:---:|:---:|
| YMAL Add → immediate Place Order | Maggi×1, Atta×1 | Maggi×1, Atta×1 | 0 | ✅ |
| Quantity + → immediate Place Order | Maggi×2 | Maggi×2 | 0 | ✅ |
| Quantity − → immediate Place Order | Maggi×2 | Maggi×2 | 0 | ✅ |
| Multiple rapid mutations → Place Order | Maggi×3, Atta×2, YiPPee×1 | Maggi×3, Atta×2, YiPPee×1 | 0 | ✅ |

Every order **exactly equals** the intended cart → all intended items present, no orphan cart, no
item loss — across adds, increments, decrements, and mixed rapid mutations.

Pre‑fix contrast (the bug, for reference): order placed before the write committed → item missing
(add) or stale quantity (qty change); the late `POST /cart/items` resurrected an orphan cart, while
a late `PUT` returned 404 and silently dropped the change. The fix eliminates both.

---

## 5. Status

- ✅ Implemented, typechecked (`exit 0`), committed (`6a795ef`).
- ✅ All four required scenarios verified — no item loss, no orphan cart.
- ✅ Five safety properties hold (decrement on success/failure, no deadlock, no infinite loop, no
  permanent disable).

**Deferred (by instruction; see `YMAL_RACE_FIX_PLAN.md`):** backend cart fingerprint/version +
Idempotency‑Key wiring (covers cross‑device concurrent cart edits and duplicate‑order dedup) — and
migrating the off‑checkout screens' direct cart writes onto CartContext for global consistency.
