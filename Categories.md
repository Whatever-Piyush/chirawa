# Categories — Redesign Plan

Rework the category browsing experience to the **two-pane** layout in the
reference screens (Blinkit / Zepto): a **left vertical rail of sub-categories**
and a **right 2-column product grid**. Brand stays Bringly **orange** (`#FF6B35`);
the references' green/red are just their colors.

> Status: **Path A IMPLEMENTED ✅** (UI built; typechecks clean). The Grocery &
> Kitchen data split (Path B) is still a separate later task. Not yet run on device.

## As built (Path A)

- **`categoryMeta.ts`** — added `resolveCategoryView(category)`: maps an incoming
  category (a `SECTION_GROUPS` title *or* a leaf category) → `{ mainTitle, subs[] }`,
  deduping tiles to distinct backing categories so two tiles on the same real
  category don't render identical grids.
- **`CategoryProductsScreen.tsx`** *(rewritten)* — two-pane: left vertical
  sub-category **rail** (thumbnail/emoji + label, active = tinted pill + orange
  left bar + bold), right **2-column product grid**. Tapping a rail item swaps the
  grid in place (no navigation). Per-sub product **cache** for instant re-taps,
  per-sub shimmer while loading, scroll resets on sub change, "No items here yet"
  empty state. Subs are filtered to live categories (never blanks the rail).
- **`ProductCard.tsx`** — added an optional `cardWidth` prop so cards fit the
  narrower right pane (full-screen default unchanged).
- **`AppNavigator.tsx`** — `CategoryProducts` param gains optional `subCategory`
  for pre-selecting a rail item. All existing entry points (Categories tab, home
  tiles, Bestsellers) pass `{ category }` and now open the two-pane unchanged.

**Known Path-A limitation (by design):** sub-categories whose backing category is
the same broad bucket (e.g. several "Grocery & Kitchen" tiles) share one grid
until the data is split. That's the Path B follow-up below.

---

> Original plan below (kept for reference).

---

## 1. The target (from the screenshots)

When the customer opens a main category (e.g. *Fruits & Vegetables*, *Cough/Cold
& Fever*, *Masala, Dry Fruits & More*), they see:

```
┌──────────────────────────────────────────────┐
│  ‹  Main category name            ♡   🔍      │  ← top bar
├──────────────────────────────────────────────┤
│ [⚙ Filters] [Sort ▾] [Brand ▾] [chips…]       │  ← filter row (horizontal scroll)
├────────────┬─────────────────────────────────┤
│  sub rail  │   ┌─────────┐   ┌─────────┐      │
│ ┌────────┐ │   │ product │   │ product │      │
│ │ icon   │ │   │  +ADD   │   │  +ADD   │      │  ← right: 2-col product grid
│ │ Sub 1  │◀│   └─────────┘   └─────────┘      │
│ ├────────┤ │   ┌─────────┐   ┌─────────┐      │
│ │ Sub 2  │ │   │ product │   │ product │      │
│ │ Sub 3  │ │   └─────────┘   └─────────┘      │
│ │  …     │ │        …             …           │
│ └────────┘ │                                  │
├────────────┴─────────────────────────────────┤
│  🛒  Unlock free delivery / View cart →        │  ← sticky bottom bar
└──────────────────────────────────────────────┘
```

- **Left rail (~80–96px wide):** vertically scrolling list of the main category's
  **sub-categories**, each a small image/icon + 1–2 line label. The active one is
  highlighted (tinted pill + colored left bar + bold label), exactly like the pics.
- **Right grid:** the selected sub-category's products in **2 columns**, reusing the
  existing `ProductCard` (image, price, MRP strike, discount, ADD).
- **Top:** back + main category title + (optional) wishlist/search icons.
- **Filter row (optional, phase 2):** Filters / Sort / Brand / Type chips.
- **Sticky cart bar (already exists elsewhere):** reuse the app's cart bar.

Tapping a sub-category in the rail swaps the right grid (no full navigation).

---

## 2. How this maps to the current code

| Concern | Today | File |
|---|---|---|
| Categories tab (list of mains) | Vertical list of category rows → navigates to grid | `screens/categories/CategoriesScreen.tsx` |
| Category product grid | Plain 2-col grid for one category, **no rail** | `screens/categories/CategoryProductsScreen.tsx` |
| Catalog API wrappers | `fetchCategories()`, `fetchProducts({ category })` | `services/catalog.ts` |
| Product card | Reusable, already 2-col ready | `components/product/ProductCard.tsx` |
| Main→sub grouping (client) | `SECTION_GROUPS` (titles + tiles) | `screens/home/categoryMeta.ts` |
| Nav param | `CategoryProducts: { category: string }` | `navigation/AppNavigator.tsx` |

The redesign is essentially: **turn `CategoryProductsScreen` into the two-pane
layout** (rail + grid), and have the Categories tab / home tiles open it at the
right main category.

---

## 3. ⚠️ The data-model reality (read this first)

This is the part that decides scope. **The two-pane UI is easy. Real
sub-categories are the actual work.**

- **The DB *schema* supports a hierarchy.** `Category` has `parentId` +
  `parent`/`children` (`apps/api/prisma/schema.prisma`). A `Product` has one
  `categoryId`.
- **But the seed never uses it.** Categories are **flat, per-shop, deduped by
  name**. Products like *Aashirvaad Atta*, *Tata Sampann Toor Dal*, and *India
  Gate Basmati Rice* are **all** under a single `'Grocery & Kitchen'` category
  (`apps/api/prisma/seeds/shops.ts`). There are no "Atta" / "Dal" / "Rice"
  categories in the data.
- **The customer API returns a flat list.** `getCategories()` flattens all
  categories by name and ignores parent/child
  (`apps/api/src/modules/catalog/catalog.service.ts`). `getProducts` filters by
  category **name** (`c.name = category`).
- The only "main → sub" grouping that exists is **client-side** in
  `categoryMeta.ts` (`SECTION_GROUPS`: e.g. *Grocery & Kitchen* group → tiles
  *Vegetables*, *Bakery*, *Dairy & Bread*…). These tiles map to existing flat
  category names.

**Consequence:** your example — main **"Atta, Dal & Rice"** with sub-categories
**Atta / Dal / Rice** — does **not exist** in the data today. Those are all one
flat `'Grocery & Kitchen'` category. To get that exact granularity we must create
those sub-categories in the data.

---

## 4. Two build paths

### Path A — UI now, using existing categories as the rail (no backend change)

Use the **client `SECTION_GROUPS`** as the hierarchy:
- **Main category** = a `SECTION_GROUPS` group (e.g. *Grocery & Kitchen*).
- **Rail (sub-categories)** = that group's tiles, **filtered to the ones the live
  `fetchCategories()` actually returns** (so no empty rows).
- **Right grid** = `fetchProducts({ category: <tile.category> })` for the selected
  rail item — exactly the existing call.

✅ Ships fast, zero backend/data work, looks like the references immediately.
⚠️ Granularity is limited to existing categories. Several tiles currently point to
the **same** backing category (e.g. *Atta, Rice & Dal*, *Oil, Ghee & Masala*, and
*Tea, Coffee & More* all map to `'Grocery & Kitchen'`), so their grids would be
**identical** until the data is split. Not the true Atta/Dal/Rice split.

### Path B — Real sub-categories (data + small API change) → matches your example

1. **Data:** split the broad categories into real sub-categories and tag products.
   Two ways:
   - **Re-seed with finer category names** (simplest): change `shops.ts` so e.g.
     Atta products → `'Atta'`, dals → `'Dal'`, rice → `'Rice'`, and add a
     **parent** grouping (`parentId`) so *Atta/Dal/Rice* live under a *Grocery &
     Kitchen* (or *Atta, Dal & Rice*) parent. Requires a DB reseed/migration.
   - Or keep broad categories and add a `subCategory`/`tags` field to `Product` —
     bigger schema change; not recommended.
2. **API:** expose the hierarchy. Either:
   - `getCategories()` returns `{ name, children: [...] }` (parents with their
     sub-categories), and `getProducts({ category })` already filters by the leaf
     name — minimal change; or
   - add `GET /catalog/categories/:mainName/subcategories`.
3. **Client:** rail is driven by the API's `children` instead of `SECTION_GROUPS`.

✅ True Atta/Dal/Rice granularity, server-driven, future-proof.
⚠️ Needs data re-categorization (the real effort) + a seed/migration + an API tweak.

**Recommendation:** Build the **two-pane UI now against Path A** (identical
front-end either way — only the *source of rail items* differs), and treat **Path
B as a follow-up data task**. When the data is split, we swap the rail's source
from `SECTION_GROUPS` to the API `children` with no layout change. Confirm in
§7 which main categories you want split first (Grocery & Kitchen is the obvious
one for Atta/Dal/Rice).

---

## 5. UI plan (front-end, same for both paths)

**New screen / rewrite:** `screens/categories/CategoryProductsScreen.tsx` →
two-pane. (Keep the route name `CategoryProducts` so existing call sites work; add
an optional param for the initial sub-category.)

Proposed nav param:
```ts
CategoryProducts: {
  category: string;          // main category (group title) OR a single category name
  subCategory?: string;      // optional: pre-select a rail item
}
```

**Components:**
- `CategoryRail` (left) — `FlatList`, vertical. Item = image/emoji + label;
  `active` styling (tinted bg `primaryLight`, 3px left bar in `primary`, bold
  label). Tap → `setActiveSub(name)`.
- `CategoryGrid` (right) — the existing 2-col `FlatList` of `ProductCard`, now fed
  by `fetchProducts({ category: activeSub })`. Re-fetches on rail change (with a
  tiny cache per sub so re-tapping is instant).
- `FilterRow` (optional, phase 2) — horizontal chip row (Sort / Brand / Type).
  Sort can be client-side (price/discount); Brand/Type need product metadata we
  don't have yet → defer.

**Behavior / states:**
- First load: fetch the rail items + products for the first sub in parallel; show
  the rail immediately, grid shows a shimmer.
- Switching sub: grid shows a light spinner/shimmer; rail stays put.
- Empty sub: "No items here yet" in the right pane only (rail stays).
- Preserve scroll position per pane independently.
- Reuse the app's existing **sticky cart bar** at the bottom if one exists on other
  screens (confirm which component).

**Styling tokens (from `theme/index.ts`):** `Spacing`, `Radius.md/lg`,
`Colors.primary` / `primaryLight` / `surface` / `border` / `textSecondary`,
`Shadow.xs`. Rail width ≈ 84px. Grid gutter = `Spacing.md` (12). No hardcoded hex.

---

## 6. Entry points (where the two-pane opens from)

- **Categories tab** (`CategoriesScreen`): tapping a main category row → open
  two-pane at that main (rail = its subs).
- **Home section tiles** (`SECTION_GROUPS` tiles on Home): → open two-pane at the
  tile's group, pre-selecting that tile's sub-category.
- **Bestsellers / carousels** that currently deep-link to `CategoryProducts` → keep
  working (a single category name just opens with a 1-item rail, or we route it to
  its parent group).

Decision needed: should the Categories tab itself become two-pane (Blinkit-style,
rail = main categories, persistent), or stay a list that opens the two-pane? The
pics show the **two-pane is the per-category screen**, so default = keep the tab as
the launcher. (See §7.)

---

## 7. Open questions to confirm before building

1. **Granularity / data (most important):** OK to proceed with **Path A** UI now
   (rail = existing categories, some grids duplicate), and schedule **Path B** data
   split separately? Or do you want the real Atta/Dal/Rice split *first* (data
   work) so the first build already looks right?
2. **Which mains to split first** under Path B? (Suggest *Grocery & Kitchen* →
   Atta, Dal, Rice, Oil & Ghee, Masala, Tea & Coffee, Salt & Sugar.)
3. **Filter/Sort row:** include in v1 (Sort only, client-side) or defer entirely?
   Brand/Type need data we don't store yet.
4. **Categories tab:** keep as the list launcher (recommended) or convert the tab
   itself to a persistent two-pane?
5. **Top-bar icons:** do we want the wishlist ♡ + search icons from the refs?
   (No wishlist feature exists yet — would be cosmetic/non-functional.)
6. **Sticky cart bar:** which existing component should sit at the bottom here?

---

## 8. Suggested build order (once §7 is settled)

1. **UI shell** — rewrite `CategoryProductsScreen` into rail + grid using Path A
   (`SECTION_GROUPS` filtered by live categories). Wire entry points. *(front-end
   only, shippable)*
2. **Polish** — active states, per-sub grid cache, loading/empty states, sticky
   cart bar.
3. *(optional)* **Filter row** — client-side Sort.
4. *(follow-up, separate)* **Path B data** — split categories in the seed + add
   `parentId`; expose `children` from `getCategories`; switch the rail source from
   `SECTION_GROUPS` to the API. No layout change.

---

_Related redesign docs: `Search_Bar.md`, `address_Bar.md`._
