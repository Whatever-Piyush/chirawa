# BILLING / ORDER‑TOTAL MISMATCH — FORENSIC AUDIT

**Scope (as instructed):** Cart, CartContext, add‑to‑cart, checkout, pricing preview, place order, payment creation, order creation, seller order view, refund calc.
**Explicitly NOT investigated:** tracking, ETA, rider flows, delivery flows (touched only where they read an order total).
**Status:** Investigation only. **No code was modified. No fix applied.**
**Runtime evidence:** `apps/api` unit tests for pricing + checkout resolver were executed (21 passed) — see §9.

---

## 0. TL;DR — the headline finding

The cart is **multi‑shop**. The cart pill and the checkout bill always show the **whole‑cart subtotal** (sum across *all* shops). At *Place Order*, the backend **splits the cart into one child order per shop**. Each seller’s app only ever loads **their own shop’s child order**, so it shows **that shop’s slice**, not the cart total.

> Cart shows **₹160** (Shop A ₹60 + Shop B ₹100) → checkout splits → **Seller A sees ₹60**, Seller B sees ₹100.
> This is *exactly* the reported symptom (“cart ~₹160, shop confirms ~₹60”).

**Why “You Might Also Like” triggers it (Path B):** that rail is populated by `fetchProducts({ limit: 6 })` → `GET /catalog/products`, which returns products from **all active shops with no shop filter** (`catalog.service.ts:552`). Adding one therefore very commonly drops a **second shop** into a cart that was single‑shop a moment earlier → the split fires. The Home page’s primary add surfaces use the **aggregated “one store” feed** whose lines are *fungible* and get merged onto the fewest shops by the checkout resolver, so they tend to stay single‑shop → “usually works.”

- It is **not** purely a display bug: the split is real rows in the DB (§4, §6).
- It is **not** a bad Place‑Order payload: the payload carries **no totals** — the server recomputes everything from the Redis cart (§3, Q2).
- The customer **is** charged the correct grand total for online payment (one Razorpay order for the sum). The divergence is in **how the total is partitioned and who sees what** (§5, Q5).
- There are **four secondary** real divergences (dropped items not surfaced, preview‑vs‑charged promo asymmetry, aggregated re‑pricing, optimistic double‑add) documented in §7.

---

## 1. Source‑of‑truth & state‑owner map

| Stage | Source of truth | State owner | Persistence | Notes |
|---|---|---|---|---|
| Server cart | **Redis** `cart:{userId}` | `cart.service.ts` | Redis (24 h TTL) + DB `Cart` row (recovery only) | `unitPrice`, `subtotal` stored **per line**; cart‑level `subtotal` = Σ line subtotals (`cart.service.ts:75`,`:216`). Multi‑shop allowed (`cart.service.ts:177‑178`). |
| Client cart mirror | Redis (mirrored) | `CartContext.tsx` | in‑memory, optimistic | `quantities` map + `subtotalPaise`; updated from `GET /cart` on `refresh()` (`CartContext.tsx:86‑107`). Optimistic add updates `quantities` **but not** `subtotalPaise` until refresh (`:109‑137`). |
| Cart pill total | Redis (via mirror) | `CartDockPill.tsx` | derived | `rupees = round(subtotalPaise/100)` — **whole cart** (`CartDockPill.tsx:100`); taps → `Checkout` (`:111`). |
| Checkout bill | Redis (snapshot) | `CheckoutScreen.tsx` local `cart` | in‑memory snapshot | `subtotalRupees = cart.subtotal` (`CheckoutScreen.tsx:355`). |
| Checkout total | `POST /pricing/preview` | `CheckoutScreen.tsx` local `pricing` | in‑memory snapshot | `totalRupees = pricing.total` (`:357`); preview total = `cart.subtotal + fee − discount` (`pricing.routes.ts:93`). |
| Order(s) | **Redis cart at place time** | `orders.service.ts` `placeOrder` | Postgres `Order` + `OrderItem` | **Split per shop** (`orders.service.ts:195‑317`). Client totals are never read. |
| Payment | order totals | `payments.service.ts` | Postgres `Payment` + Razorpay | One Razorpay order for **grand total**, one `Payment` row per child order (`createCartPaymentOrder`, `payments.service.ts:42‑68`). |
| Seller view | Postgres | `OrderQueueScreen.tsx` | — | Loads `GET /orders` → `getMyOrders` `where:{shopId}` (`orders.service.ts:434‑439`) → shows **per‑child** `totalAmount` (`OrderQueueScreen.tsx:267‑269`,`:309`). |

There is **no separate Cart screen** — the cart UI is the dock pill → Checkout. `useCart()` consumers: `CartDockPill`, `CheckoutScreen`, `ProductCard`, `PopularProductsSection`, `ProductDetailScreen`.

---

## 2. PATH A — Home page add → order

```
Home shelf (ProductCard) ── addItem(product) ──▶ CartContext (optimistic) ──▶ POST /cart/items
        │                                                                          │
        │   DailyEssentials / ForYou = AGGREGATED feed (fetchFeed/                  ▼
        │   fetchDailyEssentials → toFeedCard); line stored aggregated:true   Redis cart:{userId}
        │   PopularProducts / Carousel = fetchProducts (CONCRETE, cross-shop)       │
        ▼                                                                          ▼
   CartDockPill shows Σ subtotal (whole cart) ──tap──▶ CheckoutScreen ──▶ POST /pricing/preview (whole-cart total)
                                                                  │
                                                                  ▼
                                              POST /orders {cartId, addressId, paymentMethod}
                                                                  │  placeOrder: resolve aggregated → group by shop → SPLIT
                                                                  ▼
                                              N child Orders (1 per shop) ──▶ Seller sees their child only
```

**Why Path A “usually works”:** the canonical Home add surfaces (`DailyEssentialsShelf`, `ForYou`) use the **aggregated feed** (`catalog.ts:168‑193`). Aggregated cart lines are *fungible* and the checkout resolver routes them through the **fewest shops** (`resolver.service.ts:69‑135`; test “routes lines through the FEWEST shops”). They frequently collapse onto **one** shop → one order → seller total (+fee/discount) equals the checkout total.
**Caveat (important):** `PopularProductsSection.tsx:16` and `ProductCarouselSection.tsx:37` on Home **also** use `fetchProducts` (concrete, cross‑shop). So Home *can* create a multi‑shop cart too. The real trigger is **cross‑shop adds**, not the screen — Path A is merely *less likely* to do it.

## 3. PATH B — Checkout “You Might Also Like” add → order

```
CheckoutScreen "You might also like" rail
   alsoLike = fetchProducts({ limit: 6 })  ── GET /catalog/products (NO shop filter, all shops) ──┐
   rendered as <ProductCard size="compact">                                                       │
        │ onAdd → addItem(product)  (productId only; server resolves the shop)                     │
        ▼                                                                                          ▼
   CartContext.addItem (optimistic quantities) ──▶ POST /cart/items ──▶ Redis cart (now MULTI-SHOP)
        │ refresh() sets subtotalPaise (₹160)                                                      │
        ▼                                                                                          │
   CheckoutScreen effect watches cartCtxSubtotal change ──▶ reloadCart(addressId):                 │
        GET /cart  (cart.subtotal = ₹160)  +  POST /pricing/preview (total = ₹160 + fee)           │
        ▼                                                                                          │
   Bill shows ₹160  ── Place Order ──▶ POST /orders ──▶ placeOrder SPLITS by shop ◀────────────────┘
        ▼
   Seller A child order = ₹60     (Seller's OrderQueue shows ₹60)
   Seller B child order = ₹100
   Customer navigated to OrderPlaced(result.orderId = PRIMARY/fee-carrier child) → tracks one slice
```

**Key code points for Path B**
- Rail source: `CheckoutScreen.tsx:162‑170` (`fetchProducts({ limit: 6 })`), rendered `:423‑430`.
- `GET /catalog/products` has **no shop scoping** (`catalog.service.ts:552‑586`): `where:{ isActive, stockStatus≠hidden, shop:{isActive} }`, `orderBy:[sortOrder, name]`, `take:limit`. Returns the global first‑N across shops.
- `ProductCard` adds with **productId only** — no shop, no price (`ProductCard.tsx:88‑98`; qty keyed by `quantities[product.productId]` `:57`). Server derives shop + price.
- Bill stays in sync via the `cartCtxSubtotal` watcher (`CheckoutScreen.tsx:247‑264`). It correctly shows the **whole** (multi‑shop) cart. The split only happens later, server‑side, at Place Order.

---

## 4. Place Order — exactly how the split is computed

`placeOrder` (`orders.service.ts:142‑354`):

1. Load Redis cart (`:152‑155`). **Client‑sent totals are never used** — only `cartId/addressId/paymentMethod` arrive in the payload (`order.dto.ts:6‑12`).
2. Resolve **aggregated** (fungible) lines → concrete (shop, product, price); **drop** lines nobody can stock (`:161‑191`, resolver `resolver.service.ts`).
3. `orderSubtotal = Σ resolved line subtotals` (`:192`).
4. `shopIds = distinct shop of each line` (`:195`).
5. **One `ShopPlan` per shop** with that shop’s `items` + `subtotal` (`:204‑220`).
6. `combinedFee = calculateDeliveryFee(orderSubtotal, hasSpecialShop)` — one fee for the whole cart (`:226‑231`), carried by a **single** order (Special shop if any, else first) (`:232‑233`).
7. Promo/`FIRSTORDER` resolved on `orderSubtotal`, lands on the fee‑carrier order (`:241‑263`).
8. In a transaction: create an `OrderGroup` if >1 shop (`:271‑273`); for each plan create an `Order` with **`totalAmount = p.subtotal + fee − discount`** (fee/discount are 0 for non‑carriers) (`:275‑295`); create `OrderItem`s from `p.items` (`:296‑302`).
9. Return `orderId` (= fee‑carrier/primary), `orderIds[]`, `groupId`, `totalAmount = grandTotal = Σ child totals` (`:339‑353`).

**Therefore:**
- Single‑shop cart → 1 order, `totalAmount = cartSubtotal + fee − discount` → **matches** checkout. *(This is the “sometimes correct” case.)*
- Multi‑shop cart → N orders; each seller sees their slice; Σ = grand total. *(This is the “sometimes not” case.)*

---

## 5. Payment — who pays what

- **Online (UPI):** `POST /orders` (non‑COD) calls `paymentsService.createCartPaymentOrder(order.orderIds, …)` (`orders.routes.ts:30‑35`), which charges **one Razorpay order for the grand total** and writes **one `Payment` row per child order** sharing the `razorpayOrderId` (`payments.service.ts:42‑68`). Verify/webhook settle **every** linked order (`:71‑101`,`:120‑126`). → Customer pays the full ₹160 once; each seller still sees only their slice.
- **COD:** child orders are created `confirmed` (`orders.service.ts:266`). A multi‑shop COD cart becomes **N independent COD orders**, each with its own cash total (rider collection is out of scope here, but note: there is no single combined COD total presented to one seller).
- **Latent risk (not currently active):** `createPaymentOrder(orderId)` (single order) charges only **that order’s** `order.totalAmount` (`payments.service.ts:15‑34`) and is exposed at `POST /payments/orders/:orderId` (`payments.routes.ts:22‑35`). If any client calls **that** endpoint with the primary `orderId` for a multi‑shop cart, it would **undercharge** (only the primary shop). The checkout flow currently uses the cart endpoint via `POST /orders`, so this is dormant — but the single‑order endpoint is still reachable and is the historical bug noted in the code comment at `orders.routes.ts:31‑33`.

---

## 6. Seller order view — what the seller actually receives

- Seller list: `GET /orders` → `getMyOrders` with `where:{ shopId: sellerProfile.shop.id }` (`orders.service.ts:434‑447`). **Only the seller’s own child order(s).**
- Push/socket `order:new` payload is per child order with that order’s `totalAmount` (`orders.service.ts:325‑329`; on paid path `payments.service.ts:332‑339`).
- UI renders the **child** `totalAmount`: queue card `OrderQueueScreen.tsx:267‑269`, new‑order modal `:309`.
- The child `totalAmount` **includes the delivery fee/discount only on the fee‑carrier order** — a secondary seller‑confusion: a non‑carrier seller sees pure goods subtotal; the carrier sees goods + whole delivery fee − whole discount.

**Customer post‑order view:** `handlePlaceOrder` navigates with `result.orderId` (the **primary/fee‑carrier** child) → `OrderPlaced` → `OrderTracking` (`CheckoutScreen.tsx:302`,`:337`; `OrderPlacedScreen.tsx:30`). So even the **customer’s** immediate tracking screen shows **one slice**, not the ₹160 grand total. A combined view exists (`getOrderGroup`, `orders.service.ts:460‑485`) but the post‑checkout navigation does **not** route to it. This strongly amplifies the “my money disappeared” perception.

---

## 7. The seven questions — answered with evidence

**Q1. Is this only a UI display bug?**
**No.** The split produces real, separate `Order` rows with partitioned `totalAmount`s (`orders.service.ts:281‑295`). The seller genuinely has a smaller order; the customer is genuinely charged the grand total elsewhere. (There *are* additional pure‑display divergences — see Q3/§7 secondary — but the headline ₹160/₹60 is a real data partition, not a render glitch.)

**Q2. Is the Place Order payload incorrect?**
**No.** `PlaceOrderRequest = { cartId, addressId, paymentMethod, promoCode?, useWalletCredit? }` (`order.dto.ts:6‑12`) — it carries **no item list and no totals**. The server reads the Redis cart and recomputes everything (`orders.service.ts:152‑317`). The client cannot send a wrong total, and equally **cannot influence/observe the split** through the payload.

**Q3. Is the backend recalculating totals incorrectly?**
**Arithmetic is correct**, but there are **two real correctness gaps**:
- (a) **Multi‑shop partition** (the headline) — math sums correctly, but it slices the cart across orders.
- (b) **Preview ≠ charged promo asymmetry:** `pricing.routes.ts:65` applies promo / auto‑`FIRSTORDER` **only when `shopIds.length === 1`**, whereas `placeOrder` applies it for **any** shop count (`orders.service.ts:241‑263`, no shop‑count guard). So a multi‑shop preview shows **full fee / no discount**, but the order is **charged with the discount** → preview total ≠ charged total (customer‑favorable, but a divergence the bill misrepresents).
- (c) **Aggregated re‑pricing:** aggregated lines are re‑priced at checkout to the current cheapest in‑stock shop (`orders.service.ts:184`; resolver `unitPrice` in assignment) — the order subtotal can differ from the (possibly stale) `cart.subtotal` that the pill/bill displayed.

**Q4. Is the seller receiving incorrect order totals?**
The seller receives a **correct total for their own shop’s slice**, which is **not** the cart total the customer saw. Evidence: `getMyOrders where:{shopId}` (`orders.service.ts:439`) + per‑child `totalAmount` render (`OrderQueueScreen.tsx:267`). For a single‑shop cart the seller total equals the checkout total; for multi‑shop it is a fraction. Secondary: only the fee‑carrier seller’s total includes the delivery fee/discount.

**Q5. Can the customer be charged a different amount than the shop sees?**
**Yes — structurally, for multi‑shop carts.** Online: customer pays **grand total** (`createCartPaymentOrder`, `payments.service.ts:42‑68`) while each seller sees only their child total. The sum reconciles, but no single shop sees the customer’s charge. Additionally the preview/promo asymmetry (Q3b) can make the **charged** amount differ from the **previewed** amount.

**Q6. Can items be lost between cart and order creation?**
**Yes, in one specific path.** Aggregated lines the resolver can’t source (out of stock everywhere / insufficient qty) are **dropped** (`orders.service.ts:178‑191`; resolver test “drops a line nobody has in stock”, “drops a line when no candidate can cover the requested quantity”). `placeOrder` returns them as `droppedLines` (`:347‑349`) **but `handlePlaceOrder` ignores `result.droppedLines` entirely** (`CheckoutScreen.tsx:286‑322`) — the customer is taken to the success screen with no warning that items were removed, so the order is smaller than the cart they confirmed. Pinned/concrete lines are **not** silently lost (each becomes an order).

**Q7. Are there multiple cart states that can diverge?**
**Yes — five:**
1. **Redis cart** `cart:{userId}` — the truth (`cart.service.ts`).
2. **DB `Cart` row** — recovery fallback; only `shopId`/`expiresAt` synced, **not items** (`cart.service.ts:94‑107`).
3. **`CartContext`** `quantities`/`subtotalPaise` — optimistic mirror; `count` updates instantly while `subtotalPaise` lags until `refresh()` (`CartContext.tsx:109‑137`).
4. **`CheckoutScreen.cart`** — a `GET /cart` snapshot.
5. **`CheckoutScreen.pricing`** — a `POST /pricing/preview` snapshot.

Divergence windows:
- In‑list steppers (`changeQty`) update #4/#5 but **not** #3 (CartContext) — acknowledged in the code comment (`CheckoutScreen.tsx:247‑253`). The “also like” rail updates #3 but not #4/#5 until the watcher fires.
- `pricing` refetches are wrapped in `catch { /* tolerate */ }` (`CheckoutScreen.tsx:206`,`:219`,`:243`); if a refetch throws, `cart.subtotal` (#4) can advance while `pricing.total` (#5) stays **stale**, so the “Items total” and “Grand total” lines reflect different cart states.

---

## 8. Desynchronization points (consolidated)

| # | Where | Mechanism | Direction of error | Severity |
|---|---|---|---|---|
| D1 | Cart → Orders | **Multi‑shop split**; pill/bill show Σ, seller sees slice | Seller < cart | **Critical (headline)** |
| D2 | Checkout rail | `fetchProducts` is cross‑shop, **not** scoped to cart’s shop → injects 2nd shop | causes D1 | **Critical (trigger)** |
| D3 | Place Order → client | `droppedLines` ignored by `handlePlaceOrder` | Order < cart, silent | High |
| D4 | Preview vs Order | promo applied for 1 shop in preview, all shops in order | Charged ≠ previewed | High |
| D5 | Cart → Order | aggregated lines re‑priced at checkout | Charged ≠ displayed | Medium |
| D6 | Post‑order nav | customer routed to **primary child only**, not group | Customer sees slice | Medium (perception) |
| D7 | Payment endpoints | single‑order `POST /payments/orders/:id` would undercharge multi‑shop | Customer < total | Medium (latent) |
| D8 | CartContext optimistic | rapid double‑tap ADD can double‑add (both cart **and** order inflate equally) | Cart = order, but > intended | Low (not the reported bug) |

> **Note on D8:** the optimistic path inflates the *server* cart and therefore the order **equally**, so cart and seller still agree — it is a cart‑correctness hazard, **not** the cart≠seller divergence being reported. Listed for completeness.

---

## 9. Runtime verification performed

Executed in `apps/api`:

```
npx vitest run src/modules/pricing/__tests__/pricing.service.test.ts \
               src/modules/orders/__tests__/resolver.service.test.ts
→ Test Files 2 passed (2) | Tests 21 passed (21)
```

Confirms (live):
- **Flat fee bands** — `<₹100 → ₹25`, `≥₹100 → ₹10` (regular) / `₹15` (Special) (`pricing.service.test.ts`). Fee is computed on the **whole‑cart** subtotal both in preview (`pricing.routes.ts:53‑57`) and at order time (`orders.service.ts:227`).
- **Resolver routes through the fewest shops** and **re‑prices** each line to the chosen shop (`assignments` carry `unitPrice`), and **drops** lines nobody can stock — directly supporting Q6 and D5 (`resolver.service.test.ts`).

**Not verifiable from this session (no live DB/Redis):** an end‑to‑end multi‑shop reproduction. See §10 for an exact repro.

---

## 10. Suggested runtime reproduction (for confirmation before any fix)

1. Seed/identify **two active shops** A and B with priced products.
2. As a customer, add a product from **Shop A** (cart pill shows ₹A).
3. Open **Checkout**; in **“You might also like,”** add a product that belongs to **Shop B** (the rail is global, so it will surface cross‑shop items).
4. Observe the **bill** shows `₹A + ₹B` (whole cart).
5. Place order (COD is simplest).
6. Inspect: `GET /orders/group/:groupId` returns combined `₹A+₹B` over **two** child orders; each **seller app** shows only its child (`₹A` and `₹B`). → reproduces “cart ₹160 / shop ₹60.”
7. Variant for **Q6**: add an **aggregated** item, then take it out of stock at every shop before step 5 → `droppedLines` is returned but the customer is not told and the order is smaller than the cart.

Inspection without the apps:
```
redis-cli GET cart:<userId>          # whole multi-shop cart (the ₹160)
# DB:
SELECT id, "shopId", "cartSubtotalAtPricing", "deliveryFee", discount, "totalAmount", "groupId"
FROM "Order" WHERE "groupId" = '<groupId>';   # the per-shop slices (the ₹60 / ₹100)
```

---

## 11. Fix options (NOT implemented — for discussion only)

These are *candidate directions*, deliberately not applied:

- **A. Make the split explicit in the UI (smallest, safest).** Show per‑shop subtotals on the checkout bill and on the post‑order screen; route post‑checkout to `getOrderGroup` (D6) so the customer sees the combined ₹160 and its breakdown. Addresses the *trust* symptom without changing money flow.
- **B. Scope “You might also like” to the cart’s shop(s)** (D2) — pass `shopId` to the rail’s `fetchProducts`, or use the aggregated feed there, so adding from checkout doesn’t silently create a multi‑shop cart.
- **C. Surface `droppedLines`** in `handlePlaceOrder` (D3) — block/confirm when items were removed.
- **D. Align preview & order promo logic** (D4) — apply the same promo rule (group‑level) in `pricing.routes.ts` as in `placeOrder`, so the previewed total equals the charged total.
- **E. Decide the product question:** *should* a single cart be allowed to span shops at all for launch? If not, gate `cart.addItem` to one shop (revert `cart.service.ts:177‑178`) — this removes D1/D2/D6/D7 at the root. This is a **product decision**, not just an engineering one.

> Recommend confirming the §10 reproduction and deciding **E** (single‑ vs multi‑shop carts) before writing any code, since A–D differ depending on that answer.

---

### Appendix — primary evidence index
- Cart truth & multi‑shop: `apps/api/src/modules/cart/cart.service.ts:75,177‑178,189‑236`
- Pricing preview (whole‑cart total, single‑shop promo): `apps/api/src/modules/pricing/pricing.routes.ts:44,53‑96`
- Order split & per‑shop totals: `apps/api/src/modules/orders/orders.service.ts:142‑354`
- Checkout resolver (re‑price / drop): `apps/api/src/modules/orders/resolver.service.ts:69‑184`
- Payment (grand total vs single order): `apps/api/src/modules/payments/payments.service.ts:15‑68`; route `apps/api/src/modules/orders/orders.routes.ts:30‑35`
- Cross‑shop products feed: `apps/api/src/modules/catalog/catalog.service.ts:552‑586`
- Checkout screen (bill, sync, place order, dropped‑lines ignored): `apps/customer-app/src/screens/orders/CheckoutScreen.tsx:134,162‑170,247‑264,286‑322,355‑357`
- Add‑to‑cart card: `apps/customer-app/src/components/product/ProductCard.tsx:57,88‑100`
- Cart mirror: `apps/customer-app/src/context/CartContext.tsx:86‑137`; pill `apps/customer-app/src/components/CartDockPill.tsx:100,111`
- Seller view: `apps/seller-app/src/screens/orders/OrderQueueScreen.tsx:267‑269,309`; `apps/api/src/modules/orders/orders.service.ts:434‑447`
- Customer combined view (unused post‑checkout): `apps/api/src/modules/orders/orders.service.ts:460‑485`
