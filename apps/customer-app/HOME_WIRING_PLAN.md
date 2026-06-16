# 🏠 Home Screen — Blinkit-Density Overhaul, Chirawa-Skinned (Wiring Blueprint)

> **Mission:** rebuild the customer-app Home screen to match Blinkit's **structural
> density and card composition** (per `/ss/*.jpeg`), powered by the Catalog Engine's
> aggregated feed (`GET /catalog/feed`) — while **strictly keeping Chirawa's existing
> visual identity** (cream bg, orange highlights, maroon actions, midnight/space night theme).
>
> **Guardrails:** Home only. **No backend edits. No touching the 206 green API tests.**
> Inherit Blinkit's *geometry*, never its *colors*. This doc maps every file diff and
> every data dependency; **no code is written until it's approved.**
>
> **Companion:** `CATALOG_ENGINE.md` (Phase 4 = the aggregated feed) · `HomeScreen.tsx`.

---

## 0. 🎨 Theme guardrail (the non-negotiable)

| Blinkit (reference only — DO NOT copy) | Chirawa token we use instead |
|---|---|
| Yellow header / page bg | `Colors.background #FFF5EE` (warm cream) + night gradient when closed |
| Green brand / green ADD / green cart bar | `Colors.primary #FF6B35` (orange) for ADD & accents; `Colors.specialAccent #C4383A` (maroon) reserved for ribbons/Special |
| Green "veg" square, grey chips | Keep our existing veg dot + `Colors.surfaceAlt`/`primaryLight` chips |
| Flat white cards | Our `Colors.surface` cards + `Shadow.sm`, `Radius.lg` |

We replicate **layout geometry, grid density, and card anatomy** only. Every pixel is painted
from `src/theme/index.ts` tokens — **zero new hex literals in screens.**

---

## 1. 🔬 What the screenshots actually encode (structure decode)

| SS file | Structure to inherit |
|---|---|
| `20.33.51` | **Bestsellers** — 3-col cards: **one clean category image** + 2-line name on a light tile. *(Chirawa adjustment: no 4-quadrant clusters, no "+N more" counts — realistic small inventory, kept honest & lightweight.)* |
| `20.33.52`, `.52(1)` | **Category grids** — 4-col tiles, real product image per tile, 2-line label; stacked themed groups (Grocery & Kitchen / Snacks / Beauty / Household) |
| `20.33.52(2)`, `.52(3)`, `.53*`, `.54*` | **Dense product shelves** — 3-col cards: image (+heart, +veg, +carousel dots, +pack-size overlay, +ADD overlay w/ "N options"), bold ₹price + strikethrough MRP + discount ribbon, 2-line title, ★rating chip, ⏱"10 mins", "See more like this" |
| all | **Persistent floating cart capsule** above the tab bar (thumb stack + "View cart • N items" + chevron) |

---

## 2. 🧮 Data-reality matrix — the heart of this plan

`GET /catalog/feed → AggTile[]`:
`{ masterId, productId, name, imageUrl, pricePaise, mrpPaise, unit, brand, shopCount }`.

Every card element below is graded against what the backend **actually** gives. **We never
fabricate data** (fake ratings/badges = a trust + data-integrity defect, and the user sees
through it). Anything ❌ is omitted for v1 or implemented client-only, and noted as a backend
follow-up.

| Card element (from SS) | Source | Verdict |
|---|---|---|
| Product image | `AggTile.imageUrl` (R2 WebP) | ✅ |
| Carousel dots | feed gives **1** image/tile | ⚪ dots only render when >1 → effectively single image on Home (no fake dots) |
| Pack size ("38.5 g") | `AggTile.unit` | ✅ |
| Current price ("₹30") | `AggTile.pricePaise` (lowest in town) | ✅ |
| Strikethrough MRP ("₹40") | `AggTile.mrpPaise` | ✅ |
| Discount ("12% OFF" / "Price Drop") | computed `(mrp−price)/mrp` | ✅ skinned orange/maroon |
| 2-line title | `AggTile.name` (canonical) | ✅ |
| **ADD** → cart | `AggTile.productId` → `CartContext` | ✅ |
| Stepper (− N +) | `quantities[productId]` | ✅ existing |
| "⏱ 10 mins" | global delivery ETA (config/`operatingHours`) — **not per-product** | ✅ static, honest |
| `shopCount` ("best price in town") | `AggTile.shopCount` | ✅ optional microcopy — **keeps shop hidden** (count only, never names) |
| ❤️ Favorite heart | **no wishlist backend** | ❌ DEFER → optional **local-only** AsyncStorage wishlist (no server), or hide for v1 |
| Veg / non-veg dot | **no flag on AggTile** | ⚪ default to veg (existing card behavior); real flag = backend follow-up |
| ★ Rating ("3.8 lac") | **not in feed** (ratings are per-shop/internal; feed hides shops) | ❌ **OMIT — never fabricate** |
| "N options" on ADD | **no variant count in feed** | ❌ OMIT (future: master pack-size variants) |
| "❄️ Chilled" | **no temperature field** | ❌ OMIT (future: category-derived tag) |
| "See more like this" | needs category; feed has none | ⚪ optional → wire to Search, or defer |
| **Bestsellers / category card image** | `getCategories().imageUrl` (one image) or category emoji/icon | ✅ single clean image/icon — **no clusters, no counts** (no fabricated inventory size) |
| Category-grid tile image | `getCategories().imageUrl` (or `fetchProducts limit:1`) | ✅ |

> **Why category-themed product shelves ("Sweet Tooth", "Cold Drinks") aren't 1:1:** the feed
> is a *flat* list with **no category** on a tile, so it can't be sliced into per-category
> shelves client-side. We get the **same dense look** by rendering the feed as one big
> **"Best Prices in Chirawa"** dense grid (below), and keep category *browse* via the grids.
> Making category shelves feed-powered needs an additive `categoryName` on `AggTile`
> (backend follow-up — out of scope here, may touch `aggregation.service.test.ts`).

---

## 3. 🏗️ Target Home architecture (component tree + virtualization)

Pinned (outside the scroller, premium feel preserved):
```
<Header/>      ETA + tappable address (LocationSheet) + avatar   ← unchanged, night-aware
<SearchBar/>   rotating placeholder → navigate('Search')          ← unchanged
```
The scroller becomes **one root `FlatList numColumns={3}`** whose `data` is the **feed grid**
(the heavy, image-dense part → virtualized). Everything lighter rides in `ListHeaderComponent`:
```
<FlatList
  numColumns={3}
  data={feedTiles}                         // ← "Best Prices in Chirawa" dense grid
  renderItem={ProductCard size="dense"}    // memoized
  ListHeaderComponent={
    {closed && <ClosedBanner/>}            // night card
    <ForYouFeedShelf/>                      // horizontal feed swiper (NO pills)
    <BestsellersSection/>                   // 3-col, single category image + name (no counts)
    <CategorySections/>                     // 4-col category grids (existing)
    <SectionTitle "Best Prices in Chirawa"/>
  }
  ListFooterComponent={<Spacer/>}
  + perf props (see §6)
/>
<CartDockPill/>   // already global in AppNavigator — unchanged
```
**Why this shape:** the bounded sections (bestsellers ≈ 6 cards, category grids) live in the
header; the **unbounded, image-heavy feed grid is the virtualized list itself** — no
`VirtualizedList-inside-ScrollView` nesting warning, real 60 FPS under image density.

---

## 4. 🃏 The dense ProductCard — extend, don't fork

`src/components/product/ProductCard.tsx` already owns: cart wiring (`useCart`), fly-to-cart,
ADD↔stepper morph, image carousel, price/MRP/OFF, veg dot. We **extend it additively** with a
`size="dense"` + optional props so **no existing call site breaks**:

```ts
interface ProductCardData {            // unchanged — dense reuses existing fields
  …existing…
}
// new optional props on the component:
size?: 'regular' | 'compact' | 'dense';
disabled?: boolean;                    // closed-store → ADD greyed + toast
showEta?: boolean;                     // "⏱ 10 mins" chip
```
Dense layout (skinned): pack-size overlays image bottom-left; **ADD (orange, rounded)** overlays
image bottom-right; below: bold `Colors.textPrimary` price + strikethrough MRP + **maroon "X%
OFF" ribbon**; 2-line title; optional ⏱ chip. **No fake ratings/options/heart.** Disabled state
(closed) → ADD shows `Colors.disabled`, tap → `toast('home.closedReopen')`.

---

## 5. 🛒 Cart interaction (unchanged contract — confirmed)

1. Dense ADD → `useCart().addItem({ productId: tile.productId, name, imageUrl })`.
2. → `api.addToCart({ productId, quantity:1 })` → `POST /cart/items`.
3. **Backend auto-derives the master linkage** on the cart line (`cart.service.ts`); the
   Phase-5 resolver re-routes to the concrete lowest-price in-stock shop at checkout.

✅ **No `CartContext` change.** The mapper just needs `tile.productId` in `ProductCardData`.
Quantity keying stays `quantities[productId]` (no variant) — exactly right for aggregated tiles.

---

## 6. ⚡ Performance plan (zero drift, 60 FPS)

- **Root `FlatList`** (not `ScrollView`) for the feed grid: `numColumns={3}`,
  `initialNumToRender={9}`, `maxToRenderPerBatch={9}`, `windowSize={7}`,
  `removeClippedSubviews`, stable `keyExtractor={t => t.productId}`, memoized `renderItem`.
- **`ProductCard` wrapped in `React.memo`** + `useCallback`'d handlers so a cart tick re-renders
  only the touched card (cart qty is read per-card from context — keep selectors tight).
- **Horizontal `ForYouFeedShelf`** = a bounded horizontal `FlatList` (≤12 tiles), lazy.
- **Images:** RN `Image` with explicit width/height + `resizeMode="contain"` (current). 
  **Recommended optional add:** `expo-image` (SDK 54 module — not yet installed) for disk/mem
  caching + `recyclingKey` under high density. Gated on reading the Expo 54 docs per
  `AGENTS.md`; flagged as a separate, optional perf PR (not required for v1).
- **One feed fetch** on mount + on focus (guarded) + pull-to-refresh; the endpoint is already
  Redis-cached server-side, so no refetch storms.

---

## 7. 🔒 Security & data-integrity review (the "no breach" bar)

| Risk | Status |
|---|---|
| **Shop-identity leak** via feed | ✅ `AggTile` carries **no** `shopId`/`sellerId`/per-shop price — only canonical name/image/lowest-price/`shopCount`. Illusion holds; nothing private exposed. |
| **PII on Home** | ✅ none — feed is public/anonymous; address/name come from the already-authed `/users/me` paths. |
| **Auth on cart writes** | ✅ Home renders only inside the authenticated stack (`MainTabs`); ADD always carries a token. 401 → existing refresh/sign-out path. |
| **Price tampering** (stale feed) | ✅ resolver re-validates stock+price at checkout within tolerance — a stale low price can't underpay. |
| **Image safety** | ✅ R2 HTTPS, EXIF-stripped WebP, immutable cache headers — no hotlinking. |
| **Fabricated metrics** | ✅ avoided — no fake ratings/review counts (§2). Integrity > pixel-parity. |
| **Input surface** | ✅ Home search is navigation-only; no free-text injection on Home. |
| **Closed-store writes** | ✅ ADD disabled when `useStoreClosed()`; checkout already blocks ordering out-of-hours. |

---

## 8. 📂 File-by-file diff map

| File | Change | Risk |
|---|---|---|
| `src/services/catalog.ts` | **+** `AggTile` type, **+** `toFeedCard()` + `fetchFeed(): ProductCardData[]` mapper | low / additive |
| `src/components/product/ProductCard.tsx` | **+** `size:'dense'`, **+** optional `disabled`/`showEta`/`shopCount`; dense layout block | medium — additive props, existing sizes untouched |
| `src/screens/home/HomeScreen.tsx` | restructure `ScrollView` → root `FlatList numColumns=3` + `ListHeaderComponent`; fetch feed; thread `closed` | medium — main layout change |
| `src/screens/home/ForYouFeedShelf.tsx` | **NEW** — flat horizontal feed swiper (no pills) | low |
| `src/screens/home/BestsellersSection.tsx` | simplify (already 3-col + image): **remove** the count text; single category image + name; wire into Home | low — reuse existing |
| `src/screens/home/CategorySections.tsx` | *(optional)* swap emoji → real category image (keep emoji fallback) | low / optional |
| `src/screens/home/ProductCarouselSection.tsx` | **retire from Home** (pills removed); left in repo or deleted | low |

**Untouched:** `CartContext`, `CartDockPill`, `CartThumbs`, `Header`, `SearchBar`, `ClosedBanner`,
night-theme components, navigation, `@chirawa/api-client` (`getFeed` exists), **all backend, all tests.**

---

## 9. 🧭 Build order (sub-passes — wire one at a time)

1. **Data layer** — `fetchFeed()` + `toFeedCard()` mapper in `catalog.ts` (pure). Discount % is computed in-card.
2. **Dense card** — extend `ProductCard` with `size="dense"` (+ disabled/eta); visual-only.
3. **For You shelf** — `ForYouFeedShelf` (flat feed swiper) into Home header.
4. **Feed grid** — restructure Home to root `FlatList numColumns=3` (the dense grid).
5. **Bestsellers** — simplify `BestsellersSection` (single image + name, no counts) + mount.
6. **Closed-state** — disable ADD + toast when `useStoreClosed()`.
7. **(optional)** category-grid real images; `expo-image` perf PR.

---

## 10. ✅ Done-when

- [x] Home is a virtualized `FlatList` (3-col feed grid). *(code-complete; on-device 60fps check pending)*
- [x] "For You" is a flat feed swiper (no pills), powered by `getFeed()`.
- [x] Dense cards show image, pack-size, bold ₹price + strikethrough MRP + maroon OFF ribbon,
      2-line title, ⏱ chip — **no fabricated ratings/options**.
- [x] ADD adds the representative `productId`; capsule updates; resolves at checkout.
- [x] "Shop by category" + category tiles use a single clean image/icon — no counts, no clusters.
- [x] Closed → night banner + ADD disabled with a graceful toast *(folded into Pass 4 via `disabled={closed}`)*.
- [ ] Theme audit: zero Blinkit colors; only `theme/index.ts` tokens. *(on-device pass pending)*
- [x] `tsc --noEmit` clean; 206 API tests untouched (backend never touched).

---

## 11. ✅ Locked decisions

1. **ADD color → ORANGE** (`Colors.primary`), matching the existing card family. Maroon
   (`specialAccent`) is reserved for the discount ribbon + the Special tab.
2. **★ratings, "N options", "❄️ Chilled", ❤️ favorite heart → OMITTED for v1.** No fabricated
   data. Dense cards ship with real fields only: image, pack-size, price, strikethrough MRP,
   discount %, 2-line title, ⏱"10 mins". (Real ratings/variants/wishlist = future backend work.)

### Still-deferred (not blocking v1)
3. **`expo-image`** — optional perf PR (needs Expo-54 doc check per `AGENTS.md`).
4. **`categoryName` on `AggTile`** — the one backend follow-up that would let category-themed
   shelves be feed-powered too; deferred (backend stays frozen).
</content>
