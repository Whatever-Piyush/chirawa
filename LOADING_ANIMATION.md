# ⏳ Branded Loading Animation — research + design (Chirawa-themed)

> **Reference:** the Blinkit full-screen loader (`Downloads/WhatsApp Image 2026-06-15…`) —
> a dark canvas with **animated, cycling product icons** (a watch + trimmer that swap to other
> products) + a tagline ("Everything you need, delivered at your doorstep"). It shows while a
> **page/category loads** (the "buffering" between screens).
>
> **Goal:** build the same *experience* — a branded, animated buffer — **skinned in Chirawa's
> theme** (cream/orange by day, the existing night-space look when the store is closed), and use
> it for full-page loads (opening a category, a product, the Categories tab). **No new deps.**

---

## 0. What the reference shows (decode)
- Full-screen, centered.
- A **pair of colourful product icons** that **animate/cycle** (different products each beat).
- A **tagline** below in muted text.
- Calm, branded — replaces a bare spinner so a slow load feels intentional, not broken.

---

## 1. Research — how to build it (RN/Expo options)

| Approach | Verdict for us |
|---|---|
| **RN `Animated` (built-in)** | ✅ **Chosen.** Already used across the app (Header, SearchBar, ProductCard, DotsLoader). Crossfade + spring "pop" on an interval = the cycling-icon effect. Zero new deps, works on the pinned Expo SDK. |
| **Lottie (`lottie-react-native`)** | Most polished (vector JSON anim), but a **new native dependency** + Expo config + sourcing/【designing a .json. Overkill for a buffer; deferred. |
| **Reanimated 3** | Powerful, but **not installed**; adds a native dep + babel plugin. Not worth it for this. |
| **`react-native-svg`** | Would let us draw real product vectors like Blinkit; **not installed**. We approximate with emoji instead (colourful, dependency-free, already the app's category iconography). |

**Decision:** RN `Animated` + **cycling grocery emoji** (🥛🛒🍞🥦🍎🧴…) — colourful like the
reference, on-brand (we already use category emoji), and free. Reuse the existing **`DotsLoader`**
for the "working…" affordance.

---

## 2. 🎨 Theme adaptation (not Blinkit's dark)
- **Day:** `Colors.background` (warm cream) canvas; emoji on soft `Colors.surface` rounded tiles;
  `DotsLoader` in `Colors.primary` (orange); tagline in `Colors.textSecondary`.
- **Night (store closed):** reuse the app's night surface — `FauxGradient` `NIGHT_FROM → NIGHT_TO`
  + `Starfield` (same as the Header/ClosedBanner), white-ish tagline, white dots. So the loader
  matches whichever mode the app is in (driven by `useStoreClosed()`).
- Two emoji side-by-side (like the reference's two icons), each cycling with a **crossfade +
  spring pop**, slightly **phase-offset** so they don't change in lockstep.

---

## 3. 🧩 Component — `components/BrandedLoader.tsx`
```tsx
<BrandedLoader message? style? />   // fills its parent (flex:1), centered
```
- `ICONS = ['🥛','🛒','🍞','🥦','🍎','🧴','🧹','🧼','☕','🥚','🧈','🍫','🥤','🫙','🍪']`
- Internal `PoppingEmoji({ start, phase })`: every ~700ms → fade+shrink out → next icon → spring
  pop in. Two instances (phase 0 and ~350ms).
- `DotsLoader` under the icons + a muted tagline (default: "Everything you need, in minutes").
- **Accessibility:** `AccessibilityInfo.isReduceMotionEnabled()` → if on, **skip the cycling**
  (show a static icon pair); honours OS "reduce motion".
- Pure RN `Animated`; reuses `Text`, `FauxGradient`, `DotsLoader`, `Starfield`, `nightTheme`.

---

## 4. Where it's used (the "page buffer" moments)
Replace the bare centered `ActivityIndicator` on **full-page loads**:
- `CategoryProductsScreen` (opening a category) ✅ the main case you flagged
- `CategoriesScreen` (the Categories tab)
- `ProductDetailScreen` (opening a product)

**Left as-is (already good):** `ShopDetailScreen` uses **content skeletons** (better than a
spinner for a known layout); inline section rails (`DailyEssentialsShelf`, `ForYouFeedShelf`,
Bestsellers) keep their small inline spinner — they're sections within a page, not a full buffer.
*(Order screens can adopt `BrandedLoader` later if desired.)*

---

## 5. 📂 Files
| File | Change |
|---|---|
| `src/components/BrandedLoader.tsx` | **NEW** — the animated themed loader |
| `src/screens/categories/CategoryProductsScreen.tsx` | spinner → `<BrandedLoader/>` |
| `src/screens/categories/CategoriesScreen.tsx` | spinner → `<BrandedLoader/>` |
| `src/screens/product/ProductDetailScreen.tsx` | spinner → `<BrandedLoader/>` |

No backend, no new deps, no test changes.

---

## 6. 🎯 Done-when
- [ ] Opening a category/product shows the **branded cycling-emoji loader + tagline**, themed.
- [ ] Night (closed) → the loader wears the space/star theme; day → cream/orange.
- [ ] Reduce-motion users get a static (non-cycling) variant.
- [ ] `tsc` clean; no new dependencies.

---

## ★ v2 — Premium revision (chosen, BUILT 2026-06-15)

v1's cycling **OS emoji looked cheap** (system glyphs, off-brand, inconsistent per device).
Research on what premium q-commerce apps do:
- **Blinkit/Zepto/Swiggy use Lottie** (After Effects → tiny JSON, vector-smooth, brand-colored) —
  that's the "cool" factor. ([lottie-react-native](https://github.com/lottie-react-native/lottie-react-native), [LogRocket](https://blog.logrocket.com/mastering-lottie-animations-react-native-apps/))
- **For content, skeleton screens win** — shimmer placeholders shaped like the content; a 5s
  spinner "feels broken", a shimmer skeleton "feels fast". ([LogRocket](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/) · [Onething](https://www.onething.design/post/skeleton-screens-vs-loading-spinners))

**Chosen (dep-free) approach — uses our existing premium primitives:**
1. **Content loads → `ProductGridSkeleton`** (new): a 2-col shimmer grid matching `ProductCard`,
   built on the existing `Shimmer`. Used on **CategoryProducts** (the main "open a category →
   buffer" case). ShopDetail already uses skeletons.
2. **Brand buffer → `BrandedLoader` v2**: the **`BringlyBag` brand illustration** with a calm
   float + breathe (no cycling emoji), dots, tagline; night-space themed when closed. Used on
   **Categories** + **ProductDetail**.
3. **Lottie** = the optional "exact Blinkit" upgrade later (adds `lottie-react-native` → a
   dev-client rebuild + an approved animation asset). Deferred by choice.

### Coverage — every full-page load now shows a skeleton or the branded loader
| Screen | Loader |
|---|---|
| Categories tab | `BrandedLoader` |
| Category products | `ProductGridSkeleton` |
| Product detail | `BrandedLoader` |
| Shop detail | product-card skeletons *(already)* |
| Search | skeleton rows *(already)* |
| Checkout (cart) | `BrandedLoader` |
| Order history | skeleton cards *(already)* |
| Order tracking | `BrandedLoader` |
| Address list | shimmer skeletons *(already)* |
| Home / Special **section rails** | small inline spinner — a full loader inside a horizontal rail would look wrong (intentional) |
| Address map / receive / share flows | small inline action spinners (not page loads) |

> App-launch (auth-bootstrap) loader stays as-is: it renders **before** the NavigationContainer,
> and `BrandedLoader` depends on `useStoreClosed → useIsFocused` (needs nav context).

## 7. Optional follow-ups (not now)
- A **min-display (~400ms)** so the loader doesn't flash on very fast local loads.
- Swap emoji → **Lottie / SVG** product vectors for pixel-parity with Blinkit (adds a native dep).
- A rotating tagline (like the SearchBar placeholder).
