# View-Cart Capsule — Redesign Plan

How the floating "View cart" capsule should look and behave. Review/edit before
I implement.

> Status: **PROPOSAL — not yet coded.** Edit anything; then say "go".

---

## 1. What exists today

- `CartDockPill` floats above the bottom tab bar. It renders **only inside the
  tab navigator**, so it shows on Home / Categories / Orders / Special / Profile
  — but **NOT** on pushed stack screens like **Category Products** or
  **Product Detail**.
- It shows **only when the cart has items** (`count > 0`); hidden when empty.
- Left side shows **one** thumbnail (the last-added item) as a rounded **square**
  (`borderRadius 10`), then "View cart" + "N items · ₹X" + a chevron.
- It already adopts the night theme when the store is closed.

---

## 2. Goal (from the request)

1. **Visibility rule (important):**
   - **Empty cart →** capsule shows on the **Home page only** (an empty-state
     "View cart" capsule). It is **hidden on all other pages** when empty.
   - **Cart has item(s) →** capsule shows on **every page** (Home, all tabs, and
     pushed screens like Category Products / Product Detail).
   - So: Home always has the capsule; other pages get it only once something is
     in the cart.
3. **Circular thumbnails**, stacked & partially overlapping like the reference
   (grouped-avatars look).
4. **Rolling stack of the last 3 added items:**
   - 1 item → 1 circle.
   - 2 items → capsule **stretches left**, 2 overlapping circles.
   - 3 items → 3 overlapping circles.
   - 4th item → **oldest (leftmost) slides out to the left**, **4th slides in
     from the right** (still 3 shown).
   - 5th item → 2nd-oldest slides out, 5th slides in. (Always the **last 3
     added**, newest on the right.)

---

## 3. Proposed design

### 3a. Where it renders (per the visibility rule)
- Move `CartDockPill` to a **global overlay** above the root `Stack.Navigator`, so
  it can float over **all** screens (tabs + pushed screens).
- Gate rendering on cart state + current route:
  - `count > 0` → render everywhere.
  - `count === 0` → render **only when the active route is Home**.
- The empty-state capsule (Home only) shows "View cart" with **no thumbnails**
  and an empty summary (e.g. "0 items"). ❓ *Decision: tapping it when empty —
  open Checkout (empty), or disable the tap? Default: open Checkout.*
- **Bottom offset** differs by screen:
  - Tab screens: sit above the tab bar (current behaviour).
  - Pushed stack screens (Category Products, Product Detail): no tab bar, so sit
    lower (just above the safe-area bottom).
  - ❓ **Decision:** Product Detail has its own bottom "Add to cart" bar — should
    the capsule sit **above that bar**, or is the bar enough there (hide capsule
    only on Product Detail)? *Default: show it above the bar.*

### 3b. Circular, overlapping thumbnails
- Thumbnail = **circle** (`borderRadius = size/2`), white ring border, matching
  the reference. Proposed size **30–34 px**, overlap so each circle covers
  ~**40%** of the previous (i.e. left-shift ≈ 0.6 × size).
- Max **3** visible. z-order: **newest on top** (rightmost overlaps leftward).
  ❓ *Decision: newest-on-top or oldest-on-top? Default: newest on top.*
- Fallback when an item has no image: filled circle in its `imageColor`
  (consistent with the imageless catalog).

### 3c. Data model — "last 3 added"
- Add `recentlyAdded: LastAddedItem[]` (max length 3, newest last) to
  `CartContext`, updated inside `addItem`: push the new item; if length > 3, drop
  the oldest. This is an **add-history** (independent of later quantity changes),
  matching the described behaviour.
- ❓ *Decision: track last-3 **added events** (what the request describes), or the
  last-3 **distinct items currently in the cart**? Default: last-3 added events.*
- The "N items · ₹X" text keeps using the real cart `count` / `subtotal`.

### 3d. Animations (slide in / out + stretch)
- Each visible thumbnail owns an `Animated.Value` for `translateX` + `opacity`.
- **Add:** new circle mounts off-screen right → springs to its slot; existing
  circles shift left to make room; the capsule **width animates** wider.
- **Evict (4th+):** the leftmost circle animates `translateX` left + fades out,
  then unmounts; the rest shift to fill.
- Uses RN `Animated` (native driver for transform/opacity; width can't use native
  driver, so the container width animates on the JS driver).

### 3e. Dimensions (from the reference image)
- Small circular product pics, partially hidden behind each other (≈40% overlap),
  vertically centered in the capsule's left zone, then the "View cart" label.

---

## 4. Out of scope / keep as-is
- Capsule colours (brand orange / night theme) unchanged.
- Tapping still opens Checkout.
- "N items · ₹X" summary text unchanged.

## 5. Open questions (answer inline or say "go" for defaults)
1. Show capsule **above Product Detail's add-to-cart bar**, or skip it there?
   *(default: show above)*
2. **z-order** of overlapping circles — newest on top or oldest on top?
   *(default: newest on top)*
3. Thumbnails = **last-3 added events** or **last-3 items in cart**?
   *(default: last-3 added)*
4. Thumbnail **size / overlap** — 32 px, ~40% overlap OK? *(default: yes)*
5. Empty cart → capsule on **Home only** (hidden elsewhere). ✅ confirmed.
6. Empty-state capsule tap → open Checkout (empty) or disable? *(default: open)*
