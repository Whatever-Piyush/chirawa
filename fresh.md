# Fresh Section — Plan

A spec for building the **Fresh** surface (daily produce) to match the reference
screenshot, on top of what we already have. Review/edit before I implement.

> Status: **PROPOSAL — not yet implemented.** Edit anything below.

---

## 1. What I saw in the screenshot

- **Branded header**: a green "Fresh 🌱" wordmark + tagline **"Handpicked daily essentials"**, with a thin divider line.
- **Sub-category tab bar** (horizontal, underline on active): **Veggies** (active) · **Fruits** · **Mangoes & Melons** · **New Launches**.
- **Horizontal product carousel** of fresh produce cards. Each card:
  - product photo
  - round **＋ add** button (pink/red outline)
  - green **price pill** (e.g. `₹26`) + **strikethrough MRP** (`₹41`)
  - **"₹15 OFF"** savings line
  - name (e.g. "Organically Grown Ginger") + weight ("100 g")
  - Examples: Organically Grown Potato, Organically Grown Ginger (₹26/₹41), Tomato Local (₹24/₹74, 500 g), Chilli Green (₹12/₹56, 100 g).
- A full-width **"See All ›"** button under the carousel.
- Below it: a promo banner ("Play Time Fest") and a "Unlock free delivery — shop for ₹99" pill (these are *not* part of Fresh; out of scope).
- Top app header tabs: All · Adhik Maas · Fresh · Fashion · Electronics (separate nav surface; out of scope).

---

## 2. Where we are today

We already have the exact UI building blocks:

- **`ProductCarouselSection`** renders: title → scrollable tab bar (underline on active) → horizontal `ProductCard` row → "See All" button. This *is* the screenshot's layout.
- **`ProductCard`** already shows: ＋/stepper add button, green price pill, strikethrough MRP, **"₹N OFF"**, weight, name. ✅ matches the card design.
- On the home screen there's already a carousel titled **"Fresh & Daily"** with tabs:
  `['Veggies & Fruits', 'Dry Fruits & Nuts', 'Sweets & Mithai', 'Sauces & Spreads']`.
- There's also a **"Fresh & Daily" tile section** (Fresh Vegetables / Fresh Fruits / Milk & Dairy / Bread & Eggs).

**Gaps vs. the screenshot:**
1. Our produce is one flat category **`Veggies & Fruits`** — so we *can't* offer separate **Veggies / Fruits / Mangoes & Melons** tabs (they'd all show the same list).
2. The carousel is titled "Fresh & Daily" and has **no tagline** and mixes in non-produce tabs (Dry Fruits, Sweets, Sauces).
3. No product images (we went imageless app-wide) — the screenshot has produce photos.

---

## 3. What I propose to build

### 3a. Split produce into real sub-categories (so the tabs filter correctly)
Replace the single `Veggies & Fruits` category with:

| sortOrder | Category            | Tab label          |
|-----------|---------------------|--------------------|
| 4         | Vegetables          | Veggies            |
| 5         | Fruits              | Fruits             |
| 6         | Mangoes & Melons    | Mangoes & Melons   |

(Existing categories below would shift sortOrder; I'll renumber the whole map.)

> **Decision:** the screenshot also has a **"New Launches"** tab. There's no natural
> backing category for it. Options: (a) skip it, (b) make it a curated "All / mixed
> fresh" tab, (c) tag a few items as new. Default: **skip** unless you want it.

### 3b. Re-seed produce into the new sub-categories (dark store, imageless)
Move current produce + add common items so each tab is well-stocked, e.g.:
- **Vegetables** — Potato, Onion, Tomato, Green Chilli, Ginger, Carrot, Coriander, Lemon, Cauliflower, Capsicum, Lady Finger, Spinach…
- **Fruits** — Banana, Apple, Pomegranate, Orange, Grapes, Papaya, Guava, Kiwi…
- **Mangoes & Melons** — Alphonso Mango, Dasheri Mango, Watermelon, Muskmelon…

> Keep names generic ("Tomato Local", "Organically Grown Ginger") — produce isn't
> branded, unlike the packaged categories.

### 3c. Make the home carousel look like "Fresh"
- Add an optional **subtitle** prop to `ProductCarouselSection` ("Handpicked daily essentials") and render the tagline under the title.
- Rename the carousel **"Fresh & Daily" → "Fresh"** and set its tabs to
  `['Veggies', 'Fruits', 'Mangoes & Melons']` (mapping to the new categories).
- Update the "Fresh & Daily" tile section to point at the new produce categories.

### 3d. (Optional) Product images for fresh produce
The screenshot shows produce photos. We're currently imageless everywhere. Options:
- **Keep imageless** (consistent, colored placeholder) — default.
- **Re-enable images for produce only.** Tell me and I'll wire image URLs back for
  the fresh categories only.

---

## 4. Out of scope (unless you say otherwise)
- Top app-header tabs (Adhik Maas / Fashion / Electronics) — different nav surface.
- Promo banner ("Play Time Fest") and free-delivery pill.
- The exact green "Fresh 🌱" logo artwork (I'll use a styled text title + tagline to match our theme, not a pixel-copy).

---

## 5. Open questions (mark answers inline)
1. Include a **"New Launches"** tab? If yes, how should it be populated?
2. **Images** for fresh produce, or stay imageless?
3. Keep the title literally **"Fresh"** (+ tagline), or **"Fresh & Daily"**?
4. Should the old produce tabs (Dry Fruits / Sweets / Sauces) move to a *different*
   carousel, or just drop off the Fresh one?
5. Roughly how many items per produce tab (draft ≈ 8–12 each)?
