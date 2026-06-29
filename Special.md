# Special Page Redesign Plan

## Current state

The current `Special` tab is a premium header plus a reused horizontal carousel from the home page:

- `apps/customer-app/src/screens/categories/ChirawaSpecialScreen.tsx`
- `apps/customer-app/src/screens/home/ChirawaSpecialSection.tsx`

Today it reuses `ChirawaSpecialSection`, which shows featured shops as a horizontal carousel. This is good for the home page, but the dedicated Special page should feel more like a proper shop discovery surface.

## Goal

Redesign the `Special` tab into a vertical, aesthetic shop directory:

- Show featured shops as **2 columns × 6 rows** per page.
- Scroll vertically for more shops.
- Keep the premium “Chirawa’s Special” identity with Bringly orange/deep-red styling.
- Each shop tile should open `ShopDetailScreen`.
- Keep the existing `Add your local shop` CTA as the final tile.

## Proposed layout

### Header

Keep the current premium header, but make it slightly more polished:

- Title: `Chirawa's Special ✨`
- Subtitle: `The legendary tastes of our town`
- Deep-red background using `Colors.specialAccent`
- Optional small pill: `Local Legends` or `Featured shops`

The header should remain consistent with the existing brand language and not need new i18n keys.

### Shop grid

Replace the horizontal carousel with a responsive 2-column vertical grid.

Recommended behavior:

- 2 columns on normal phone widths.
- Cards fill the available width with a small gap.
- Each card has a tall, vertical tile shape.
- Top visual area: emoji / icon / gradient.
- Middle: shop name, famous-for text, delivery time.
- Bottom: rating / open status / `Order Now →`.

This will make the page feel like a curated marketplace rather than a home-page section.

### Card style

Each shop tile should look premium and tactile:

- Rounded corners using `Radius.lg` or `Radius.xl`.
- Soft shadow using existing `Shadow.md` / `Shadow.special`.
- Warm gradient top band instead of flat color.
- Emoji/icon centered in the top band.
- Badge like `Local Legend`.
- `Open now` / `Closed` chip.
- `Order Now →` CTA at the bottom.

For fallback visuals, we can continue deriving emoji from shop names, similar to the existing carousel:

- mithai / sweet / halwai → `🍬`
- saag / roti / dhaba / bhojan → `🍛`
- fresh / mart / veg / fruit → `🥬`
- default → `🏪`

## Data source

Use the existing featured-shop API path:

- `GET /api/v1/catalog/specials` through `api.getSpecials()`
- or `GET /api/v1/catalog/shops` + filter `isFeatured`

The current home carousel uses `fetchShops()` and filters `isFeatured`. For consistency, the first implementation should also use `fetchShops()` and filter `isFeatured`.

This avoids backend changes for now.

If `api.getSpecials()` returns a better featured-only response later, we can switch the page to that endpoint without changing the UI.

## Files likely to change

### Primary file

- `apps/customer-app/src/screens/categories/ChirawaSpecialScreen.tsx`

This should become the dedicated Special shop grid screen instead of reusing the home carousel.

### Optional shared helper

If the shop-card UI becomes useful elsewhere, we can extract it later. For now, keep it inside the Special screen to avoid unnecessary abstraction.

### No backend changes planned initially

The requested change is UI/layout focused.

## Implementation approach

1. Remove `ChirawaSpecialSection` usage from `ChirawaSpecialScreen`.
2. Add local loading/error/empty states.
3. Fetch featured shops using `fetchShops()`.
4. Render a vertical `ScrollView`.
5. Render a 2-column grid using `FlatList` with `numColumns={2}` or a `ScrollView` + wrapped rows.
6. Build a dedicated `SpecialShopCard` component inside the screen.
7. Keep the `Add your local shop` card as the final tile.
8. Typecheck the customer app.

## Proposed responsive grid sizing

For a 2-column grid:

- Horizontal padding: `Spacing.lg`
- Gap: `Spacing.md`
- Card width: `(screenWidth - horizontalPadding*2 - gap) / 2`
- Card height: around `210–240` depending on content.

This should match the user request: “multiple vertical tiles like 2 by 6 on a page then it should get scrolled down for more shops.”

## Empty/loading states

- Loading: show a 2-column skeleton or centered spinner.
- Empty: show a soft empty state with text like `No special shops yet`.
- Error: show a retry button.

This keeps the page robust if the API fails.

## Aesthetic direction

The page should feel like a curated local marketplace:

- Warm cream background.
- Deep-red hero header.
- Orange accents.
- Clean vertical cards.
- Slight elevation.
- Minimal clutter.
- Strong tap targets.

## Acceptance criteria

- Special page no longer shows the horizontal home carousel.
- Featured shops appear in a vertical 2-column grid.
- Page scrolls down for more shops.
- Each shop tile opens the shop detail page.
- The page looks polished and consistent with existing Bringly styling.
- Loading/error/empty states are handled.
- Customer app typecheck passes.

## Open decisions before implementation

1. Should the grid be implemented with `FlatList` or `ScrollView` + manual rows?
   - Recommendation: `FlatList` with `numColumns={2}` for cleaner virtualization and spacing.
2. Should the final “Add your local shop” tile span both columns?
   - Recommendation: yes, it will look more like a CTA and feel intentional.
3. Should we use `api.getSpecials()` or `fetchShops().filter(isFeatured)`?
   - Recommendation: use `fetchShops().filter(isFeatured)` first because it matches current code and avoids backend dependency.

---

# Round 2 — service-hours status, 20-min ETA, clean header, shop two-pane, contact banner (✅ DONE)

Five changes from the latest review. Goal: make Special feel like a polished
big-tech marketplace surface — functional, optimized, aesthetic — with no new
attack surface (the backend stays authoritative for service hours + orders).

> No web research needed — every piece mirrors patterns already in the repo
> (`operatingHours`/`useStoreClosed`, the v4 two-pane `CategoryProductsScreen`,
> `ProductCard`'s `cardWidth`).

## R2.1 — Open/Closed driven by APP service timings (not per-shop)
**Now:** `SpecialShopCard` shows `shop.isCurrentlyOpen ? Open : Closed`
(`ChirawaSpecialScreen.tsx:98,103`) — a per-shop flag.
**Change:** drive it from the **app service window** so every Special shop shows
**Open** while the app is servicing and **Closed** otherwise — consistent with the
global `ClosedBanner`.
- Single source: `operatingHours.isOpenNow()` (09:00–20:00 IST) / the existing
  `useStoreClosed()` already read as `closed` at line 214.
- Compute once in the screen (`const serviceOpen = !closed`) and pass
  `open={serviceOpen}` into each `SpecialShopCard`; the card's chip + icon read it.
- Backend is unchanged and remains the real gate (it rejects out-of-hours orders);
  this is display only. Re-checks on the existing 60s `useStoreClosed` tick.

## R2.2 — 20-minute delivery (was 30)
**Now:** card copy = `${shop.estimatedDeliveryMinutes} min delivery`
(`ChirawaSpecialScreen.tsx:63`); shops are seeded at 30.
**Change:** show **20 min**. Two clean ways — pick one (decision below):
- **(a) Display constant (Special-only, zero backend):** add
  `DELIVERY_ETA_MIN = 20` and render `${DELIVERY_ETA_MIN} min delivery`. Fast,
  reversible, scoped to this page.
- **(b) Data/source-of-truth (app-wide):** set `estimatedDeliveryMinutes = 20` in
  the seed (`apps/api/prisma/seeds/shops.ts`) + reseed → propagates to the home
  header and shop cards everywhere. More consistent, but a data migration.
- **Recommendation:** (a) now for the Special page; (b) later if you want 20 min
  reflected app-wide. (The Home header ETA already reads its own value — confirm
  it should match.)

## R2.3 — Remove the sparkle + clean the whole page
**Now:** header eyebrow renders `<Ionicons name="sparkles" />`
(`ChirawaSpecialScreen.tsx:267`) before "Local Legends".
**Change:**
- **Remove the sparkle icon** from the eyebrow (keep/curate the "Local Legends"
  pill text, or drop the pill entirely for a cleaner look — decision below).
- **Aesthetic polish pass** (big-tech-clean, minimal): tighten header
  type-scale + spacing; calmer deep-red hero (no emoji clutter); consistent card
  radius/shadow tokens (`Radius.lg`, `Shadow.sm`); even 2-col gutters; refined
  Open/Closed chip; remove the second decorative `sparkles-outline` in the empty
  state for a neutral icon. Net: fewer ornaments, more whitespace, crisp hierarchy.

## R2.4 — Shop page → two-pane like Categories
**Now:** `ShopDetailScreen.tsx` (731 lines) = one shop's products in an
`N`-column `FlatList` with its own header.
**Change:** rebuild it as the **two-pane** layout (mirror the v4
`CategoryProductsScreen` already on `main`):
- **Left rail (≈88px, vertical scroll):** all shops (avatar/emoji + name); the
  open shop is highlighted (tinted pill + accent bar + bold), exactly like the
  sub-category rail. Tapping a shop swaps the right pane — no navigation.
- **Right pane:** the selected shop's items in a **2-column grid** of `ProductCard`
  (reuse the `cardWidth` prop; `CARD_W = (SCREEN_W − RAIL_W − pad − gap)/2`).
- **Data:** `fetchShops()` powers the rail; `api.getShop(shopId)` returns the
  selected shop + its products for the grid. **Per-shop cache** (a `Map`) so
  re-tapping a rail shop is instant; right-pane shimmer while a shop loads;
  "No items yet" empty state; scroll resets per shop.
- Keep the shop name as the header/title; keep the cart affordance. Open/Closed +
  delivery follow R2.1/R2.2.
- This makes "open a shop → browse + hop between shops" feel like the category
  surface, as requested.

## R2.5 — Replace "Add your local shop" with a non-interactive contact banner
**Now:** an interactive CTA card (`onPress`, chevron) using `home.addShopName` /
`home.addShopDesc` (`ChirawaSpecialScreen.tsx:180–204`).
**Change:** remove the tappable card; add a **static, non-interactive banner** at
the bottom of the grid — informational only ("not something a user can play
with"):
- Soft card, storefront icon, message like **"Want your shop featured here? Get
  your shop added by contacting us."** / **"You can also highlight your shop in
  Chirawa's Special."** No `onPress`, no chevron, no link.
- New i18n keys (`special.contactTitle` / `special.contactDesc`); stop using the
  `addShop*` keys here.

## Files Round 2 will touch
- `screens/categories/ChirawaSpecialScreen.tsx` (R2.1, R2.2, R2.3, R2.5)
- `screens/shop/ShopDetailScreen.tsx` (R2.4 — two-pane rewrite)
- `packages/i18n/src/translations.ts` (contact-banner strings; maybe ETA)
- *(only if 20-min app-wide)* `apps/api/prisma/seeds/shops.ts` + reseed

## Security / robustness
- No new endpoints or inputs → **no new attack surface**. Service-hours status is
  display-only; the backend already rejects out-of-hours orders (authoritative).
- The contact banner is static text (no user input, no deep link) → nothing to
  inject or abuse.
- Reuse existing fail-soft loading/empty/error states; the two-pane caches and
  cancels stale loads (no leaks), same as the category screen.

## Decisions before building Round 2
1. **20-min scope:** Special-page display constant (a), or app-wide via seed (b)?
2. **Header pill:** keep "Local Legends" text (sans sparkle), or drop the eyebrow
   pill entirely for a cleaner header?
3. **Shop rail contents:** show **all** shops, or only **featured/Special** shops?
4. **Contact banner:** truly static (recommended, per your note), or may it be
   tappable-to-WhatsApp later?
