# 🛒 Product Card — ADD button & quantity stepper (Blinkit/Zepto-style fix)

> **Component:** `apps/customer-app/src/components/product/ProductCard.tsx`
> **Surfaces:** Daily Essentials rail, For You feed, Home/Category/Search/Shop grids,
> Product Detail "similar / also like" — i.e. **every product tile in the app** uses
> this one component, so a fix here fixes the whole app.

---

## 0. The two bugs (reported)

1. **Pack-size overlaps the ADD button (dense "Daily Essentials" cards).**
   The pack-size (e.g. `400 g`) was an **overlay pill on the image's bottom-left**,
   and the ADD button floats on the image's **bottom-right**. On a 3-column dense
   tile the image is only ~95 px wide, so a longer pack label and the button ran
   into each other.

2. **The −/+ capsule grows too wide and hides the qty/pack label (whole app).**
   Tapping **ADD** morphed the button into a `−  N  +` stepper that was a **different,
   wider width** than ADD (`addW → stepperW`). On the regular/compact cards the
   pack-size label sits in the **same row** as the button (`weight | ADD`), so when
   the stepper expanded it squeezed the label — on the small compact card it shrank
   the label to ~13 px (effectively hidden).

### Root cause in code (before)
```ts
// DIMS had two widths per size — ADD vs stepper:
regular: { addW: 72, stepperW: 104 }   // +32 px growth on tap
compact: { addW: 54, stepperW: 80  }   // +26 px → eats the weight label
dense:   { addW: 60, stepperW: 88  }
```
```tsx
// width animated between the two → the control physically grew:
const width = morph.interpolate({ outputRange: [dims.addW, dims.stepperW] });
<Animated.View style={[styles.addWrap, { width }]}> … </Animated.View>

// dense pack-size was an absolute overlay on the image, colliding with the button:
densePackPill: { position:'absolute', left:6, bottom:6, maxWidth:'60%' }
denseAddWrap:  { position:'absolute', right:6, bottom:-14 }   // overlap zone
```

---

## 1. Research — how Blinkit & Zepto solve this

Both quick-commerce leaders converged on the same two rules; we mirror them.

| Pattern | Blinkit | Zepto | What we copy |
|---|---|---|---|
| **Pack-size placement** | A **text line in the card body** (below the image), never painted on top of the image near the button. | Same — weight/unit is body text under the name/price. | Move `400 g` out of the image overlay into a **body line**. No collisions possible. |
| **ADD position** | A pill **floating over the image's bottom-right**, overlapping the edge. | Same floating bottom-right pill. | Keep our floating ADD (already Blinkit-geometry). |
| **ADD → stepper** | The pill turns solid green and shows `−  N  +` **in the same compact footprint** — it does **not** grow into a long bar. | Same — a tight fixed-width `− qty+`. | Make the stepper the **same width as ADD** (no growth). |
| **Out-of-stock** | Greys the tile + blocks the tap (communicates why). | Same. | Unchanged (we already grey/block OOS at the PDP/variant level). |

**Key takeaways applied:**
- *Pack-size is body text, not an image overlay* → removes bug #1 structurally.
- *The add control is a fixed-width pill that morphs in place* → removes bug #2
  structurally (nothing to squeeze, because nothing resizes).

Sources / reading:
- [Blinkit add/remove cart animation (60fps.design)](https://60fps.design/shots/blinkit-add-remove-cart-animation) — the in-place ADD→stepper morph.
- [Recreating Blinkit's product listing page — case study (Medium)](https://medium.com/@srirammanogar07/understanding-ui-design-by-recreating-the-product-listing-page-of-blinkit-a-case-study-66fff1e951b) — card anatomy: image → name → pack/qty → price+ADD.
- [Enhancing Zepto's PDP & Cart (Medium)](https://medium.com/@om_salvi/enhancing-zeptos-pdp-and-cart-page-in-24-hours-9b65ea3627a9) — Zepto card/stepper conventions.
- [Blinkit UX/UI case study (Medium / Design Bootcamp)](https://medium.com/design-bootcamp/enhancing-the-user-experience-of-blinkit-app-a-ux-ui-case-study-8bc70ff6a0e4) — OOS greying + tap-blocking.

---

## 2. The fix (implemented)

### a. One width for ADD and the stepper (whole app)
`DIMS` now has a single `addW` per size (dropped `stepperW`). The button **morphs
in place** — `ADD` text ⇄ `− qty+` — without ever changing width, so it can't cover
the label beside it. `addW` was nudged up slightly (`72→78`, `54→58`, `60→64`) to
give `− qty+` comfortable room now that it no longer "borrows" width on tap.

```ts
regular: { addW: 78 }
compact: { addW: 58 }
dense:   { addW: 64 }
```

The width `Animated` interpolation + `morph` value were removed (the control no
longer animates its width), making the component simpler.

### b. Fluid stepper internals (never clips the count)
The `−`/`+` hug the edges and the **count flexes** to fill the middle, so the same
markup fits any `addW` without clipping, even for two-digit quantities:
```tsx
stepper:   { flexDirection:'row', alignItems:'center', paddingHorizontal:2 }
stepBtn:   { paddingHorizontal:3, paddingVertical:4 }   // + hitSlop for touch
stepCount: { flex:1, textAlign:'center' }               // takes the middle
```

### c. Dense card: pack-size is a body line, not an image overlay
- Deleted the `densePackPill` / `densePackText` **image overlay**.
- Added a `densePack` **text line in the body**, under the image, above the price.
- The floating ADD button overhangs ~14 px below the image; the image area now
  carries `marginBottom: 14` to **reserve that strip**, so the pack-size/price
  lines below can never collide with the button (works whether or not a product
  has a weight label).

```
┌───────────────────────┐
│        image          │
│                 ┌────┐ │
│                 │ADD │ │ ← floating, bottom-right (overhangs ~14px)
└─────────────────└────┘─┘
  400 g                     ← pack-size: its own body line (NEW)
  ₹45   ₹60                 ← price + MRP
  25% OFF
  Aashirvaad Atta…          ← name (2 lines)
```

---

## 3. Files changed
| File | Change |
|---|---|
| `src/components/product/ProductCard.tsx` | Single `addW` (dropped `stepperW`); removed width morph/`Animated`; fluid stepper; dense pack-size moved from image overlay → body line; `denseImageArea` reserves the button overhang. |

No backend, no new deps, no API changes. Affects **all** product tiles app-wide
because every surface renders `ProductCard`.

---

## 4. Done-when
- [x] Daily Essentials: pack-size (`400 g`) never overlaps the ADD button.
- [x] Tapping ADD shows a compact `− qty+` that stays the **same width** as ADD —
      the pack-size / qty label is no longer hidden, on every card size.
- [x] Two-digit quantities (`10`, `12`) render without clipping.
- [x] Dense, regular and compact tiles all consistent.
- [x] `tsc --noEmit` clean; no new dependencies.

---

## 5. Optional follow-ups (not now)
- A subtle **fade/scale** on the ADD→stepper swap (Blinkit has a tiny pop). We
  removed the width animation; a pure opacity/scale crossfade could be re-added
  without reintroducing the width-growth bug.
- Per-product **out-of-stock greying** on the tile itself (currently handled at
  the PDP/variant level), matching Blinkit's greyed OOS card.
