# Food Delivery Module — Architecture Design Document (ADD)

**Status:** Phase 1 — Design & Audit. **All §11 decisions are now FINALIZED (see §11).** The only remaining gate before Phase 2 is the Rishivan menu image. **No feature code has been written.**
**Architecture stance (v2 — updated):** *Food is a completely isolated, plug-in module.* The existing marketplace (Grocery, Medicines, Electronics, Fashion, Hardware, Bakery, Stationery, Gifts, Personal Care, Sweets, Famous Dish, General Stores) **must keep behaving exactly as it does today.** We **add** a Food experience; we do **not** redesign or refactor the working marketplace.

> ⚠️ **Blocker for the menu task:** The Rishivan (Amul Store) menu **image did not arrive** — there's no attachment in the request. The Food schema/seed is designed to accept a restaurant menu; **Rishivan's items are a clearly-marked placeholder** (`RISHIVAN_MENU_PENDING`) until you re-send the image. Nothing else here is blocked.

---

## 0. TL;DR — the one decision that matters (revised)

> **Food is a separate module that plugs into the existing app. It owns its own data, its own cart, its own pricing, its own order pipeline, and its own APIs. The existing marketplace tables, services, and flows are NOT modified.** The single-restaurant / no-mixing rule lives **inside the Food cart only** and cannot touch grocery/marketplace carts.

**Prefer extension over modification.** Every design choice below is filtered through one question: *does this change how the existing marketplace behaves?* If yes, we find an isolated alternative.

### Reconciling "isolate Food" with the earlier "reuse, don't duplicate"
These are not in conflict once we split *what* gets reused:

| Layer | Decision |
|---|---|
| **Existing marketplace domain logic** (cart/checkout/pricing/orders/seller/rider services + their DB tables) | **Do NOT touch.** No new columns on `carts`/`orders`/`shops`, no branches in `pricing.service`/`cart.service`/`orders.service`, no filters added to existing catalog queries. |
| **Food domain** (restaurants, menus, food cart, food orders, food pricing) | **New, isolated** tables + services + `/api/v1/food/*` routes. |
| **Presentation & patterns** | **Reuse** UI components and proven patterns (the two-pane shop screen, the checkout layout, the order status-machine *shape*) by composing/copying at the component level — never by mutating the shared screens the marketplace depends on. |
| **Shared infrastructure** | **Reuse via stable interfaces** where reuse does not change existing behaviour: auth/JWT, Razorpay create+verify, address snapshotting, push notifications, the ETA helper, and rider assignment logic. |

Net: we reuse **code and components**, we isolate **domain data and business logic**. That gives a premium Food experience with **zero regression surface** on the marketplace.

**Guiding principle (your directive):** the Food module should feel like Bringly gained *one powerful new feature* — not like the app was rebuilt. An existing customer should feel the app simply received a new Food section. Every decision is ranked by: (1) zero regressions, (2) minimal changes to existing code, (3) maximum *safe* reuse, (4) clean extensibility for future growth, (5) production-ready quality.

**Non-goals (explicitly out of scope — nothing in this document may contradict these):**
- **No footer redesign** — add exactly one Food button; no tab is moved, replaced, or removed.
- **No "Marketplace vs Food" selection at startup** — Food is only a footer destination; the app's existing flow is unchanged.
- **No Marketplace changes** — grocery cart, checkout, pricing, orders, seller logic, and rider logic stay exactly as today.
- **Food is UPI-only** — no additional payment method is introduced anywhere; Marketplace payment stays exactly as today.

---

## 1. Codebase audit — what exists, and how we relate to it

Grounded in the actual repo (file paths are real). For each, we mark **REUSE** (compose/copy at component/infra level) vs **LEAVE UNTOUCHED** (do not modify).

### 1.1 Navigation (customer app) — *additive touch only*
- `apps/customer-app/src/navigation/AppNavigator.tsx` — `TabParamList = { Home, OrderHistory, Categories, Special, Profile }`; stack owns `ShopDetail`, `Checkout`, `OrderTracking`, `OrderPlaced`.
- `apps/customer-app/src/navigation/CustomTabBar.tsx` — 3 regular tabs + a **raised "Special" button** (`SpecialTab`). **A raised "Food" button is added here, mirroring `SpecialTab`** — purely additive; existing tabs unchanged.

### 1.2 The two-pane pattern you described — *REUSE as a component template*
- `apps/customer-app/src/screens/shop/ShopDetailScreen.tsx` (line 64): *"Two-pane shop screen: left rail of all shops + right 2-column product grid…"* — exactly the "restaurants left / items in twos on the right" UX. The Food screen **reuses this layout** (new Food screen composed from the same building blocks), reading Food data. We do **not** modify `ShopDetailScreen` itself.
- `apps/customer-app/src/screens/categories/ChirawaSpecialScreen.tsx` — reference for the Food landing header/aesthetic.

### 1.3 Cart — *LEAVE UNTOUCHED; Food gets its own*
- DB `Cart` (`userId @unique`) + `CartItem`; Redis mirror `cart:${userId}`; client `context/CartContext.tsx`. This is the **marketplace cart** and stays exactly as-is. **Food introduces a separate `FoodCart` + `FoodCartContext`.**

### 1.4 Pricing — *LEAVE UNTOUCHED; Food computes its own*
- `apps/api/src/modules/pricing/pricing.service.ts` (`calculateDeliveryFee` — the existing marketplace fee: ₹25 for carts <₹100, ₹10 for ≥₹100, plus every current rule already implemented) + `pricing.routes.ts` (`POST /pricing/preview`). **Kept exactly as-is.** Food has its own flat-₹30 pricing in a separate Food pricing service, used only inside Food checkout.

### 1.5 Orders — *REUSE the status-machine shape; do NOT reuse the table*
- `apps/api/src/modules/orders/order-status.ts` — `ORDER_TRANSITIONS` + `transitionOrderStatus()` (single atomic enforcement point). The **status vocabulary and the state-machine pattern are reused for food orders**, but food orders live in their **own table + service**, so the existing `orders` table and all its consumers (seller/rider/tracking/settlement/recovery) are untouched.

### 1.6 Checkout & payment — *REUSE visual components; isolate the logic*
- `apps/customer-app/src/screens/orders/CheckoutScreen.tsx` (1250 lines) — the marketplace checkout. **Not modified.** The Food checkout **reuses its visual components** (address block, bill rows, promo field, Razorpay launcher) so it looks identical, but is driven by the Food cart + Food pricing (flat ₹30, UPI-only, "Coming Soon" COD) via an isolated Food checkout path.
- Razorpay create/verify (`components/payment/RazorpayCheckout.tsx`, API payment module) — **REUSE as shared infrastructure**, unchanged.

### 1.7 Seller & rider apps — *additive Food surfaces only*
- **Restaurant Mode lives INSIDE the existing Seller App** (no separate Restaurant App). It's an additional role/interface: a restaurant logs into the same Seller App and sees a Food-orders surface — **Accept · Reject · Mark Preparing · Mark Ready · Today's Orders · Order History**. Gated by restaurant ownership (`Restaurant.sellerUserId`), so no existing seller/grocery screen changes.
- Rider gets a **new** restaurant-pickup surface (waiting/ready/pickup) reading the Food pipeline. Existing order/stock/delivery screens are untouched.

---

## 2. Isolation model — Food as a plug-in module

```
┌──────────────────────── EXISTING MARKETPLACE (frozen) ─────────────────────────┐
│  shops · categories · products · carts · orders · pricing.service · cart.service │
│  orders.service · CheckoutScreen · CartContext · seller/rider order flows        │
│                         ↑ behaviour MUST stay identical ↑                        │
└──────────────────────────────────────────────────────────────────────────────────┘
        ▲ reuse (components / patterns)        ▲ reuse (shared infra, unchanged)
        │                                       │  auth · Razorpay · notifications
┌───────┴───────────────── FOOD MODULE (new, isolated) ─────────┴──────────────────┐
│  Data:      restaurants · menu_categories · menu_items · food_carts · food_orders │
│  Services:  food-catalog · food-cart (+ FoodCartPolicy) · food-pricing · food-order│
│  API:       /api/v1/food/*                                                         │
│  Customer:  Food tab · Food two-pane screen · FoodCartContext · Food checkout      │
│  Seller:    Restaurant Mode        Rider: restaurant pickup flow                   │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Rule of thumb enforced everywhere:** existing marketplace code paths never see Food data, and Food code paths never mutate marketplace tables/services.

---

## 3. Database design — new Food-scoped tables ONLY

**We do NOT add columns to `carts`, `orders`, or `shops`, and we do NOT alter existing enums.** (Adding a `fulfillmentType` discriminator to shared tables was the v1 idea; it's rejected now because it would force every existing shop/order/cart query to add a filter — i.e. it would change existing behaviour.) Instead, Food gets its own additive tables. The migration is purely additive: new tables, zero changes to existing ones.

```prisma
// ── Restaurants (isolated; NOT rows in the shared `shops` table) ───────────────
model Restaurant {
  id            String   @id @default(uuid()) @db.Uuid
  name          String   @db.VarChar(120)
  description   String?  @db.Text
  cuisine       String?  @db.VarChar(80)
  logoUrl       String?  @map("logo_url")
  coverImageUrl String?  @map("cover_image_url")
  lat           Decimal  @db.Decimal(10, 8)
  lng           Decimal  @db.Decimal(11, 8)
  address       String   @db.VarChar(255)
  isActive      Boolean  @default(true)  @map("is_active")
  isOpen        Boolean  @default(false) @map("is_open")
  openTime      String   @default("11:00") @map("open_time") @db.VarChar(5)
  closeTime     String   @default("23:00") @map("close_time") @db.VarChar(5)
  prepTimeMinutes Int    @default(20) @map("prep_time_minutes")
  // Manual, configurable rail order (NOT alphabetical) — ops can promote/reorder any time.
  displayOrder  Int      @default(0) @map("display_order")
  // Restaurant Mode login: the Seller-App user that operates this restaurant's
  // orders (Accept/Reject/Preparing/Ready). One login per restaurant.
  sellerUserId  String?  @map("seller_user_id") @db.Uuid
  ratingAverage Decimal? @map("rating_average") @db.Decimal(3, 2)
  ratingCount   Int      @default(0) @map("rating_count")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  menuCategories MenuCategory[]
  menuItems      MenuItem[]
  foodOrders     FoodOrder[]
  @@index([isActive, isOpen])
  @@index([displayOrder])
  @@map("restaurants")
}

model MenuCategory {
  id           String   @id @default(uuid()) @db.Uuid
  restaurantId String   @map("restaurant_id") @db.Uuid
  name         String   @db.VarChar(100)
  sortOrder    Int      @default(0) @map("sort_order")
  restaurant   Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  items        MenuItem[]
  @@index([restaurantId, sortOrder])
  @@map("menu_categories")
}

model MenuItem {
  id             String   @id @default(uuid()) @db.Uuid
  restaurantId   String   @map("restaurant_id") @db.Uuid
  menuCategoryId String?  @map("menu_category_id") @db.Uuid
  name           String   @db.VarChar(200)
  description    String?  @db.Text
  pricePaise     Int      @map("price_paise")     // menu price (integer paise)
  imageUrl       String?  @map("image_url")
  isVeg          Boolean? @map("is_veg")
  isAvailable    Boolean  @default(true) @map("is_available")
  sortOrder      Int      @default(0) @map("sort_order")
  restaurant     Restaurant   @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  menuCategory   MenuCategory? @relation(fields: [menuCategoryId], references: [id])
  @@index([restaurantId, isAvailable])
  @@map("menu_items")
}

// ── Food cart (separate from the marketplace `carts` table) ────────────────────
model FoodCart {
  id           String   @id @default(uuid()) @db.Uuid
  userId       String   @unique @map("user_id") @db.Uuid   // one food cart per user
  restaurantId String?  @map("restaurant_id") @db.Uuid     // the ONE restaurant it's bound to (null = empty)
  updatedAt    DateTime @updatedAt @map("updated_at")
  items        FoodCartItem[]
  @@map("food_carts")
}

model FoodCartItem {
  id             String @id @default(uuid()) @db.Uuid
  foodCartId     String @map("food_cart_id") @db.Uuid
  menuItemId     String @map("menu_item_id") @db.Uuid
  quantity       Int
  unitPriceAtAdd Int    @map("unit_price_at_add")
  foodCart       FoodCart @relation(fields: [foodCartId], references: [id], onDelete: Cascade)
  @@unique([foodCartId, menuItemId])
  @@map("food_cart_items")
}

// ── Food orders (own pipeline; existing `orders` table untouched) ──────────────
model FoodOrder {
  id             String   @id @default(uuid()) @db.Uuid
  customerId     String   @map("customer_id") @db.Uuid
  restaurantId   String   @map("restaurant_id") @db.Uuid
  // Address snapshot (same immutability convention as marketplace orders)
  deliveryStreet String @map("delivery_street") @db.VarChar(255)
  deliveryLat    Decimal @map("delivery_lat") @db.Decimal(10, 8)
  deliveryLng    Decimal @map("delivery_lng") @db.Decimal(11, 8)
  // … remaining snapshot fields …
  itemsSubtotalPaise Int @map("items_subtotal_paise")
  deliveryFeePaise   Int @map("delivery_fee_paise")   // flat, from Food config
  totalPaise         Int @map("total_paise")
  status         String  @default("pending_payment")  // reuses the marketplace status vocabulary
  riderId        String? @map("rider_id") @db.Uuid
  // status timestamps: confirmedAt, preparingAt, readyAt, pickedUpAt, outForDeliveryAt, deliveredAt, cancelledAt
  createdAt      DateTime @default(now()) @map("created_at")
  restaurant     Restaurant       @relation(fields: [restaurantId], references: [id])
  items          FoodOrderItem[]
  statusHistory  FoodOrderStatusHistory[]
  @@index([customerId, createdAt(sort: Desc)])
  @@index([restaurantId, status])
  @@index([riderId, status])
  @@map("food_orders")
}

model FoodOrderItem { /* id, foodOrderId, menuItemId, name snapshot, unitPrice, quantity, subtotal */ @@map("food_order_items") }
model FoodOrderStatusHistory { /* id, foodOrderId, status, changedByRole, changedById, reason, createdAt */ @@map("food_order_status_history") }
```

**Fees & markup — Food-scoped config, never hardcoded, never in shared pricing:**
- Flat ₹30 fee + menu markup live in a **Food config** (a namespaced `AppConfig` key like `food.pricing`, or a small `FoodConfig` table), read by the **Food pricing service** — the marketplace `FeeRule`/`pricing.service` are untouched.
- **Markup is 0% at launch** but the engine supports, via config only (no code change): **percentage**, **fixed**, **per-restaurant**, and **per-category** markup. Launch revenue = flat ₹30 delivery fee (+ future restaurant commission).
  ```jsonc
  {
    "deliveryFeePaise": 3000,                                   // flat ₹30
    "payment": { "onlineOnly": true, "allowedMethods": ["upi"] }, // UPI only (COD shown as "Coming Soon", disabled)
    "eta": { "minMinutes": 30, "maxMinutes": 50 },
    "markup": {                          // all zero/empty at launch; future-ready shape
      "defaultPercent": 0,
      "defaultFixedPaise": 0,
      "perRestaurant": {},               // { restaurantId: { percent | fixedPaise } }
      "perCategory":   {}                // { menuCategoryId: { percent | fixedPaise } }
    }
  }
  ```

**Menu items are simple at launch (decided):** Name, Price, Image, optional Description (+ optional veg flag). **No** variants, Half/Full, Small/Large, add-ons, or customizations. The schema stays extensible — those would later add isolated `MenuItemVariant` / `MenuItemAddOn` tables — but none are built now.

---

## 4. Food Cart Policy — one restaurant per food order (Food-only)

**Scope:** this policy governs the **`FoodCart` only**. It has **no effect on the marketplace cart** — grocery/marketplace cart behaviour stays exactly as today (whatever multi-store rules it has now are unchanged; we do not impose single-seller on grocery).

**Food rules (enforced server-side in the Food cart service, the single source of truth):**
1. **One restaurant per food order.** The `FoodCart` binds to the first restaurant added (`FoodCart.restaurantId`). Adding an item from a **different restaurant** → typed conflict `FOOD_CART_DIFFERENT_RESTAURANT` (HTTP 409).
2. **Food and marketplace never combine into one order.** They are physically separate carts → separate checkouts → separate orders. This is guaranteed by construction, not by a runtime check.

**Encoded as a small, config-driven policy (not "single restaurant forever"):** a pure `evaluateFoodCartAddition(cart, candidate, cfg)` with `cfg.maxRestaurantsPerFoodOrder = 1`. Raising it later (multi-restaurant food checkout) is a **config change**, and lights up food-order grouping — no rewrite. This lives entirely in the Food module.

### 4.1 Premium confirmation bottom sheet (customer app)
The Food UI intercepts the typed conflict and shows an animated, on-brand **bottom sheet** — never a raw toast, never a browser dialog. Copy per case:

**Different restaurant (item from another restaurant while a food cart exists):**
> **Items are from another restaurant** — Fresh food is prepared separately for every restaurant. Bringly allows one restaurant per order to ensure the best quality and delivery experience.
> **[Start New Order]** (clears your current food cart) · **[Continue Current Order]**

**Food → Grocery (has food items, tries to add a marketplace item):**
> **Food and Instant Delivery are fulfilled independently** — Food requires preparation while Instant Delivery is dispatched immediately. Please place a separate food order.

**Grocery → Food (has marketplace items, opens/adds Food):** the equivalent message (instant items dispatch immediately; place a separate food order).

**Behaviour:** `[Start New Order]` **never silently clears** — it's an explicit, labelled choice. Carts are never auto-merged. Design: Bringly design language, premium, animated, responsive, accessible, proper icons/typography/spacing, smooth transitions.

> The Food→Grocery / Grocery→Food messages are **informational UX** (the two carts legitimately coexist as separate orders); the **hard, server-enforced rule** is one-restaurant-per-food-cart. Because the carts are separate tables, showing these messages requires **zero change to the marketplace cart** — the Food UI simply checks whether the other cart is non-empty and educates the user.

### 4.2 Test matrix (Phase 3) — Food-only, plus regression guards
- Restaurant A → Restaurant A (allow) · Restaurant A → Restaurant B (deny `FOOD_CART_DIFFERENT_RESTAURANT`)
- Empty food cart → first restaurant item (allow + bind restaurant)
- `[Start New Order]` clears + rebinds · `[Continue Current Order]` leaves food cart intact
- Food checkout validation rejects a smuggled second restaurant · Food API returns 409 with the reason
- Config flip (`maxRestaurantsPerFoodOrder: 2`) flips A→B to allow (proves the engine, not hardcoding)
- **Regression guards:** adding grocery items with a non-empty **food** cart does not error or mutate the marketplace cart; existing grocery cart tests pass unchanged; marketplace multi-store behaviour is byte-for-byte identical.

---

## 5. Food pricing, payment & ETA (Food module only)

| Rule | Value | Where it lives |
|---|---|---|
| Delivery fee | **Flat ₹30** | Food config (`food.pricing.deliveryFeePaise`), Food pricing service |
| Payment | **UPI only** — COD shown as **"Coming Soon" (disabled)** | Food checkout + Food order service accept only UPI |
| Delivery promise | **30–50 min** shown in the Food header | Food config + Food UI |
| Menu markup | **0% at launch**; config supports %/fixed/per-restaurant/per-category later | Food config; applied in Food pricing service |

The marketplace `pricing.service`, `pricing/preview`, and `FeeRule` are **not called and not modified** for Food. Food computes its own bill. COD is unreachable in the Food flow (defense in depth: UI hides it *and* the Food order service refuses it).

---

## 6. Food order lifecycle (reuses the status *shape*, own table)

Reuses the marketplace status vocabulary and the state-machine pattern (`assertTransition`-style), running against `food_orders`:

| Restaurant step | Status | Notes |
|---|---|---|
| Placed (online) | `pending_payment → paid` | Razorpay verify (shared infra) |
| Restaurant Accepts | `paid → confirmed` | stamps `confirmedAt` |
| Preparing | `confirmed → preparing` | prep timer (seller UI) |
| Ready | `preparing → ready_for_pickup` | rider notified |
| Picked Up | `ready_for_pickup → picked_up` | rider assignment (shared logic) |
| Out for Delivery | `picked_up → out_for_delivery` | |
| Delivered | `out_for_delivery → delivered` | |
| Restaurant Reject | `paid/confirmed → cancelled` | auto-refund (online) |

The marketplace `orders.service` state machine is **not modified**; the Food order service has its own transition guard using the same shape. (We may extract the pure transition table into a shared util *only if* that extraction changes no marketplace behaviour; otherwise Food keeps its own copy — isolation wins over DRY here.)

---

## 7. API surface — new `/api/v1/food/*` namespace (existing endpoints untouched)

- `GET  /food/restaurants` — list the curated restaurants.
- `GET  /food/restaurants/:id` — restaurant detail + menu (categories → items).
- `GET/POST/PATCH/DELETE /food/cart[/items]` — Food cart CRUD; **add runs the Food Cart Policy** (409 `FOOD_CART_DIFFERENT_RESTAURANT`).
- `POST /food/checkout/preview` — Food bill (flat ₹30, markup, total).
- `POST /food/orders` — create Food order (UPI-only; rejects COD).
- `POST /food/orders/:id/verify-payment` — reuse Razorpay verify (shared infra).
- `GET  /food/orders[/:id]` — Food order history + tracking.
- Restaurant Mode (seller) + rider Food endpoints for accept/reject/preparing/ready/pickup.

Existing `catalog`, `cart`, `pricing`, `orders` routes are **not changed** — no new query params, no new filters.

---

## 8. Customer app — additive Food surfaces (existing screens untouched)

**Entry & flow — Food is just another footer destination.** There is **no "Marketplace vs Food" choice at app startup** and no mode switch anywhere; the existing app flow is completely unchanged. Food is reached **only** by tapping the new Food footer button, which opens exactly one new path:

**Food → Restaurant List → Restaurant Menu → Food Cart → Food Checkout → Food Tracking.**

Everything else in the Customer App behaves exactly as it does today.

1. **Footer — add exactly one button, no redesign.** Add a single **Food** button next to **Special**, in the **Special** design language, so it looks like it has always been part of Bringly. No existing tab is moved, replaced, or removed. In the live app the bottom bar shows **Home · Order Again · Categories · Special** and Profile is opened from the Home header avatar; adding Food gives **Home · Order Again · Categories · Special · Food**, with Profile unchanged. *(Your footer list also named Profile — see the one open decision in §11 on optionally surfacing Profile as a bottom tab.)*
2. **Food landing (two-pane):** new `screens/food/FoodScreen.tsx` reusing the two-pane layout — **left rail = restaurants in the fixed launch order** (1) Aura · (2) Bits & Bites · (3) Dark Park · (4) Foodies · (5) Goggle Cafe · (6) Rishivan (Amul Store), driven by `Restaurant.displayOrder` (manual/promotable, **not** alphabetical) — **right = menu in 2 columns**. Header copy (decided):
   > **Freshly prepared from Chirawa's favourite restaurants**
   > Estimated Delivery: 30–50 mins (varies by your order)

   Premium, restaurant-focused aesthetic, consistent with Bringly's design language.
3. **Food cart:** new `context/FoodCartContext.tsx` — **completely separate** from `CartContext`. The existing marketplace cart context is not modified.
4. **Food checkout:** **visually identical** to the existing checkout (reuses its components), driven by the Food cart + Food pricing. Only differences: **flat ₹30** delivery line; **UPI-only** online payment; **COD shown as "Coming Soon" (disabled)**. The existing `CheckoutScreen` code path (grocery) is untouched.
5. **Food tracking:** reuse tracking components against Food order status.
6. **Food conflict sheet:** the premium bottom sheet (§4.1).

**Aesthetic:** warm, appetite-friendly palette + per-restaurant hero imagery, rating/prep-time badges, distinct from the Special/maroon theme.


---

## 9. Backward compatibility & regression safety (highest priority)

| Guarantee | How |
|---|---|
| Marketplace cart/checkout/pricing/orders behave **identically** | Food never calls or mutates them; no shared columns/enums changed; Food has its own tables/services/routes. |
| No existing query changes | Restaurants are a **separate table**, so existing shop/catalog/search/Special queries can't accidentally include food — no filters added. |
| No shared-schema migration risk | Migration is **new tables only**; zero `ALTER` on `carts`/`orders`/`shops`/enums. |
| Existing tests stay green | Nothing they cover is touched; we add a **new Food test suite** + explicit **regression guards** (§4.2) asserting grocery behaviour is unchanged. |
| Seller/rider apps unchanged for marketplace | Food adds **new** surfaces reading the Food pipeline; existing order/stock/delivery screens untouched. |
| Payments reused safely | Razorpay create/verify used through their existing interface, no behavioural change. |

**Regression gate (Phase 3 & 7):** run the full existing API suites (fee, orders, promo parity, pagination, cart) and confirm **no diffs** in marketplace behaviour before/after the Food module lands.

**The one deliberate trade-off:** isolation means some duplication (a Food order pipeline parallel to the marketplace one). That is an intentional, documented price for **zero regression** — and it matches your directive to prefer extension over modification.

---

## 10. Future scalability (Food-scoped, config-driven)

- **More restaurants (100 → 1000):** more `restaurants` rows; rail → searchable list.
- **Multi-restaurant food checkout:** flip `maxRestaurantsPerFoodOrder` in Food config → activate food-order grouping. No marketplace impact.
- **Multiple cities / promos / cloud kitchens / ads / scheduled orders:** additive within the Food module; marketplace never affected.
- **Future convergence to a unified order engine (explicitly kept open):** nothing in the Food module hardcodes an assumption that blocks later merging Food + marketplace into one order engine. Shared status vocabulary, integer-paise money, address snapshots, and stable service interfaces mean convergence stays a deliberate, separately-approved migration — never forced, never foreclosed.

---

## 11. Decisions — FINALIZED

All previously-open items are locked (your answers). Only the Rishivan menu image remains outstanding, and it blocks nothing but Rishivan's seed rows.

1. **Order storage / architecture — ISOLATED for MVP.** Food has its own module, APIs, services, pricing, checkout, and rules; the Grocery marketplace is completely untouched. The design keeps a clean path to a **future unified order engine** — nothing hardcoded that would block convergence (§10).
2. **Restaurant operations — Restaurant Mode inside the existing Seller App** (no separate Restaurant App). Each restaurant has its own login and can Accept · Reject · Mark Preparing · Mark Ready · view Today's Orders · view Order History (§1.7, §12 Phase 5).
3. **Menu pricing — 0% markup at launch.** Customers see real menu prices. The pricing engine is fully config-driven and future-ready for **percentage / fixed / per-restaurant / per-category** markup with no code change. Launch revenue = flat ₹30 delivery fee (+ future commission) (§3, §5).
4. **Menu complexity — simple items only.** Name, Price, Image, optional Description. No variants / Half-Full / Small-Large / add-ons / customizations. Architecture stays extensible for later (§3).
5. **Restaurant order — manual & configurable** (not alphabetical): (1) Aura, (2) Bits & Bites, (3) Dark Park, (4) Foodies, (5) Goggle Cafe, (6) Rishivan (Amul Store) — via `Restaurant.displayOrder` (§3, §8).
6. **Food header copy** — *"Freshly prepared from Chirawa's favourite restaurants"* + *"Estimated Delivery: 30–50 mins (varies by your order)"*; premium restaurant aesthetic consistent with Bringly (§8).
7. **Footer** — add exactly one tab (Food); do not redesign. Bar reads Home · Order Again · Categories · Special · Food (Profile unchanged) (§8).
8. **Food checkout** — visually identical; only deltas: flat ₹30, UPI-only online, COD "Coming Soon" (disabled) (§5, §8).
9. **Food cart** — one restaurant per order; Food and Marketplace are always separate orders; marketplace cart behaviour unchanged (§4).

**Still outstanding (does not block Phase 2 design):**
- **Rishivan menu image** — send when ready; Rishivan seeds as a placeholder (`RISHIVAN_MENU_PENDING`) until then.
- **Profile in the footer (minor presentation).** The live app opens Profile from the Home header avatar — it is not a bottom tab today. Your footer list includes Profile, so confirm one of: **(a)** keep Profile via the avatar (default — truest to "no footer redesign"; Food is simply added next to Special), or **(b)** also show Profile as a bottom tab. Food is added either way; this only affects whether Profile becomes visible in the bar.

---

## 12. Phased delivery plan (with approval gates)

- **Phase 1 — this document.** Isolated-module design + regression strategy. **→ Awaiting your approval.**
- **Phase 2 — Contracts.** Final Food Prisma tables + migration, Food config shape, `/food/*` API contracts, Food cart policy interface, Food navigation/state design. **→ approval.**
- **Phase 3 — Food backend + tests.** Restaurants/menus, Food cart + policy, Food pricing, Food orders, UPI-only payment, seed (incl. Rishivan once image arrives). **Regression gate:** prove marketplace suites unchanged. **→ approval.**
- **Phase 4 — Customer app.** Food tab/button, two-pane Food screen, `FoodCartContext`, Food checkout (reused components), conflict sheet, tracking. **→ approval.**
- **Phase 5 — Restaurant Mode (inside the existing Seller App).** New role/interface: Accept · Reject · Mark Preparing · Mark Ready · Today's Orders · Order History; gated by `Restaurant.sellerUserId`. No separate app; existing seller screens untouched. **→ approval.**
- **Phase 6 — Rider Food pickup.** Restaurant waiting/ready/pickup states. **→ approval.**
- **Phase 7 — Full regression audit + performance + production-readiness report.**

At each phase end: what changed, why, files touched, risks — then wait.

---

## 13. Files this will touch (forecast)

**New (the Food module — the vast majority of the work):**
- `apps/api/prisma/schema.prisma` — **new tables only** (Restaurant, MenuCategory, MenuItem, FoodCart, FoodCartItem, FoodOrder, FoodOrderItem, FoodOrderStatusHistory) + migration.
- `apps/api/src/modules/food/**` — `food-catalog`, `food-cart` (+ `food-cart-policy.ts`), `food-pricing`, `food-order` services/routes/schemas + tests.
- `apps/customer-app/src/screens/food/**`, `context/FoodCartContext.tsx`, `components/cart/FoodConflictSheet.tsx`, Food checkout screen, Food API client methods.
- `packages/types` — Food types + `FOOD_CART_DIFFERENT_RESTAURANT` reason code (additive).
- Seller/rider Food surfaces (Phases 5–6).

**Existing files — additive, behaviour-neutral touches ONLY:**
- `navigation/AppNavigator.tsx` (register Food tab/screens), `navigation/CustomTabBar.tsx` (add Food button), i18n strings, API route registration (mount `/food`).
- **Explicitly NOT modified:** `pricing.service.ts`, `pricing.routes.ts`, `cart.service.ts`, `orders.service.ts`, `catalog.routes.ts`, `CheckoutScreen.tsx`, `CartContext.tsx`, and the `carts`/`orders`/`shops` tables.

---

### Appendix A — Launch menus (status: SEEDED)
**Rishivan (Amul Store) — REAL menu, received 2026-07-08** and transcribed verbatim into the seed (`apps/api/prisma/seed-food.ts`): Crispy Corner (11 items, ₹89–₹319) · Special Rabdi (3) · Slush (7 × ₹69) · Classic Ice Cream Scoops (7 × ₹59) · Premium Ice Cream Scoops (8, ₹59–₹149) · Ice Cream Shakes (8, ₹99–₹159). All vegetarian; prices exactly as printed on the card.

**Aura, Bits & Bites, Dark Park, Foodies, Goggle Cafe — PROVISIONAL menus** (owner-approved placeholders for launch): typical items at sensible Chirawa prices, seeded so the section is orderable day one. **Each restaurant must review and correct items/prices at onboarding** — edits land in the seed (idempotent re-run), and sold-out toggling + open/close are self-serve in the seller app's Restaurant tab.
```
