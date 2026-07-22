# CHECKOUT → "YOU MIGHT ALSO LIKE" — FORENSIC AUDIT

**Scope (as instructed):** ONLY the Checkout → "You Might Also Like" (YMAL) add flow,
traced from the rail's Add button through to backend order creation.
**Explicitly NOT in scope:** multi‑shop order splitting, tracking. (To keep the YMAL
item from triggering a split, the runtime used a **single‑shop** cart — see §2.)
**Status:** Investigation only. **No fixes proposed. No app code modified.**
**Runtime accommodation (disclosed):** order placement is gated to 9 AM–8 PM IST; the
test ran after hours, so `operating-hours.ts` was temporarily widened to place orders
and then **reverted** (`git diff` clean, server reloaded). Billing/cart logic untouched.

---

## 0. TL;DR

The YMAL Add button writes to the **shared server cart via CartContext**, not to the
Checkout screen's local state. The server side propagates the item **correctly and
fully**: `GET /cart`, `POST /pricing/preview`, and the created order all reflect a
YMAL‑added item (runtime §3, happy path). The reported symptoms are **client‑side
timing/visibility gaps**, not lost data on the server:

- **"Bill doesn't update"** → the Checkout bill reads a *local* `cart`/`pricing`
  snapshot that is re‑pulled only when a `cartCtxSubtotal` **watcher** fires; the
  watcher depends on `CartContext.subtotalPaise`, which updates **only after** the
  add's network round‑trip (count updates instantly, subtotal lags), and the pricing
  re‑fetch is best‑effort (`catch {}`), so the total can stay stale while items move.
- **"Item not in the final order"** → **reproduced** (runtime §4): the add is
  fire‑and‑forget/optimistic and **Place Order does not await it**, so if `POST /orders`
  is processed before the add's `POST /cart/items` commits, the order is built from the
  pre‑add Redis cart and the YMAL item is **absent** (it lands in a fresh cart instead).

The place‑order **payload never carries items** — the server rebuilds the order from the
Redis cart — so order correctness depends entirely on **what is in the server cart at the
instant `POST /orders` runs.**

---

## 1. Stage‑by‑stage trace (code)

```
YMAL Add Button (ProductCard, compact)
   onAdd() ─ hasVariants? → navigate to PDP (NO add)         ProductCard.tsx:90-93
           └ else: fly.trigger(...) + void addItem(product)  ProductCard.tsx:94-97  (productId only; no price/shop; fire-and-forget)
        ↓
CartContext.addItem()                                        CartContext.tsx:109-137
   1. OPTIMISTIC setQuantities(count+1)  ── instant          :113   → count updates immediately
   2. await api.addToCart{productId,quantity:1} (POST /cart/items) :129-130
   3. await refresh() → GET /cart → setSubtotal(cart.subtotal)     :131 → :100  (subtotalPaise updates ONLY here)
   (on error: toast + refresh() reverts to server truth)     :132-136
        ↓
CartContext value: count (instant)  /  subtotalPaise (post-refresh)   :66-69 / :100
        ↓
Checkout screen state                                        CheckoutScreen.tsx
   bill reads LOCAL cart/pricing snapshot:                   :355-357 (subtotal=cart.subtotal, total=pricing.total)
   sync to YMAL adds = watcher on cartCtxSubtotal:           :254-264
        if (!cart) return;                                   :256  (early if cart not loaded yet)
        first run adopts baseline, no reload;                :257-259
        on change → reloadCart(addressId)                    :263
   reloadCart: GET /cart (setCart) + preview (tolerate)      :235-245 (pricing in try/catch :243)
        ↓
Pricing Preview refresh  POST /pricing/preview               :197-201 (called at :243, best-effort)
        ↓
Place Order payload                                          handlePlaceOrder :286-322
   api.placeOrder{ cartId: cart.cartId, addressId, paymentMethod }  :291-293   ← NO items; does NOT await pending adds
        ↓
Backend Order Creation                                       orders.service.ts placeOrder
   reads Redis cart (:152-155) → builds order_items (:296-302) → deletes Redis cart (:319)
```

**Key structural facts**
- The YMAL rail is `fetchProducts({ limit: 6 })` → `GET /catalog/products?limit=6`
  (`CheckoutScreen.tsx:164-170`), rendered `<ProductCard size="compact">` (`:427`).
- `addItem` is **optimistic + asynchronous**: `count` (Σ `quantities`) changes the
  instant ADD is tapped (`CartContext.tsx:113`); `subtotalPaise` changes only inside
  `refresh()` after the POST (`:100`). The two are **not** updated together.
- The Checkout bill is driven by the screen's **own** `cart`/`pricing` state
  (`CheckoutScreen.tsx:355-357`), refreshed for YMAL adds **only** by the
  `cartCtxSubtotal` watcher (`:254-264`). The watcher's pricing re‑fetch is
  `try { … } catch { /* tolerate */ }` (`:243`).
- `handlePlaceOrder` sends **only** `{ cartId, addressId, paymentMethod }`
  (`:291-293`) and **does not await** any in‑flight add.

---

## 2. Runtime setup

- API `:3000` (dev), Postgres + Redis (docker). Customer `9499494949` (returning).
- **Single‑shop** cart to isolate YMAL propagation (no split): both the baseline and
  the YMAL item are **Chirawa Store**, both **pinned** (`master_id NULL`).
  - Baseline: **Maggi 2‑Minute Noodles** `3d54c553` — ₹15
  - YMAL item (real rail item): **Aashirvaad Select Atta** `cf9816ae` — ₹285
- The live YMAL rail (`GET /catalog/products?limit=6`) returned 6 concrete, **pinned**
  products across 6 shops — so the resolver "drop" path is **not** in play for these
  items (relevant to F).

---

## 3. Runtime verification — HAPPY PATH (add commits before Place Order)

| # | Step | Evidence |
|---|---|---|
| 1 | **Cart BEFORE Add** (`GET /cart`) | cart `ddb36fc9`, **count 1**, **subtotal ₹15** {Maggi} |
| 2 | **Add 1 from YMAL** (`POST /cart/items`) | body `{productId: cf9816ae, quantity:1}` (**productId only**) → **HTTP 200** |
| 3 | **CartContext item count** (GET /cart = the mirror `refresh()` reads) | **count 2** |
| 4 | **Checkout subtotal** (`cart.subtotal`) | **₹300 (30000)** {Maggi ₹15 + Atta ₹285} |
| 5 | **Pricing preview** (`POST /pricing/preview`) | cartSubtotal 30000, fee 1000, **total ₹310 (31000)**, shopCount 1 |
| 6 | **Place‑order payload** (`POST /orders`) | `{cartId: ddb36fc9, addressId, paymentMethod: cod}` — **no item list** |
| 7 | **Backend order items** (DB) | order `54289968` → **Maggi + Aashirvaad Atta**, order_total **31000 (₹310)** |

**Stage comparison (happy path)**

| Stage | Reflects the YMAL item? | Value |
|---|:---:|---|
| Cart before | n/a | ₹15 / 1 item |
| CartContext count | ✅ | 2 |
| Checkout subtotal (cart.subtotal) | ✅ | ₹300 |
| Pricing preview total | ✅ | ₹310 |
| Place‑order payload | — (carries no items) | `{cartId,addressId,paymentMethod}` |
| Backend order items | ✅ | Maggi + Atta = ₹310 |

→ When the add commits before Place Order, the item propagates through **every**
server stage and into the order.

---

## 4. Runtime verification — DISAPPEAR CASE (Place Order wins the race)

Reproduces "newly added item not reflected in final order." The add is fire‑and‑forget
and Place Order doesn't await it, so `POST /orders` can run while the add is in flight.

| Step | Action | Evidence |
|---|---|---|
| 1 | Baseline cart {Maggi} | cart `95add219`, subtotal ₹15 |
| 2 | User taps **ADD** on YMAL Atta (optimistic count→2), then taps **Place Order** | — |
| 3 | **`POST /orders` processed first** (server reads Redis = {Maggi}) | order `3850cbac`, total **₹40** {Maggi ₹15 + ₹25 fee}, droppedLines: null |
| 4 | The in‑flight **add `POST /cart/items` now lands** | HTTP 200 |
| 5 | **Order items (DB)** | order `3850cbac` → **Maggi only** — Atta **absent** |
| 6 | **`GET /cart` after** | **new cart `01b8a2d2` = {Aashirvaad Atta}** |

The cart the order consumed (`95add219`) was deleted by `placeOrder`; the YMAL item the
user "added" landed in a **brand‑new cart** (`01b8a2d2`) and **never entered the order**.
The customer saw the optimistic count bump + fly‑to‑cart animation, but the order shipped
without the item.

---

## 5. Answers

**A. Does CartContext update?**
**Yes, but asymmetrically.** `count` updates **instantly** (optimistic,
`CartContext.tsx:113`); `subtotalPaise` updates **only after** the `POST /cart/items`
round‑trip via `refresh()` (`:100`,`:131`). Runtime: after the add, the GET /cart mirror
read **count 2 / subtotal ₹300**. If the POST fails, `refresh()` reverts both to server
truth and a toast shows (`:132-136`).

**B. Does Checkout UI update?**
**Indirectly and conditionally.** The bill renders the screen's local `cart`/`pricing`
(`CheckoutScreen.tsx:355-357`); a YMAL add reaches it only when the `cartCtxSubtotal`
watcher fires `reloadCart` (`:254-264`). That depends on `subtotalPaise` actually
changing (i.e. after the add's refresh), and the watcher early‑returns if `cart` hasn't
loaded (`:256`) or on its baseline‑adopt first run (`:257-259`). Because `reloadCart`'s
pricing re‑fetch is best‑effort (`catch {}`, `:243`), a failed preview leaves
`cart.subtotal` advanced while `pricing.total` stays stale → **Items total moves but
Grand total doesn't** ("bill doesn't update correctly"). The data needed (₹300 / ₹310)
was available at runtime; surfacing it depends on these client conditions.

**C. Does Pricing Preview update?**
**Yes when it is called and succeeds** — runtime total **₹310** matched the new cart.
But every preview call on this screen is wrapped in `try { … } catch { /* tolerate */ }`
(`CheckoutScreen.tsx:206`,`:219`,`:243`); a thrown/failed preview is swallowed and the
old `pricing` is kept.

**D. Does Place Order payload include the item?**
**No — the payload never includes items.** It is `{ cartId, addressId, paymentMethod }`
(`CheckoutScreen.tsx:291-293`; runtime §3 step 6). The server rebuilds the order from the
Redis cart, so payload‑level inclusion is N/A; correctness depends on the **server cart
at `POST /orders` time**.

**E. Does Backend Order include the item?**
**Yes — when the add committed to the server cart before `POST /orders`.** Runtime happy
path: order `54289968` contained **both** Maggi and the YMAL Atta (₹310).

**F. Can an item added from YMAL disappear before order creation?**
**Yes — reproduced (§4).** When `POST /orders` is processed before the in‑flight add's
`POST /cart/items` commits, the order is built from the pre‑add Redis cart and the YMAL
item is **absent** (order `3850cbac` = Maggi only; the Atta landed in new cart
`01b8a2d2`). Cause: `addItem` is optimistic/fire‑and‑forget (`ProductCard.tsx:97`,
`CartContext.tsx:113`) and `handlePlaceOrder` **does not await** it (`CheckoutScreen.tsx:
286-293`). A second route to the same outcome: a **silently‑failed add POST** (toast +
revert, `CartContext.tsx:132-136`) never reaches the server cart. The resolver‑"drop"
path is **not** a factor here — all sampled YMAL items are pinned (`master_id NULL`).

---

## Appendix — evidence index
- YMAL rail source + render: `apps/customer-app/src/screens/orders/CheckoutScreen.tsx:164-170,423-430`
- Add button: `apps/customer-app/src/components/product/ProductCard.tsx:57,88-98,255`
- Optimistic add + refresh: `apps/customer-app/src/context/CartContext.tsx:66-69,86-107,109-137`
- Bill values + watcher + reloadCart + place order: `CheckoutScreen.tsx:254-264,235-245,286-322,355-357`
- YMAL fetch/mapping: `apps/customer-app/src/services/catalog.ts:73,131-144`
- Payload shape (no items): `apps/api/src/modules/orders/orders.schema.ts` (placeOrderSchema)
- Order built from Redis cart, cart deleted after: `apps/api/src/modules/orders/orders.service.ts:152-155,296-302,319`
- Runtime artifacts: happy path order `54289968` (Maggi+Atta, ₹310); race order `3850cbac` (Maggi only, ₹40) + new cart `01b8a2d2` {Atta}
