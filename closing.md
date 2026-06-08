# Closed-Hours Night Theme — Header + Banner

What this change does and the decisions behind it. Edit anything you want
changed before/after I implement.

> Status: **IMPLEMENTED** (header now goes night-themed when closed).

---

## Goal

When the store is **closed** (outside 8 AM – 9 PM), the night theme used by the
closed banner should **extend upward into the header** — the area showing the
Bringly delivery ETA, the `24×7` chip, the delivery address, and the profile
button.

- Keep every header element exactly as it is (ETA, address row, profile avatar).
- Only the **background** changes: orange → the night gradient from the closed banner.
- Everything must keep working:
  - **Search bar** still opens the Search screen.
  - **Address row** is still tappable and opens the editable location sheet.
  - **Profile button** still opens the Profile tab.
- When the store is **open**, the header stays the normal brand orange.

---

## How it's built

1. **Shared night palette** (`screens/home/nightTheme.ts`)
   - `NIGHT_FROM = '#23264F'` (deep indigo, top)
   - `NIGHT_TO   = '#4C3E86'` (soft purple, bottom)
   - Used by both the header background and the closed banner so they match.

2. **Header (`screens/home/Header.tsx`)**
   - New optional prop `night?: boolean`.
   - When `night` is true, an absolutely-positioned `FauxGradient` (same
     `NIGHT_FROM → NIGHT_TO`) is drawn as the header background instead of the
     orange fill. All content renders on top, so taps still work.
   - The profile avatar's little green "active" dot border is recoloured to the
     night base so the ring doesn't show orange.
   - Header content, layout, and the `onProfilePress` / `onLocationPress`
     handlers are **unchanged**.

3. **HomeScreen (`screens/home/HomeScreen.tsx`)**
   - Computes `closed = !isOpenNow()` once and passes `night={closed}` to the
     header (and renders the existing `ClosedBanner` below as before).

4. **ClosedBanner** — refactored to import the shared palette (no visual change).

5. **Search bar** — untouched. It stays a white card that overlaps the header's
   bottom edge; on the dark header it reads clearly and still navigates to Search.

---

## Resize — bigger, more readable banner text

The closed-banner copy read too small. Bumped the type scale (and a few
surrounding sizes so it stays balanced):

| Element            | Before (fontSize / lineHeight) | After (fontSize / lineHeight) |
|--------------------|--------------------------------|-------------------------------|
| Title              | 15.5 / 21                      | **18 / 24**                   |
| Subtitle           | 12.5 / 17                      | **14 / 20**                   |
| "Opens 8 AM" pill  | 11.5 / 15                      | **13 / 17**                   |
| Moon icon          | 22                             | **24**                        |
| Moon badge circle  | 44 × 44                        | **48 × 48**                   |
| Sun icon (pill)    | 12                             | **13**                        |
| Card padding       | 16                             | **18**                        |
| Row gap            | 12                             | **14**                        |

Pill padding nudged up (h 11→12, v 5→6) so the larger text isn't cramped.
Everything else (night gradient, stars, copy, behaviour) is unchanged.

## More scattered stars (banner + header)

- Extracted the starfield into a reusable `Starfield` component (renders an
  absolute-fill, `pointerEvents="none"` overlay of little ✦ / ✧ stars).
- **Closed banner**: now **18 stars** (was 5), sizes 5–11 px, opacity 0.30–0.55.
- **Night header**: added **18 stars** behind the ETA / address / profile
  content (low opacity, spread across the full width) so the whole closed
  surface — header + banner — reads as one starry night sky.
- Purely cosmetic; taps pass straight through, so search / address / profile
  all keep working.

## "Universe" deep-space look

- **Deeper gradient** (keep): night palette darkened to `#0A0E2A` (space navy)
  → `#34245F` (deep violet) for a real outer-space feel (header + banner).
- **Richer stars** (keep): varied brightness (size 4–12 px, opacity 0.24–0.85)
  plus a few tinted stars (blue `#BFD0FF`, violet `#E2D2FF`, gold `#FFF1C9`) so
  it reads like a star field with depth.

### Planets instead of nebula blobs

> Status: **IMPLEMENTED.**

- Removed the 3 nebula colour-blobs from `Starfield`.
- New `Planet` component (`screens/home/Planet.tsx`), pure Views (no images):
  **Jupiter** (banded sphere + Great Red Spot + highlight) and **Saturn**
  (pale sphere + tilted ring via `rotate(-20deg) scaleY(0.34)`).
- Placement: header has Saturn (size 50, upper-right) + a small Jupiter;
  the banner has a small Jupiter (size 34, lower-right). All `pointerEvents="none"`.
- Subtitle shortened to **"Browse now — order first thing tomorrow."** Banner
  font sizes / padding unchanged (only the copy changed).

<details><summary>Original proposal</summary>

**1. Remove the big circles.** Drop the 3 nebula colour-blobs from `Starfield`
(the `nebula` prop and its `nebulaA/B/C` styles) — they looked like plain
circles, not space.

**2. Add real planets in the background**, drawn purely with Views (no images,
consistent with the imageless app):

- **A new `Planet` component** (`screens/home/Planet.tsx`), props:
  `size`, `position` (top/left/right/bottom), and a `kind` (`'jupiter' | 'saturn'`).
  All `pointerEvents="none"`, low-ish opacity so they read as distant background
  behind the ETA / address / banner copy.
- **Jupiter** — a banded gas-giant ball: a circle filled with 3–4 horizontal
  stripe bands in tan/cream/brown (`#C9A06B`, `#E3C39A`, `#9C6B43`) + a small
  oval "Great Red Spot" (`#B5532E`). Rendered with `overflow:hidden` so the
  bands clip to the sphere. A soft top-left highlight for a 3-D feel.
- **Saturn** — a pale-gold sphere (`#E6Cf9A` / `#C9A86B`) with a **tilted ring**:
  an ellipse made from a `View` with `borderWidth`, big `borderRadius`, and a
  `transform: [{ rotate: '-18deg' }, { scaleY: 0.35 }]` so it reads as a ring
  around the planet.

**3. Placement** (subtle, never on top of the important text):
- **Header**: Saturn in the upper-right area (around/under the profile corner,
  small ~46–56 px), one small distant Jupiter mid-left.
- **Banner**: a small Jupiter in the lower-right, behind the "Opens 8 AM" pill area.
- Sizes kept small and opacity ~0.6–0.85 so stars still dominate.

**4. Keep** the deeper gradient + tinted star field from above.

Tell me if you want different planets (e.g. add a ringless Mars/Neptune), bigger/
smaller, or different placement — otherwise I'll implement exactly this.

</details>

---

## Notes / open points

- The white search bar sits between the night header and the night banner — it
  stays light on purpose (a search input should look tappable/editable). If you
  want the search bar itself tinted dark at night too, say so and I'll theme it.
- Status bar / safe-area top becomes dark at night (covered by the header), which
  suits the theme. If you want light status-bar icons forced at night, tell me.
- Daytime look is unchanged (brand orange).
