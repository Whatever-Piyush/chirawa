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

---

## Notes / open points

- The white search bar sits between the night header and the night banner — it
  stays light on purpose (a search input should look tappable/editable). If you
  want the search bar itself tinted dark at night too, say so and I'll theme it.
- Status bar / safe-area top becomes dark at night (covered by the header), which
  suits the theme. If you want light status-bar icons forced at night, tell me.
- Daytime look is unchanged (brand orange).
