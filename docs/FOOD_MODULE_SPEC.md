# Food Module — Frozen Production Architecture Specification (as implemented)

**Date:** 2026-07-12 · **Author:** Principal Product Architect · **Status:** FROZEN — documentation of the implementation that exists in the working tree, prior to implementation review. **Updated 2026-07-14 (Builder):** Review Cycle 1 (RC1) corrections are landed in the tree and documented in §20; affected sections carry inline **(RC1)** notes.
**Source of truth:** the uncommitted working tree on `eng/p0-hardening` (post-commit `9979ab7`). This document records **what is built**, verified line-by-line this session — not the plan. Where the implementation differs from the design doc (`Food.md` at repo root), the implementation is documented and the divergence flagged (§16.4).
**Verification (this session):** `pnpm typecheck` green across all workspaces · `pnpm --filter @chirawa/api test` → **559/559 tests, 67 files** (34 food tests in 3 new files on top of the 525 pre-Food baseline) · marketplace suites untouched and green.
**Post-RC1 verification (2026-07-14):** root typecheck green (5 pipeline workspaces) + direct `tsc --noEmit` green on seller & rider apps (they are not in the root pipeline) · **564/564 tests, 68 files** (39 food tests incl. `food-redact.test.ts`) · customer-app vitest 12/12 · marketplace suites untouched.

---

## 1. Executive Summary

The Food Module adds restaurant food delivery to Bringly as a **completely isolated plug-in**: eight new food-scoped tables, one new API namespace (`/api/v1/food/*`, 27 endpoints), its own cart + pricing + order state machine, a self-contained money-safety sweep, and additive UI surfaces in all three apps (customer Food tab + checkout + tracking + history; seller "Restaurant Mode" tab; rider "Food pickups" tab). **No marketplace table, service, route, or screen is modified** — the only existing-file changes are additive registrations (route mount, plugin mount, navigation entries, i18n keys, typed client methods).

Food inverts two marketplace rules by design: it is **UPI-prepaid-only** (COD is rendered as "Coming Soon" and refused server-side) and it uses **rider self-claim** (first-tap-wins CAS on a ready-order pool) instead of dispatch/batching auto-assignment. Because every food order is paid before the restaurant sees it, the module ships with a hardening layer the plan didn't originally spec: a reconcile sweep that rescues captured-but-unverified payments, expires abandoned checkouts, auto-cancels+refunds orders the restaurant never accepts (15 min), and retries failed refunds until they converge — with refund durability tracked in the schema (`refund_status`).

**The one launch-critical dependency:** food ordering requires the platform's `PAYMENTS_ONLINE_ENABLED` flag (currently **false** per the COD-only marketplace launch decision) plus real Razorpay credentials. With the flag off, `POST /food/orders` refuses with an honest message — the Food surfaces browse fine but cannot sell. Flipping that flag for Food while keeping marketplace COD-only is possible today (the marketplace UI flag `FEATURES.onlinePayments` is independent), but it is an **operational decision the founder must schedule**.

Scale intent (from seeded data + design): six curated Chirawa restaurants at launch, one real transcribed menu (Rishivan/Amul Store), five owner-approved provisional menus pending onboarding correction.

## 2. Business Model

| Rule | Implemented value | Where enforced |
|---|---|---|
| Revenue | Flat **₹30 delivery fee** per food order (`deliveryFeePaise: 3000`) | `food-config.ts` default; `computeFoodBill` (`food-pricing.ts`) |
| Menu markup | **0% at launch** — customers see real menu prices; engine supports percent / fixed / per-restaurant / per-category via config only | `applyMarkup` (`food-pricing.ts`); precedence per-restaurant > per-category > default; percent first, then fixed; `Math.round`, floor 0 |
| Commission | None (no field, no deduction anywhere in the food pipeline) | — |
| Payment | **UPI-only, prepaid.** COD visible but disabled ("Coming Soon") in checkout; server accepts no method but UPI (`paymentMethod` is always `'upi'`) | `FoodCheckoutScreen`; `placeOrder` writes `'upi'` unconditionally; config `payment: { onlineOnly: true, allowedMethods: ['upi'] }` |
| Delivery promise | **30–50 min band**, config-driven, shown in header/checkout/tracking — *not* a per-order computation | `food-config.ts` `eta`; rendered by all food screens |
| Restaurants | Curated, manually ordered rail (`displayOrder` 1–6): Aura, Bits & Bites, Dark Park, Foodies, Goggle Cafe, Rishivan (Amul Store) | `seed-food.ts`; `GET /food/restaurants` orders by `displayOrder asc, name asc` |
| Hours | **Per-restaurant** `openTime`/`closeTime` (seeded 11:00–22:00) + manual `isOpen` toggle, evaluated in IST via the shared `computeIsOpen`. The platform's 9–20 marketplace hours do **not** apply to food | `placeOrder`, `/restaurants` list/detail, checkout preview |
| Cart policy | **One restaurant per food order** — config cap `maxRestaurantsPerFoodOrder: 1`, raisable without code change | `food-cart-policy.ts` (pure), enforced in `food-cart.service.addItem` |
| Food ⊥ Marketplace | Separate carts → separate checkouts → separate order tables; never combined, by construction | schema + module isolation |
| Config | Every business number lives in `FoodConfig` — defaults in code, overridable per-section via the existing `AppConfig` table under key **`food.config`**, 60 s in-process cache, garbage-tolerant fallback | `food-config.ts` |

## 3. User Flow (customer)

1. **Entry:** a single raised **Food** tab in the bottom bar (added next to Special, same design language; no other tab moved). No mode switch anywhere else; marketplace flow unchanged.
2. **Food landing (`FoodScreen`)**: warm tandoor-orange gradient header with the decided copy ("Freshly prepared from Chirawa's favourite restaurants") + config-driven ETA band; **two-pane layout** — left rail of restaurants (logo/letter-gradient avatar, closed pill), right pane = active restaurant's menu grouped by category sections in rows of two. First restaurant auto-opens; per-restaurant menu cached per mount. Empty menu → "Menu coming soon" state. Header receipt icon → Food order history.
3. **Add to cart (`FoodMenuItemCard`)**: image/placeholder, veg/non-veg mark, price in ₹, add/stepper bound to `FoodCartContext` (server-backed, optimistic steppers, pending-mutation tracking).
   - **Different restaurant** → server 409 `FOOD_CART_DIFFERENT_RESTAURANT` → premium animated bottom sheet: **[Start New Order]** (explicit clear + re-add of the attempted item) / **[Continue Current Order]**. Backdrop tap = continue (non-destructive default).
   - **Grocery→Food education**: first food add of a session while the marketplace cart is non-empty shows a once-per-session informational sheet ("fulfilled independently"); **[Got it] proceeds with the add**. Marketplace cart is read-only-peeked, never written.
4. **Cart bar** (`count > 0`): floating orange bar on the Food screen → **FoodCheckout**.
5. **Checkout (`FoodCheckoutScreen`)**: items with steppers (cart empties → auto-back), "From <restaurant>" + ETA chip, bill card (Items Total / flat Delivery Fee ₹30 with explainer / Grand Total), payment card (UPI preselected + non-deselectable; COD row faded, disabled, "Coming Soon" badge + toast), sticky deliver-to row (AddressContext `current`; tap → AddressList) + Place Order ₹total. Place Order is disabled while placing, preview missing, restaurant closed, or cart writes are in flight (flushes pending mutations first).
6. **Payment:** `POST /food/orders` (idempotent) → order created `pending_payment`, cart consumed, Razorpay order returned → shared `RazorpayCheckout` UPI sheet ("Bringly Food", food-orange theme).
   - **Success** → `POST /food/orders/:id/verify-payment` → `paid` → replace to **FoodOrderTracking**.
   - **Dismiss/failure** → toast + replace to tracking with `payment` params so **"Pay now" can re-open the sheet** (order stays `pending_payment`; the reconcile sweep is the safety net).
7. **Tracking (`FoodOrderTrackingScreen`)**: restaurant hero + ETA band, 7-step timeline (Paid → Confirmed → Preparing → Ready → Picked up → Out for delivery → Delivered) with per-step timestamps, items + bill recap, pending-payment banner with Pay now, cancelled card with refund note (when `refundedPaise > 0`). **10 s polling**, stops on terminal states. No map, no socket, no rider identity shown.
8. **Cancel:** allowed while `pending_payment` or `paid` (confirm dialog: "Restaurant ne order accept kar liya hai — ab cancel nahi ho sakta" afterwards). Paid cancel triggers the durable refund ("refund 5–7 din mein aa jayega").
9. **History (`FoodOrdersScreen`)**: lightweight list (restaurant, items line, ₹total, status pill, live highlight) → tracking. Loads on focus; page-1 only in the UI (client passes no params; API supports `page`/`limit` ≤ 50).

**Push notifications** (best-effort FCM via Redis `fcm:token:<userId>`): customer gets "cancelled (+refund)" on reject/timeout, "Payment mil gaya ✓" on sweep-rescued payments, a late-refund push when money captures after cancellation **(RC1 P0)**, and **milestone pushes at confirmed / out_for_delivery / delivered (RC1 P2)** — deliberately only the three moments a customer cares about; every other hop stays polling-only to avoid notification fatigue.

## 4. Restaurant Flow (seller app — "Restaurant Mode")

- **Visibility:** the **Restaurant tab (🍽️)** renders only when `GET /food/restaurant/me` returns a restaurant for the logged-in seller (`Restaurant.sellerUserId = User.id`, one login per restaurant). Grocery-only sellers see exactly the four existing tabs; a transient lookup failure keeps the tab hidden (never flashes).
- **Screen (`RestaurantOrdersScreen`)**, 15 s polling on order scopes:
  - **Header:** restaurant name + **open/close Switch** (optimistic, reverts on failure) → `PATCH /food/restaurant/open`.
  - **Scopes:** Today (IST day window, computed via `istDayStartUtc`) · History · **Menu** (management view incl. sold-out items; per-item availability Switch → `PATCH /food/restaurant/menu/:itemId`).
  - **Order cards:** Hindi status pill (paid = "नया ऑर्डर" …), elapsed minutes, item lines, ₹total; **actions by status:** `paid` → **Accept** / **Reject** (confirm dialog warns "Customer ko poora paisa refund ho jayega"); `confirmed` → **Mark Preparing**; `preparing` → **Mark Ready**.
- **Server rules:** every action re-resolves the caller's restaurant and checks the order belongs to it; `pending_payment` orders are **never visible** to restaurants (`RESTAURANT_VISIBLE` excludes it — an unpaid order isn't real yet). Reject triggers the durable auto-refund + customer push. A new **paid** order sends the "🍽️ Naya food order!" push to the restaurant's device.
- **Accept deadline:** a `paid` order not accepted within **15 min** (`ops.acceptTimeoutMinutes`) is auto-cancelled + refunded by the sweep with reason `restaurant_no_response`.
- **Not present (by decision/implementation):** menu item CRUD beyond availability (menus are seed/DB-managed), prep-timer, order-ready rider visibility, restaurant-side sockets or sound alarm (polling + FCM only).

## 5. Cart Rules

1. **Separate cart:** `food_carts` (one per user — `user_id` UNIQUE) + `food_cart_items` (`(food_cart_id, menu_item_id)` UNIQUE). DB-only (no Redis mirror — deliberately simpler than the marketplace cart). Marketplace `carts` untouched.
2. **Restaurant binding:** first added item stamps `FoodCart.restaurantId`. **Policy:** adding from another restaurant is denied with typed 409 `FOOD_CART_DIFFERENT_RESTAURANT` (details carry current+attempted restaurant ids/names). Policy is the pure `evaluateFoodCartAddition(cart, candidate, cfg)` — cap `maxRestaurantsPerFoodOrder` (1 at launch; raising it is the multi-restaurant switch, unit-test-pinned).
3. **Race safety:** add runs in a transaction; the unique `userId` row serializes concurrent adds — upsert-then-check means two different-restaurant adds can never both bind.
4. **Quantities:** add = upsert increment; 1 ≤ qty ≤ 20 per line (Zod); set-quantity 0 deletes the line; **last line deleted drops the cart row**, clearing the binding so the next add binds afresh.
5. **Pricing on read:** every cart read re-prices lines at the **current** menu price (+markup) — `unitPriceAtAdd` is stored but never trusted at checkout (no stale-price undercharge). Unavailable items are surfaced per-line (`isAvailable`) and **block order placement** with a named-item message.
6. **Availability gates on add/update:** inactive restaurant or unavailable item → `BusinessRuleError`.
7. **Explicit clears only:** `DELETE /food/cart` backs **[Start New Order]**; placement consumes the cart inside the order transaction. Carts are never auto-merged, never silently cleared.
8. **Cross-cart:** food and marketplace carts coexist; the only interaction is a read-only peek for the once-per-session education sheet.

## 6. Checkout Rules

1. **Preview** (`GET /food/checkout/preview`): requires non-empty bound cart; returns `itemsSubtotalPaise + deliveryFeePaise = totalPaise` (integer paise), ETA band, payment config, and restaurant open state. The client renders exactly these numbers.
2. **Placement** (`POST /food/orders`) validations in order: platform online-payments flag ON (else `BusinessRuleError` "Food orders UPI se hote hain — online payment abhi enabled nahi hai") → cart non-empty & bound → **every line available** → restaurant exists & `isActive` → **restaurant currently open** (per-restaurant IST hours) → address exists, not deleted, **owned by the caller**.
3. **Money creation order:** Razorpay order is created **first** with receipt `food_<pre-generated-uuid>` — if the DB transaction then fails, the orphan Razorpay order is harmless (unpaid, expires). The transaction writes: `food_orders` row (address snapshot: street/landmark/locality/city/pincode/lat/lng, optional receiver name/phone, bill triple, `status='pending_payment'`, `paymentMethod='upi'`, `razorpayOrderId`) + `food_order_items` snapshots (name, unitPrice, quantity, subtotal) + history row + **cart deletion**.
4. **Idempotency:** same discipline as marketplace checkout — Redis `runIdempotent` scoped `foodorder:<userId>`, key from `Idempotency-Key` header or derived `auto:foodcart:<cartId>` (stable across a double-tap, unique per cart). Per-user rate limit **20/min** on placement.
5. **Client-side race guard:** Place Order flushes in-flight stepper writes (`flushPendingMutations`) before placing, and is disabled while any are pending — a just-tapped add can't be stranded (the marketplace's YMAL-race lesson, applied).
6. **Receiver fields:** API accepts optional `receiverName`/`receiverPhone` (Indian-mobile regex); the current checkout UI sends only `addressId`.
7. **No promo codes, no COD, no delivery instructions, no tips** — none of these exist anywhere in the food flow.

## 7. Payment Rules

1. **UPI-only, prepaid.** `paymentMethod` is hardwired `'upi'`; there is no code path that accepts anything else. COD is a disabled UI row only.
2. **Gate:** placement requires the **platform** flag `PAYMENTS_ONLINE_ENABLED=true` (shared `onlinePaymentsEnabled()` — the flag itself is untouched by the module). The reconcile sweep also no-ops unless the flag is on **and** Razorpay is configured.
3. **Verify** (`POST /food/orders/:id/verify-payment`): owner-only; `razorpayOrderId` must match the order; signature checked via the shared HMAC `verifyPaymentSignature`; transition `pending_payment → paid` (CAS, stamps `paidAt` + `razorpayPaymentId`). **Idempotent:** re-verify of an already-paid order returns success silently; verify on any other status → `BusinessRuleError` — **except `cancelled` (RC1 P0):** a valid signature on a cancelled order means UPI captured after cancellation, so the payment id is recorded and the durable refund begins immediately, returning `status:'cancelled', refunded` with an honest message (money is never stranded). On success the restaurant push fires (fire-and-forget, never blocks the reply); **(RC1 Batch 3)** the push is gated on the CAS flip result, so a double-verify — or a verify racing the sweep's rescue — can never send a duplicate "new order" push.
4. **No webhooks for food.** The marketplace Razorpay webhook records into the marketplace `payments` table only. Food's equivalent safety net is the **reconcile sweep** polling Razorpay's REST API (`fetchPaymentsByOrderId` — pre-existing shared function):
   - **RESCUE:** `pending_payment` older than 180 s with a **captured** Razorpay payment → CAS to `paid` + restaurant & customer pushes ("Payment mil gaya ✓").
   - **EXPIRE:** `pending_payment` older than 30 min with nothing captured → cancel (`payment_timeout`), nothing owed.
   - **LATE-CAPTURE (RC1 P0):** `cancelled` orders (48 h lookback) that never recorded a payment are checked against Razorpay; a captured payment is CAS-claimed (`updateMany WHERE refundStatus='none' AND razorpayPaymentId IS NULL` — exactly one sweeper wins, no duplicate refund attempt or push) then durably refunded + customer push; nothing captured ⇒ `refundStatus='skipped'` (terminal bookkeeping so the row is never re-queried).
   - Sweep runs in-process in the API every 120 s (config), single-sweeper elected via Redis `SET NX` lock across PM2 instances, boot pass after 15 s; correctness never depends on the lock — every mutation is CAS.
5. **Refunds (durable, `refund_status`: none → pending → processed | failed):** triggered by customer cancel of a `paid` order, restaurant reject, or accept-timeout. `beginFoodRefund`: no captured payment → `skipped`; else stamp `pending`, **ask Razorpay for existing refunds first** (`GET /payments/:id/refunds`, direct Basic-auth REST) — if the total is already covered, record `processed` without re-refunding (timeout/cross-instance safe); else `createRefund` (shared service) → `processed` (+`refundedPaise = totalPaise`, `razorpayRefundId`) or `failed`. **RETRY:** the sweep re-runs `failed` and stale `pending` (>10 min) refunds until they converge; `GET /food/admin/refunds` (admin) lists refunds needing attention.
6. **Money invariants:** all integer paise; bill equation `total = itemsSubtotal + deliveryFee` (no discount line exists); refund is always the **full** `totalPaise`; amounts are server-derived — the client never supplies a price.

## 8. Delivery Rules

1. **No dispatch, no batching, no assignment worker.** Food uses **rider self-claim**: `ready_for_pickup` orders with `riderId IS NULL` form an open pool (`GET /food/rider/pickups` → `available` oldest-ready-first, cap 20, plus the rider's own `active` orders).
2. **Claim** (`POST /food/rider/orders/:id/claim`): atomic CAS `updateMany WHERE status='ready_for_pickup' AND riderId IS NULL` — exactly one rider wins; losers get "Yeh order kisi aur rider ne le liya" and the client refreshes.
3. **Progression** (claimed rider only, strict single-step): picked-up → out-for-delivery → delivered via three endpoints; each checks `riderId === auth.profileId` (RiderProfile id) and the exact from-status, then CAS-transitions with history.
4. **Prepaid means no cash:** rider UI shows "PAID ✓" and "online paid, cash NahiN lena"; there is no COD-collect step in the food pipeline.
5. **No rider location publishing, no ETA computation, no proof of delivery** in the food flow; the rider Food tab (🍔 "फूड") polls every 15 s. Riders are **not notified** when food becomes ready — the pool is discovered by polling. There is no un-claim/release action; a claimed order can only move forward (or be cancelled — see §15 edge).
6. **Customer-side:** tracking shows status only (no map, no rider name/phone).

## 9. Database Schema

Two additive migrations; **zero ALTER on any pre-existing table** (`20260708000000_food_module` — 8 tables; `20260708100000_food_refund_tracking` — 2 columns + index on `food_orders` only). Prisma models mirror them 1:1 (+216 lines in `schema.prisma`).

| Table | Columns (essentials) | Notes |
|---|---|---|
| `restaurants` | name(120), description, cuisine(80), logo/cover URLs, lat/lng Decimal, address(255), `is_active` def true, `is_open` def true, `open_time` def '11:00', `close_time` def '22:00' (VarChar(5) HH:MM), `prep_time_minutes` def 20, `display_order` def 0, `seller_user_id` UUID nullable, `rating_average` Decimal(3,2) nullable, `rating_count` def 0 | NOT rows in `shops`. Indexes: (is_active,is_open), (display_order), (seller_user_id). No FK from seller_user_id (loose link to `users`) |
| `menu_categories` | restaurant_id FK CASCADE, name(100), sort_order, is_active def true | Index (restaurant_id, sort_order) |
| `menu_items` | restaurant_id FK CASCADE, menu_category_id FK SET NULL, name(200), description, `price_paise` Int, image_url, `is_veg` Bool nullable, `is_available` def true, sort_order | Simple items only — no variants/add-ons tables. Indexes: (restaurant_id,is_available), (menu_category_id,sort_order) |
| `food_carts` | `user_id` UUID **UNIQUE**, restaurant_id FK SET NULL nullable | One food cart per user; row deleted ⇒ binding cleared |
| `food_cart_items` | food_cart_id FK CASCADE, menu_item_id FK **RESTRICT**, quantity, `unit_price_at_add` | UNIQUE (food_cart_id, menu_item_id). RESTRICT ⇒ a menu item in someone's cart cannot be hard-deleted |
| `food_orders` | customer_id, restaurant_id FK RESTRICT, address snapshot (street/landmark/locality/city/pincode + lat/lng), receiver name/phone nullable, `items_subtotal_paise`/`delivery_fee_paise`/`total_paise`, `status` VarChar(20) def 'pending_payment', `payment_method` VarChar(10) def 'upi', `razorpay_order_id`/`razorpay_payment_id`(64), `paid_at`, `refunded_paise` def 0, **`refund_status` VarChar(12) def 'none'**, **`razorpay_refund_id`(64)**, `rider_id` UUID nullable (RiderProfile id, no FK), `cancel_reason`(255), per-status timestamps (confirmed/preparing/ready/picked_up/out_for_delivery/delivered/cancelled `_at`) | Indexes: (customer_id, created_at DESC), (restaurant_id, status, created_at DESC), (rider_id, status), (status, created_at), (razorpay_order_id), (refund_status) |
| `food_order_items` | food_order_id FK CASCADE, menu_item_id (no FK), name snapshot(200), unit_price, quantity, subtotal | Name/price snapshotted at order time |
| `food_order_status_history` | food_order_id FK CASCADE, status(20), changed_by_role(20), changed_by_id UUID **NOT NULL** (system actor = zero-UUID sentinel), reason(255), changed_at | Index (food_order_id, changed_at) |

**Config storage:** existing `AppConfig` table, key `food.config` (JSON, per-section override merge). **Seed:** `pnpm --filter @chirawa/api db:seed:food` (`prisma/seed-food.ts`) — seed-guarded (refuses production), stable-UUID idempotent upserts; 6 restaurants; Rishivan's **real transcribed menu** (44 items, all veg, prices verbatim) + 5 provisional menus to be corrected at onboarding.

## 10. Backend APIs

Module: `apps/api/src/modules/food/` (11 source files + 3 test files), mounted once in `app.ts` at `/api/v1/food` plus the `food-reconcile` plugin. Hand-rolled Zod `safeParse` per route (repo convention). Errors use the shared `AppError` family (409 conflict carries code `FOOD_CART_DIFFERENT_RESTAURANT`).

**Public (no auth):**
| Method Path | Behavior |
|---|---|
| `GET /restaurants` | Active restaurants in `displayOrder`; per-row `isCurrentlyOpen` (IST), rating, `menuAvailable` (count of available items > 0); config ETA band |
| `GET /restaurants/:id` | Detail + menu grouped: active categories by sortOrder → available items (markup-applied `pricePaise`); uncategorized items land in a final "Menu" pseudo-section; 404 if missing/inactive |

**Customer (`requireRole('customer')`):**
| Method Path | Behavior |
|---|---|
| `GET /cart` | Cart view (re-priced, availability-flagged) |
| `POST /cart/items` | Add (policy-enforced; 409 typed conflict) |
| `PUT /cart/items/:menuItemId` | Set quantity (0 removes; empty cart unbinds) |
| `DELETE /cart` | Explicit clear (204) |
| `GET /checkout/preview` | Bill + ETA + payment config + restaurant open state |
| `POST /orders` | Place (UPI-only; idempotent; 20/min/user) → 201 with Razorpay handoff |
| `POST /orders/:id/verify-payment` | Signature verify → `paid` (idempotent) |
| `GET /orders?page&limit` | Own orders, newest first (limit ≤ 50) |
| `DELETE /orders/:id` | Cancel while `pending_payment`/`paid` (+durable refund if paid) |

**Shared-auth:** `GET /orders/:id` (`authenticate` only) — access matrix: admin ∨ owning customer ∨ restaurant's seller ∨ assigned rider (profileId); includes items, full status history, ETA band. **(RC1 P1)** The response is PII-shaped by viewer role via `food-redact.ts`: sellers never receive customer contact, street, coordinates, `customerId`, or payment identifiers; riders never receive payment identifiers or `customerId`.

**Restaurant Mode (`requireRole('seller')`, all resolve ownership via `Restaurant.sellerUserId`):**
`GET /restaurant/me` (null ⇒ hide tab) · `GET /restaurant/orders?scope=today|history&page&limit` (pending_payment never shown; today = IST day; **RC1 P1:** explicit select returns only operational fields — bill triple, `deliveryLocality`, `receiverName`, status/reason/timestamps/items — never street, phone, coords, `customerId`, or payment ids) · `POST /restaurant/orders/:id/accept` (paid→confirmed, **RC1 P2:** fires the customer "confirmed" milestone push) · `.../reject` (paid|confirmed→cancelled + auto-refund + customer push) · `.../preparing` (confirmed→preparing) · `.../ready` (preparing→ready_for_pickup) · `PATCH /restaurant/open` (isOpen boolean) · `GET /restaurant/menu` (management view incl. sold-out) · `PATCH /restaurant/menu/:itemId` (isAvailable; ownership via scoped updateMany).

**Rider (`requireRole('rider')`, keyed on `auth.profileId`):**
`GET /rider/pickups` (available unclaimed-ready + mine-active; **RC1 P1:** the unclaimed pool carries only decision fields — restaurant, items, drop `deliveryLocality`, amount — while full drop address + receiver contact appear only on the rider's OWN claimed orders) · `POST /rider/orders/:id/claim` (CAS) · `.../picked-up` · `.../out-for-delivery` · `.../delivered` (**RC1 P2:** out-for-delivery and delivered fire customer milestone pushes).

**Admin:** `GET /admin/refunds` — refunds at `failed`, or `pending` stale >10 min.

**Background:** `food-reconcile` plugin (in-process interval, Redis-lock-elected) — rescue / expire / accept-timeout / refund-retry / **late-capture refund (RC1 P0)** (§7.4–7.5, §20).

## 11. Customer App Changes

**New files:** `screens/food/FoodScreen.tsx` (two-pane landing), `FoodCheckoutScreen.tsx`, `FoodOrderTrackingScreen.tsx`, `FoodOrdersScreen.tsx`, `foodTheme.ts` (tandoor-orange palette, veg/non-veg colors, card gradients); `components/food/FoodMenuItemCard.tsx`, `FoodConflictSheet.tsx`; `context/FoodCartContext.tsx`.
**Modified (additive only):** `AppNavigator.tsx` — `FoodCartProvider` wraps inside `CartProvider` (sibling layer; reads marketplace cart, never writes), `Food` tab in `TabParamList` + `MainTabs`, three stack routes (`FoodCheckout`, `FoodOrderTracking {foodOrderId, payment?}`, `FoodOrders`) with native headers, `FoodConflictSheet` mounted globally (renders only when a conflict is pending); `CustomTabBar.tsx` — one raised `FoodTab` in the Special design language.
**Shared components reused unchanged:** `RazorpayCheckout` (lazy-loaded webview UPI sheet), `AddressContext`, UI kit (Text/Shimmer/FauxGradient/RatingBadge/useToast), theme system.
**Cross-surface behavior:** the marketplace `CartDockPill` is **intentionally excluded** from the Food tab (`dockGeometry.ts`); the LiveOrderBubble (separate feature) rides on the Food tab but tracks **marketplace orders only**.
**i18n:** ~30 new `food.*` keys, en + hi, including the decided header copy and all conflict-sheet copy.
**api-client:** 11 typed food methods, isolated section; `packages/types` gains `dto/food.dto.ts` (exported additively).

## 12. Seller App Changes

**New:** `screens/restaurant/RestaurantOrdersScreen.tsx` (Restaurant Mode: today/history/menu scopes, accept/reject/preparing/ready, open-toggle, sold-out toggles, 15 s poll, Hindi labels, food-orange accents).
**Modified (additive):** `AppNavigator.tsx` — conditional **Restaurant** tab (🍽️), rendered only after `GET /food/restaurant/me` returns non-null (checked once per token; hidden on error — never flashes for grocery-only sellers); `services/api.service.ts` — 9 Restaurant-Mode methods + `MyRestaurant`/`RestaurantFoodOrder`/`RestaurantMenuItem` shapes.
**Untouched:** every existing seller screen (order queue, stock, settlement, profile) and all marketplace endpoints.

## 13. Rider App Changes

**New:** `screens/food/FoodPickupsScreen.tsx` — "PAID ✓" pool cards (restaurant, items, pickup/drop addresses, ₹, "cash NahiN lena"), claim button (losers get the taken-by-another-rider message and refresh), then picked-up → out-for-delivery → delivered progression; 15 s poll.
**Modified (additive):** `AppNavigator.tsx` — **Food** tab (🍔 "फूड") between Delivery and Earnings; `services/api.service.ts` — 5 food methods + `FoodPickup` shape.
**Untouched:** marketplace delivery flow, location publisher, COD collect, earnings.

## 14. Error Handling

- **Typed domain errors** (shared `app-errors`): `ValidationError` (400 Zod messages), `NotFoundError` (404 — also used to mask other restaurants' orders), `ForbiddenError` (403 ownership/role), `BusinessRuleError` (422 — closed restaurant, unavailable item, cart empty, illegal action-state, flag off, claim lost), `PaymentError` (mismatched Razorpay order id, invalid signature), `FoodCartConflictError` (**409** with code `FOOD_CART_DIFFERENT_RESTAURANT` + both restaurants in `details`).
- **User-facing messages are Hinglish** and action-guiding ("Order ka status badal gaya — refresh karein"; "Yeh order kisi aur rider ne le liya").
- **Lost CAS races** surface as `BusinessRuleError` (HTTP), never as silent success; same-status double-taps are **idempotent no-ops** inside the state machine.
- **Stale-cart races are 4xx, not 500 (RC1 P2):** a cart write racing order placement (which consumes the cart) hits Prisma P2025/P2003 — mapped to a clean `BusinessRuleError` ("Cart abhi update hua tha — dobara try karein") / `NotFoundError` instead of a raw 500 + Sentry noise; a zero-quantity delete whose row already vanished is treated as success (the desired end state holds).
- **Config failures fail open to defaults** (a mangled `food.config` row can never take Food down); **push failures are logged warnings** (never fail an order flow); **refund bookkeeping failures never mask the refund outcome**.
- **Client:** cart/order fetch failures keep last-known state (no blanking); optimistic stepper writes revert to server truth on failure; conflict is the only 409 given special UX; checkout Place Order surfaces API messages via alert; payment-sheet dismissal is a first-class path (tracking + Pay now), not an error.
- **Sweep:** per-order try/catch — one bad order can't stall the batch; overlap-guard within a process; Redis-lock election across processes.

## 15. State Machines

**FoodOrder.status** (`food-status.ts` — a deliberate scoped **copy** of the marketplace pattern, not an import; same vocabulary, own table):

```
pending_payment → paid → confirmed → preparing → ready_for_pickup
      → picked_up → out_for_delivery → delivered
every non-terminal state → cancelled          delivered/cancelled: terminal
```

Enforcement: `transitionFoodOrderStatus(tx, id, from, to, actor, extra)` — (1) `assertFoodTransition` rejects illegal jumps before any write (same-status = no-op true); (2) atomic CAS `updateMany WHERE id AND status=from` (count 0 ⇒ `false`, no history); (3) status timestamp stamped per target state, `cancelReason` on cancel; (4) history row (role, id, reason) — all inside the caller's transaction.

**Actor/status matrix (who may drive which hop):** customer: `pending_payment→paid` (verify), `pending_payment|paid→cancelled`; seller: `paid→confirmed`, `paid|confirmed→cancelled` (reject), `confirmed→preparing`, `preparing→ready_for_pickup`; rider: claim (not a status change), `ready_for_pickup→picked_up→out_for_delivery→delivered`; system (zero-UUID): sweep rescue `pending_payment→paid`, expiry/timeout `→cancelled`.

**refund_status:** `none → pending → processed | failed`, with `failed`→retry and stale-`pending`→retry by the sweep; converges at `processed` (or stays visible in `/admin/refunds`). **(RC1)** `skipped` is the terminal bookkeeping value when no money ever moved — unpaid cancels, and cancelled orders the late-capture job checked and found nothing captured on.

**FoodCart binding:** unbound → bound(restaurant) on first add; bound → unbound only via explicit clear, last-line removal, or order placement.

## 16. Edge Cases

**16.1 Handled (verified in code):**
- Double-tap Place Order → idempotency replay (cart-scoped key). Double-tap Accept/verify → idempotent no-op. Two riders claim at once → single CAS winner. Restaurant accepts at the same instant the sweep times out → whoever's CAS lands first wins; the loser sees count 0 and stands down.
- App killed mid-payment → order `pending_payment`; sweep rescues (captured) within ~2–3 min or expires (nothing captured) at 30 min; customer also has Pay now on tracking (when arriving from checkout).
- Refund attempt crashes mid-flight → visible as stale `pending`, retried; refund double-spend prevented by pre-checking Razorpay's refund list, and Razorpay itself rejects over-refunds as the final arbiter.
- **Money captured AFTER cancellation (RC1 P0):** customer's verify call arrives on a cancelled order → signature-checked, payment id recorded, immediate durable refund with an honest message; verify never arrives → the sweep's 48 h late-capture job CAS-claims the row and refunds. Both paths converge through `beginFoodRefund`'s pre-check — no double refund, no duplicate push, and never-captured rows terminate at `refundStatus='skipped'`.
- Stale cart prices → re-priced on every read; sold-out at checkout → blocked with the item named; restaurant closes/deactivates between cart and order → placement blocked; emptied cart on checkout screen → auto-navigate back.
- Concurrent different-restaurant adds → serialized by the unique cart row; conflict details always name both restaurants.
- Zero-menu restaurant → `menuAvailable:false` → "Menu coming soon" (deliberate: Rishivan-style pending onboarding).
- Marketplace regression: no marketplace code path reads food tables and vice versa; the 525 pre-existing tests still pass unmodified.

**16.2 Accepted gaps (implementation reality — review should confirm they're acceptable, not fix silently):**
- **Cancel-after-claim:** customer cancel is blocked from `confirmed` onward, but seller reject is impossible after `confirmed`→`preparing` starts; nothing cancels `ready_for_pickup`+ orders — a rider who claimed then vanishes leaves the order stuck in `picked_up`/`out_for_delivery` with **no un-claim, no reassignment, no timeout** past the accept window.
- **No restaurant-side cancel after preparing** (e.g., kitchen accident) — ops would need direct DB/state intervention.
- Food orders are **absent from the Home active-orders strip and the LiveOrderBubble** (both read the marketplace pipeline only): after leaving the Food surfaces, re-finding a live food order requires Food tab → receipt icon.
- **No sockets** anywhere in food (customer 10 s, seller/rider 15 s polling) — a new paid order reaches the restaurant by FCM push + next poll (≤15 s), not instantly; no alarm loop like the marketplace seller queue.
- History UI fetches page 1 only (API paginates; client doesn't page yet). Ratings render if present, but **no rating write path exists** (restaurants launch unrated: `ratingAverage` null → badge shows nothing).
- Receiver name/phone accepted by API, not collected by UI. `prepTimeMinutes` stored/returned, unused in any computation. `refundedPaise > 0` note on tracking is generic (no amount shown).
- Restaurant open/close is **binary + daily window**; no holiday schedule. `openTime < closeTime` assumed (no overnight-window support in `computeIsOpen` for food rows).

**16.3 Operational dependencies:**
- `PAYMENTS_ONLINE_ENABLED=true` + real Razorpay keys required before the first food order (currently false per marketplace COD-only decision). The sweep is inert until both hold.
- `db:seed:food` must run in the target environment (seed-guard blocks production — restaurant/menu rows need a production-safe insertion path: manual SQL/Prisma studio or a guarded ops script; none exists yet).
- Restaurant logins: each restaurant needs a seller-role user and `Restaurant.sellerUserId` set — **no admin endpoint exists to do the linking** (DB operation).

**16.4 Divergences from `Food.md` (implementation wins; documented, not judged):**
1. `Food.md` header still says "No feature code has been written" and "Rishivan menu image did not arrive" — **stale**: the module is fully implemented and Appendix A records the real Rishivan menu (received 2026-07-08) which **is** in the seed. One stale `RISHIVAN_MENU_PENDING` comment survives at `seed-food.ts:88` directly above the real menu.
2. Plan §6 said pickup uses "rider assignment (shared logic)" — implementation deliberately uses **self-claim pool + CAS**, not the dispatch/batching pipeline.
3. Plan sketch had `Restaurant.isOpen` default **false**, close 23:00 — migration defaults are `true` and 22:00.
4. Plan §8.4 mentioned reusing the checkout's "promo field" — no promo UI or promo logic exists in food checkout (consistent with §5's decided deltas).
5. Beyond-plan additions (launch hardening, marked P0-1…P0-4/P1 in code): reconcile sweep, durable refund tracking (2nd migration), food push notifications, restaurant self-serve open/close + sold-out, admin refunds view, verify-payment idempotency.

## 17. Security

- **AuthN/AuthZ:** every non-public route behind `authenticate` + role guard; ownership enforced in services — cart by `userId`; order detail by the 4-way matrix; restaurant actions re-resolve `sellerUserId` and check order ownership (foreign order → 404, no existence leak); menu toggles use restaurant-scoped `updateMany` (ownership + write in one statement); rider actions require `riderId === auth.profileId`; admin refunds behind `requireRole('admin')`.
- **Payment integrity:** amounts are server-computed from DB prices + config (client sends only ids/quantities); Razorpay signature is HMAC-verified server-side (shared, unit-pinned service); verify additionally binds the Razorpay order id to the food order; refunds go only to the original captured payment; the pre-check + Razorpay's own duplicate rejection prevent double-refunds.
- **Public surface** is read-only catalog (restaurants/menus) — same exposure class as the marketplace catalog.
- **Abuse limits:** order placement 20/min/user (verified-JWT bucket keys, platform-wide); quantity ≤ 20/line; list page-size ≤ 50; pool reads capped (20/10 batch in sweep).
- **Injection/data safety:** Prisma-parameterized throughout (no raw SQL in the module); Zod validation on every body/query; UUID params validated where parsed; address snapshot prevents later address edits from rewriting order destinations.
- **Secrets:** no new secrets, keys, or env vars introduced; Razorpay creds reused via the existing env schema; the refund-list call authenticates with the same Basic-auth pattern the codebase already uses for RazorpayX.
- **PII:** food orders snapshot address + optional receiver contact — same convention and exposure as marketplace orders; logs carry ids, not payloads.

## 18. Testing Requirements

**Exists now (all green — 564/564 total post-RC1, 68 files, marketplace suites unchanged):**
- `food-status.test.ts` (11): full-flow legality, cancel-from-every-non-terminal, skip/backward/terminal rejection, same-status no-op, CAS flip + timestamp + history, lost-race no-history, throw-before-write, cancelReason stamping, extraData merge.
- `food-redact.test.ts` (5, RC1 P1): customer/admin full passthrough, seller PII stripping (contact/address/coords/payment ids, operational fields kept), rider payment-id stripping (delivery fields kept), input non-mutation.
- `food-pricing.test.ts` (16): 0%-identity, percent/fixed/per-category/per-restaurant precedence, combine order, rounding + non-negative floor, boundary rejection; flat-fee bill, config-driven fee, invalid-line rejection; config merge semantics (garbage fallback, per-section override, non-integer fee rejection, cart-cap override, ops timing overrides).
- `food-cart-policy.test.ts` (7): bind-on-first-add, same-restaurant allow, A→B deny (typed reason), symmetry, cap-2 flip allows A→B, third-restaurant deny at cap 2, already-present allow at any cap.

**Required before/at review sign-off (gaps a Reviewer must weigh — none exist as code today):**
1. **Service-level tests** for `food-orders.service` (place/verify/cancel guards, restaurant action matrix, claim CAS, IST today-window) and `food-cart.service` (conflict path, re-pricing, unbind-on-empty) — the module's only current coverage is the three pure/CAS units.
2. **Reconcile sweep tests**: rescue/expire/timeout/retry branches, lock election no-op, flag-off inertness.
3. **Refund durability tests**: pre-check-covered path, createRefund failure → failed → retry convergence, unconfigured-Razorpay path.
4. **Smoke extension** (`scripts/smoke/run.mjs` currently has zero food coverage): with `PAYMENTS_ONLINE_ENABLED=true` + dev-mock gateway — browse → cart (conflict 409) → place → verify → accept → preparing → ready → claim → picked-up → out-for-delivery → delivered; reject-with-refund; forged-signature rejection; plus SQL invariants (`total = subtotal + fee`; cancelled+paid ⇒ refund converges; ≤1 rider per order).
5. **Regression gate re-run** (Food.md §4.2/§9): full marketplace suites byte-for-byte green next to the food module — currently true; must stay a merge condition.
6. **Manual device pass:** UPI sheet on a real Android build (success/dismiss/failure), conflict sheet UX, restaurant tab visibility for grocery-only vs restaurant sellers, rider claim race on two devices.

## 19. Definition of Done

The Food Module is DONE for launch when every line below holds:

1. All 27 `/api/v1/food/*` endpoints behave per §10 on a deployed build; typecheck + full unit suite green at the merge SHA (baseline 559/559).
2. The §18 test additions exist and pass (service-level, sweep, refund durability, food smoke leg), and the marketplace regression gate stays green with zero diffs.
3. One real end-to-end order on production hardware: UPI payment → restaurant accept → preparing → ready → rider claim → delivered — with the money verified in Razorpay and `food_order_status_history` complete; plus one reject-with-refund converging to `refund_status='processed'`.
4. Reconcile sweep observed live: a deliberately-unverified payment rescued; a never-accepted order auto-cancelled + refunded at 15 min; log lines (`🛟`, `⏱️`, `💸`) present in structured logs.
5. `PAYMENTS_ONLINE_ENABLED=true` decision recorded and configured (with marketplace COD posture explicitly re-confirmed), real Razorpay live keys, and `env:check` green.
6. Six restaurants + menus present in production data via a production-safe path (seed is dev-only), each restaurant's `sellerUserId` linked to a real seller login, provisional menus corrected at onboarding, Rishivan's stale `RISHIVAN_MENU_PENDING` comment and `Food.md`'s stale header resolved.
7. Restaurant Mode verified on each restaurant's real device (tab appears, push arrives on a paid order, accept within the 15-min window understood by the owner); rider Food tab verified on the fleet.
8. Ops signs off on: no-cancel-after-preparing, stuck-claimed-order manual procedure (§16.2), `GET /food/admin/refunds` checked in the daily ops calendar, and the food.config override path exercised once (e.g., fee change landing within 60 s).
9. i18n complete for every food string (en+hi), dark mode + both themes rendered, and the misplaced root `app.json`/`eas.json` question resolved (§Handoff → Review Checklist).
10. This document updated if the Reviewer/Builder change any behavior — the spec must keep matching the code.

## 20. Review Cycle 1 (RC1) — corrections as implemented (documented 2026-07-14)

**Provenance:** the Reviewer → Builder handoff package for RC1 was delivered in a prior session and **is not persisted in this repository — MISSING FROM SOURCE ARTIFACT.** The findings below are reconstructed from the `RC1` markers the implementing Builder left in code (grep `RC1` across the repo returns every site). Whether this is the *complete* RC1 findings list cannot be proven from the repo; the original package (or the Reviewer) must confirm. All listed corrections are implemented, verified, and covered by the post-RC1 verification run in the header.

| Finding | Severity | Behavior change | Where |
|---|---|---|---|
| Late UPI capture on a cancelled order strands money | **P0** | (a) `verify-payment` on a `cancelled` order with a valid signature records the payment id and immediately begins the durable refund (§7.3); (b) sweep job 5 back-checks cancelled orders (48 h) against Razorpay, CAS-claims (`refundStatus='none' ∧ razorpayPaymentId IS NULL`) and refunds captures, terminal-marks never-captured rows `skipped` (§7.4) | `food-orders.service.ts` verify path · `food-reconcile.plugin.ts` job 5 · `food-notify.ts` `notifyCustomerLateRefund` |
| Food order detail leaked PII/payment ids across roles | **P1** | Viewer-role PII window: order detail shaped by role (sellers: no contact/street/coords/customerId/payment ids; riders: no payment ids/customerId); restaurant order list moved to an explicit operational-fields select; rider unclaimed pool carries locality-only drop info, full address+contact only on own claimed orders | `food-redact.ts` (+5 tests) · `food-orders.service.ts` (`getOrder`, `listRestaurantOrders`, `listRiderPickups`) · rider/seller client shapes match |
| Cart-vs-placement race surfaced as raw 500s | **P2** | Prisma P2025/P2003 during cart writes map to clean 4xx (`BusinessRuleError`/`NotFoundError`); zero-quantity delete on an already-consumed cart treated as success (§14) | `food-cart.service.ts` `isStaleCartRace` |
| No customer push on order progression (marketplace parity) | **P2** | Milestone pushes at `confirmed` / `out_for_delivery` / `delivered` only (anti-fatigue); wired in accept + rider progression paths (§3) | `food-notify.ts` `notifyCustomerFoodMilestone` · `food-orders.service.ts` |
| Batch 3 refinements: duplicate side effects under races | **P0-adjacent** | Restaurant "new order" push gated on the verify CAS flip (no duplicate push on double-verify or verify-vs-rescue race); sweep late-capture payment-id stamp is a CAS claim (exactly one sweeper wins across PM2 even if the Redis lock is missed) | `food-orders.service.ts` §7.3 note · `food-reconcile.plugin.ts` job 5 |

**Invariants audit (post-RC1):** all ten §Invariants re-checked — status writes still exclusively via `transitionFoodOrderStatus` (the late-capture paths change refund bookkeeping only, never status); money still integer paise, full-amount refunds only; marketplace untouched (zero non-additive diff lines; 525 pre-Food tests byte-identical green).

**Known residue (not fixed, deliberately):** the reconcile boot log line still names four jobs (cosmetic); seller/rider apps remain outside the root `typecheck` pipeline (verified green by direct `tsc --noEmit` this session — wiring them in touches out-of-scope `package.json` files); §18 items 1–4 (service-level, sweep, refund-durability, smoke-leg tests) remain open test debt whose merge-blocking status is recorded in the missing RC1 package.

---
---

# ARCHITECT → REVIEWER HANDOFF PACKAGE

*Self-contained. Assumes the Reviewer has never seen Bringly.*

## Project Context

**Bringly** (repo `chirawa`, `~/Batman/chirawa`, branch `eng/p0-hardening`) is a production-grade hyperlocal commerce platform for Chirawa, Rajasthan (~80k people, 3 km radius): a Fastify 4 + Prisma 5 (PostgreSQL 15) + Redis 7 + BullMQ + Socket.io **modular-monolith API** and three Expo SDK 54 apps (customer, seller, rider), sharing `packages/{types,api-client,i18n}` (Hindi+English mandatory). The **marketplace** (groceries etc.) is launch-hardened (88/100 GO audit, 26/26 E2E) and **COD-only** by founder decision (`PAYMENTS_ONLINE_ENABLED=false`; Razorpay fully wired but gated). House rules: integer paise everywhere; one CAS enforcement point per invariant; fail-closed in production; additive guarded migrations; evidence over assertion; Conventional Commits; never touch `.env`; push to `main` auto-deploys so merges are deliberate. Baseline reference: `docs/PROJECT_BASELINE.md`.

## Food Module Context

The founder-approved design (`Food.md`, repo root — 13 sections + finalized decisions) mandated Food as an **isolated plug-in**: own tables, own cart, own pricing, own order pipeline, own `/food/*` APIs; marketplace byte-for-byte untouched; reuse limited to UI components and stable shared infra (auth, Razorpay create/verify/refund, FCM, `computeIsOpen`, idempotency utils). The module is now **fully implemented but uncommitted** in the working tree: API module `apps/api/src/modules/food/` (11 files + 3 test files), 2 additive migrations, seed, DTOs, api-client methods, i18n, customer Food tab/checkout/tracking/history, seller Restaurant Mode, rider Food pickups. The implementation went **beyond** the plan with launch hardening: a money-safety reconcile sweep, durable refund tracking, food push notifications, restaurant self-serve open/sold-out toggles, and an admin refunds view. The frozen as-built spec is `docs/FOOD_MODULE_SPEC.md` (this package's parent document).

## Business Rules

1. Six curated restaurants, manual rail order (Aura, Bits & Bites, Dark Park, Foodies, Goggle Cafe, Rishivan) — `displayOrder`, not alphabetical.
2. Flat **₹30** delivery fee (config `food.config`); **0% markup** at launch (engine supports %/fixed/per-restaurant/per-category via config only); no commission; no promos/discounts/tips in food.
3. **UPI-prepaid only**; COD shown as disabled "Coming Soon"; requires platform `PAYMENTS_ONLINE_ENABLED=true` + real Razorpay keys to sell anything.
4. **One restaurant per food order** (config cap = 1; raising it is the multi-restaurant switch). Food and marketplace never combine into one order.
5. Per-restaurant hours (seeded 11:00–22:00 IST) + self-serve `isOpen`; platform 9–20 marketplace hours do NOT govern food.
6. ETA is a config **band** (30–50 min), not computed per order.
7. Cancellation: customer until restaurant accepts (`pending_payment`/`paid`); restaurant reject until preparing; paid cancellations always fully refunded, durably (`refund_status` converges to `processed`).
8. Restaurant never sees unpaid orders; unaccepted paid orders auto-cancel + refund at 15 min; unpaid orders expire at 30 min (rescue-checked against Razorpay first).
9. Riders self-claim ready orders (first CAS wins); food is always prepaid — riders collect no cash.
10. All money integer paise; `total = itemsSubtotal + deliveryFee` exactly.

## Scope

**In scope for review** — every uncommitted food artifact:
- API: `apps/api/src/modules/food/**` (routes, orders/cart services, policy, pricing, config, status machine, refunds, reconcile plugin, notify, schema + 3 test files); `app.ts` (+3 lines: plugin + route mount); `apps/api/package.json` (`db:seed:food` script); `prisma/schema.prisma` (+216 additive lines); migrations `20260708000000_food_module`, `20260708100000_food_refund_tracking`; `prisma/seed-food.ts`.
- Packages: `packages/types/src/dto/food.dto.ts` (+index export); `packages/api-client/src/index.ts` (11 food methods); `packages/i18n/src/translations.ts` (`food.*` keys, en+hi).
- Customer app: `screens/food/*` (4 screens + theme), `components/food/*` (card + conflict sheet), `context/FoodCartContext.tsx`, additive edits to `AppNavigator.tsx`/`CustomTabBar.tsx`.
- Seller app: `screens/restaurant/RestaurantOrdersScreen.tsx`, additive edits to `AppNavigator.tsx` + `api.service.ts`.
- Rider app: `screens/food/FoodPickupsScreen.tsx`, additive edits to `AppNavigator.tsx` + `api.service.ts`.
- `Food.md` (design source — now partially stale; see Review Checklist).

## Out of Scope

**Adjacent uncommitted work sharing the same tree — do NOT review as Food, do NOT let it block the Food freeze:**
- **Live Order Bubble** (`Track_Order.md` spec): `LiveOrderBubble.tsx`, `LiveOrderDial.tsx`, `ActiveOrdersContext.tsx`, `liveOrder.ts(+test)`, `dockGeometry.ts`, `useReducedMotion.ts`, `analytics.service.ts(+test)`, `vitest.config.ts` + customer `package.json` test scripts, `useActiveOrders.ts` rework, `HomeScreen.tsx`/`CartDockPill.tsx` refactors — **marketplace orders only** (food orders deliberately absent from bubble/strip).
- Voice-search Expo Go guard (`useVoiceSearch.ts`, `SearchScreen.tsx`), recovery-service type annotation, `.env.example` host change, root `app.json`/`eas.json` (see checklist).
- **Future food phases (not built, not promised):** COD for food, promo codes, sockets/alarms, live rider map for food, ratings write-path, multi-restaurant checkout, restaurant self-serve menu CRUD/onboarding, delivery instructions/tips, invoices, per-order ETA.

## Database Summary

8 new tables (2 additive migrations; **zero ALTER on pre-existing tables**): `restaurants` (curated; per-row hours, `is_open`, `display_order`, loose `seller_user_id` link, rating fields unused-for-write) · `menu_categories` · `menu_items` (simple items: name/price-paise/image/veg/available; no variants) · `food_carts` (**one per user**, restaurant-bound) · `food_cart_items` (unique per menu item; `menu_item_id` FK RESTRICT) · `food_orders` (address snapshot, integer-paise bill triple, status VarChar + per-status timestamps, `payment_method` def 'upi', razorpay order/payment/refund ids, `refund_status` def 'none', `rider_id` = RiderProfile id no-FK, `cancel_reason`) · `food_order_items` (name/price snapshots) · `food_order_status_history` (role + actor id NOT NULL; system = zero-UUID). Config in existing `AppConfig` under `food.config`. Seed: idempotent, seed-guarded, 6 restaurants, 1 real + 5 provisional menus.

## APIs

27 endpoints under `/api/v1/food` (full table: spec §10): 2 public catalog · 9 customer (cart CRUD, preview, place [idempotent, 20/min], verify-payment, list, detail, cancel) · 9 seller Restaurant-Mode (me, orders today/history, accept/reject/preparing/ready, open-toggle, menu view, item availability) · 5 rider (pickups, claim, picked-up, out-for-delivery, delivered) · 1 admin (refunds needing attention) · plus the in-API `food-reconcile` background sweep (rescue/expire/accept-timeout/refund-retry; Redis-lock elected; CAS-safe regardless). Error contract: shared AppError family; the one special code is 409 `FOOD_CART_DIFFERENT_RESTAURANT` with both restaurants in `details`.

## Dependencies

- **Shared infra reused unchanged (verify no behavioral drift):** `razorpay.service` (`createRazorpayOrder`, `verifyPaymentSignature`, `createRefund`, `fetchPaymentsByOrderId`, `isRazorpayConfigured` — all pre-existing), `onlinePaymentsEnabled()` flag reader, `computeIsOpen` (catalog), `authenticate`/`requireRole`, `perUserRateLimit`, `runIdempotent`/`readIdempotencyKey`, `fcm.service.sendPush` + Redis `fcm:token:<userId>`, `AppConfig` table, shared logger, `app-errors`; client: `RazorpayCheckout` component, `AddressContext`, UI kit, theme.
- **New runtime dependency: none** (no new npm package server-side; customer app adds only dev-deps `vitest` — from the adjacent bubble work, not food).
- **Operational dependencies:** `PAYMENTS_ONLINE_ENABLED=true` + live Razorpay keys before first sale; production-safe restaurant/menu insertion path (seed refuses prod); seller users linked to restaurants (manual DB op — no endpoint); FCM configured for pushes (degrades to log-only otherwise).
- **One direct external call added:** `GET https://api.razorpay.com/v1/payments/:id/refunds` (Basic auth, same pattern as existing RazorpayX calls) inside `food-refunds.ts`.

## Files Expected To Change

For this freeze: **none** (documentation exercise). For the Builder who lands review findings, the expected change-surface is exactly the in-scope file list above; findings must stay inside it. Anything requiring a marketplace file/table/service to change is out of contract and must come back to the Architect. When committing, keep Food separable from the adjacent bubble/voice work (distinct commits; suggested order: schema+API, packages, customer, seller, rider, docs).

## Invariants (must hold after any change)

1. Marketplace behavior is byte-for-byte unchanged: no marketplace table/enum altered; no marketplace service/route/screen edited beyond the additive registrations; pre-Food test suite passes unmodified (525 of today's 559).
2. All food money is integer paise; `total = itemsSubtotal + deliveryFee`; amounts server-derived; full-amount refunds only.
3. Every `FoodOrder.status` write goes through `transitionFoodOrderStatus` (assert → CAS → history) — no direct status updates anywhere.
4. A cancelled paid order always converges to `refund_status='processed'` (sweep retries; admin visibility meanwhile); refunds never double-spend (Razorpay list pre-check + provider rejection).
5. One food cart per user; one restaurant per cart (at cap 1); binding clears only by explicit clear / last-line removal / placement.
6. Restaurants never see `pending_payment` orders; customers see only their own orders; sellers only their restaurant's; riders only claimable/claimed ones (404 masking, not 403 leaks, for foreign restaurant orders).
7. At most one rider per food order (claim CAS); claimed orders only move forward.
8. Food never blocks on push/notify/config failures (best-effort + defaults); the reconcile sweep is inert unless online payments are enabled and Razorpay is configured.
9. UPI is the only payment method that can reach the database (`payment_method='upi'` always).
10. Every user-facing string exists in en + hi via `packages/i18n`.

## Edge Cases (reviewer-relevant; full list spec §16)

Handled: double-tap placement/accept/verify idempotency; claim races; app-killed-mid-payment (rescue/expiry/Pay-now); refund crash-retry without double-refund; stale prices re-priced on read; sold-out and closed-restaurant gates at placement; conflict-sheet race serialization; empty-menu "coming soon".
**Accepted gaps to confirm consciously:** no cancel/reassign path after rider claim (stuck-order = manual ops); no restaurant cancel after preparing; food orders absent from Home strip/LiveOrderBubble; polling-only (no sockets/alarm) with ≤15 s seller latency; history UI shows page 1 only; ratings displayed but never writable; receiver fields accepted by API, not collected by UI; `Food.md` header + `seed-food.ts:88` carry stale "Rishivan pending" markers though the real menu is seeded.

## Review Checklist

1. **Isolation proof:** `git diff` shows zero non-additive lines in marketplace modules; migrations contain no ALTER of pre-existing tables; grep confirms no marketplace service imports food code and no food code writes marketplace tables (`recovery.service.ts` diff is an unrelated type annotation).
2. **Money paths:** place-order ordering (Razorpay-first, orphan-safe), verify signature + order-id binding + idempotency, refund pre-check/create/retry state machine, sweep CAS discipline, admin visibility. Confirm the direct refund-list REST call is acceptable vs extending `razorpay.service`.
3. **State machine:** transition table completeness; every caller checks from-status before transitioning; lost-CAS surfaces as user-facing "refresh" errors; zero-UUID system actor acceptable for history NOT NULL.
4. **AuthZ matrix:** run the §10 table against the guards; specifically try foreign-restaurant order ids (expect 404), other users' carts/orders (403/404), rider actions on unclaimed/foreign orders.
5. **Policy:** conflict 409 shape vs client sheet expectations; concurrent-add serialization argument (unique userId row) holds under Prisma's default isolation.
6. **Config:** `food.config` override merge (garbage-tolerant), 60 s cache staleness acceptable, ops timings sane (120 s sweep / 180 s min-age / 30 min expiry / 15 min accept).
7. **Client flows:** checkout disabled-states (closed/pending-mutations/preview-missing), dismiss-payment → tracking + Pay now, cart-emptied auto-back, conflict sheet actions, seller tab conditional render (no flash), rider claim-loss refresh.
8. **Gaps sign-off:** §16.2 accepted-gaps list — each needs an explicit "accept for launch" or a filed follow-up, not silence. Highest operational risk: stuck claimed orders + no post-preparing cancel.
9. **Test debt:** §18 items 1–4 (service tests, sweep tests, refund tests, smoke leg) — decide which are merge-blocking vs fast-follow.
10. **Hygiene anomalies:** root-level `app.json`/`eas.json` (customer EAS config with package `in.bringly.customer` sitting at repo root — likely misplaced; also note the `in.bringly.*` vs `com.chirawa.*` package-id split); stale `Food.md` header/blocker note and `seed-food.ts:88` comment; `.env.example` LAN-IP churn riding in the same tree.
11. **Verification evidence at review time:** typecheck all workspaces green; 559/559 API tests; re-run both after any fix.

## Builder Constraints

1. **Do not redesign.** Fix findings within the frozen architecture: isolated module, UPI-only, self-claim delivery, config-driven numbers, no marketplace edits. Architecture changes return to the Architect.
2. **Never** modify marketplace tables/services/screens or alter existing enums; new schema needs stay additive and food-scoped.
3. All status writes via `transitionFoodOrderStatus`; all business numbers via `FoodConfig`; all new strings via `packages/i18n` (en+hi); integer paise only.
4. Follow `apps/api/CLAUDE.md`: consult Context7 docs for the pinned majors (Fastify 4, Prisma 5, BullMQ 5, Socket.IO 4, Razorpay node SDK) before writing backend code; Expo work per SDK 54 docs.
5. Keep Food commits separable from the adjacent Live-Order-Bubble/voice-search work; Conventional Commits; one concern per commit; never stage `.env`.
6. Merge gates: typecheck green, full suite green (559 baseline + any new tests), marketplace regression suite untouched-and-green, this spec updated to match any behavioral change. Remember `main` auto-deploys — coordinate the merge with the operational flag decision (`PAYMENTS_ONLINE_ENABLED`).
7. Prisma migration handling: the two food migrations are already written; do not squash, reorder, or edit them — follow-ups get new additive migrations behind the backup guard.
