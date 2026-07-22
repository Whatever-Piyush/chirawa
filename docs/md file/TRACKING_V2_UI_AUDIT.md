# Tracking V2 — UI Audit (Current screen vs TRACKING_V2_SPEC.md)

**Method.** Audited the **actual rendered screen** (`apps/customer-app/src/screens/orders/
OrderTrackingScreen.tsx`) against `TRACKING_V2_SPEC.md`. Locations are given as **on-screen
region + `file:line`** (no labeled tracking-screen screenshots were provided, so code anchors
are the precise, verifiable "screenshot location"). No code changed.

Severity: 🔴 Critical · 🟠 High · 🟡 Medium · ⚪ Low.

## Current screen inventory (render order)
Gradient header (status line + ETA string) → **Live map** (from `confirmed`) → **Stepper** →
[delivered: banner + rating] → **COD pay card** → **Rider card** (picked_up/OFD) → **Delivery
details** → **Order summary/bill** → **"Need help"** (WhatsApp) → **Cancel** → footer.
Modals: cancel-reason sheet (static refund note), address picker, receiver editor.
Loading = full-screen `BrandedLoader` (initial only). Error = `return null` (blank). Sockets =
`order:status`, `order:location`, `order:eta`. **No** dedicated ETA card, refund status, delay
state, structured support, or `order:item-unavailable` handler.

---

## 1. Missing sections

| Issue | Sev | Location | Recommended fix |
|---|---|---|---|
| **No dedicated ETA card** — ETA lives only in the thin gradient header string + the map badge | 🟠 High | header `:720`, map badge | Add the V2 **ETA hero card** (range→countdown, "by ~9:42", fallback-aware, late state). Spec §3. |
| **No refund status surface** — refund appears only as a *static note inside the cancel sheet* (`:916`), never after action | 🟠 High | post-cancel area; sheet `:916` | Add a **refund card** ("₹X to UPI · ~N days") derived from `Payment.refundedPaise`. Spec §10. |
| **No delayed-order state** | 🟡 Med | hero/ETA | "Running late" banner (client-light now; server-driven Phase 2). Spec §11. |
| **No structured support** — only WhatsApp + call | 🟡 Med | "Need help" `:860` | Issue-type help sheet + auto-resolution (Phase 2). Spec §8. |
| **No multi-shop group view** | 🟡 Med | n/a | Group tracking w/ per-shop status (group ETA Phase 2). Spec §12. |
| **No shop-info row** | ⚪ Low | n/a | Quiet "Packed by Chirawa Store" (non-navigable). Spec §7. |
| **Rider card lacks photo/vehicle/rating** | ⚪ Low-Med | rider card `:770` | Add in Phase 2. Spec §4. |

## 2. Wrong information hierarchy

- **🟠 High — ETA is buried, not the hero.** The single most important info (ETA) is a
  `numberOfLines={1}` line inside the gradient header (`:720`), visually subordinate to the
  map card below it. *Fix:* promote ETA to the **top hero card**; the header keeps only the
  phase label. Spec §1–3.
- **🟡 Medium — Map sits above the stepper even pre-pickup.** `showMapNow` renders the map
  from `confirmed` (`:668/:725`), pushing the real progress (stepper) and rider below a
  low-value map. *Fix:* map only at pickup; pre-pickup illustration; stepper higher.
- **⚪ Low-Med — Bill/details weighted equal to live info.** "Delivery details" + "Order
  summary" are large cards competing with live tracking. *Fix:* collapse them below the fold;
  keep ETA/rider/map up top.

## 3. Visual clutter

- **🟡 Medium — 6–7 equally-weighted full-width cards, long scroll, nothing collapsible**
  (map, stepper, COD, rider, details, summary, help, cancel). Spec wants ≤5 + collapsible
  timeline/bill. *Fix:* one focal point per phase; collapse timeline + bill.
- **🟡 Medium — Two ETA surfaces that can disagree:** header shows a **range** ("15–20 min")
  while the map badge shows a **point** ("~9 min") (`TrackingMap` etaSeconds). *Fix:* single
  source — the ETA card; the map badge mirrors it or drops the number.

## 4. Weak CTA placement

- **🟡 Medium — "Need help" CTA says *chat* but opens WhatsApp.** The card uses
  `tracking.chatTitle/chatSub` (`:865`) yet `handleNeedHelp` is a `wa.me` deeplink (`:549`).
  Expectation mismatch. *Fix:* honest label now; real in-app help sheet (Phase 2).
- **⚪ Low-Med — No single primary CTA per phase.** OFD→Call (icon-only, `:780`),
  delivered→Rate (ok), but late/issue states have no prominent action. *Fix:* one
  phase-primary CTA (OFD: Call · delivered: Rate · late: Get help).
- **⚪ Low — Cancel is a low-emphasis text button at the very bottom** (`:872`). Acceptable
  for a destructive action, but ensure it's discoverable while cancellable.

## 5. Poor map usage

- **🟠 High — Map shown too early.** `showMapNow = coords && !cancelled && !delivered`
  (`:668`) → during `confirmed/preparing/ready` the customer sees a map with only a home pin
  and a **"location unavailable"** badge (no rider yet). Empty 260 px map above the stepper.
  *Fix:* gate the map to `picked_up/out_for_delivery` (match `showRider`); pre-pickup show an
  illustration. Spec §2/§5.
- **🟡 Medium — No route polyline; rider marker teleports** every ~8 s (no interpolation).
  *Fix:* route line + smooth marker (Phase 2).
- **⚪ Low — Map is non-interactive** (`pointerEvents="none"` in `TrackingMap`), no expand /
  re-center. *Fix:* re-center + tap-to-expand (Phase 2).

## 6. Missing loading states

- **🟡 Medium — All-or-nothing loader.** Initial load shows a full-screen `BrandedLoader`
  (`:614`) — no skeleton of the hero/cards. (Good: it's **initial-only**, so the 15 s poll
  does *not* re-flash it — `fetchOrder` only `setLoading(false)`.) *Fix:* skeleton hero +
  card placeholders.
- **⚪ Low — No "ETA calculating" micro-state.** When `eta` is null the header falls back to
  "arriving soon" rather than an explicit "Calculating ETA…". Spec §13.

## 7. Missing error states

- **🔴 Critical — Blank screen on load failure.** `fetchOrder` **silently swallows** all
  errors (`:448`) and the screen does `if (!order) return null` (`:618`) → a **white screen
  with no message and no retry** when `getOrder` fails (network/`403`/not-found). This is
  exactly the earlier "Network request failed" pain reaching the UI. *Fix:* render an **error
  card with Retry**; never return null on first-load failure.
- **🟠 High — First-load vs poll failures are conflated.** The same silent catch covers both.
  *Fix:* surface the **first-load** failure; keep tolerating **poll** failures (stale data).
- **🟡 Medium — No offline / socket-drop feedback.** Socket disconnect is silent (no
  `connect_error` handling in the screen); the 15 s poll covers data but the user gets no
  "reconnecting/updating" signal. *Fix:* top inline "You're offline — reconnecting…" /
  "Updating…" banner. Spec §14.

## 8. Missing delayed-order UX

- **🟡 Medium — No late state; the ETA goes confidently wrong.** Past the promise, `etaText`
  clamps the low bound to `max(1, …)` (`:~671`), so a late order shows a perpetual "1–X min".
  *Fix:* when the local countdown passes 0, switch to "Taking a little longer" (client-light);
  server-driven late state + apology/credit in Phase 2. Spec §11.

## 9. Missing refund UX

- **🟠 High — No refund status after the fact.** A cancelled order shows only the
  "Cancelled" header; there is **no refund card**. The single refund mention is a *static*
  `refundNote` shown **before** cancelling, inside the sheet (`:916`). *Fix:* post-cancel
  **refund card** ("₹X refunded to UPI · expected ~N days") from `Payment.refundedPaise`. Spec §10.
- **🟡 Med-High — Out-of-stock refunds are invisible.** The server emits `order:item-unavailable`
  (line refunded + substitute), but the screen has **no listener** (sockets are only
  `status/location/eta`, `:471–485`). *Fix:* add the handler → inline "Atta out of stock —
  ₹85 refunded" + a substitute CTA. Spec §10.

## 10. Missing support UX

- **🟡 Medium — Support is a single WhatsApp deeplink + call rider.** No order-scoped issue
  types, no in-app resolution, no order context beyond the id in the prefilled message
  (`:549`). *Fix:* structured help sheet ("Item missing / Didn't arrive / Wrong item /
  Quality") with auto-credit + escalation (Phase 2). Spec §8.
- **🟡 Medium — Label/behaviour mismatch** (the "chat" card opens WhatsApp) — see §4.

---

## Prioritized summary

| # | Issue | Severity | Spec § |
|---|---|---|---|
| 7 | Blank screen on load failure (`return null` + silent catch) | 🔴 Critical | §14 |
| 1/2 | ETA not a hero card — buried in the header | 🟠 High | §3 |
| 9 | No refund status surface (post-cancel) | 🟠 High | §10 |
| 5 | Map shown pre-pickup ("location unavailable" map) | 🟠 High | §5 |
| 7 | First-load vs poll error conflated | 🟠 High | §14 |
| 9 | `order:item-unavailable` not handled | 🟡 Med-High | §10 |
| 3 | Card clutter + duplicate ETA surfaces | 🟡 Medium | §1 |
| 4 | "chat" CTA opens WhatsApp; no phase-primary CTA | 🟡 Medium | §8 |
| 8 | No delayed-order state (ETA clamps wrong) | 🟡 Medium | §11 |
| 6 | All-or-nothing loader; no "calculating" state | 🟡 Medium | §13 |
| 10 | Support = WhatsApp/call only | 🟡 Medium | §8 |
| 2 | Bill/details weighted equal to live info | ⚪ Low-Med | §1 |
| 1 | Shop row / rider photo-vehicle-rating absent | ⚪ Low | §4/§7 |

**Headline:** the screen is functionally complete but **(a) leaks load failures as a blank
screen (Critical), (b) buries the ETA instead of leading with it, (c) shows an empty map too
early, and (d) has no post-action refund or out-of-stock surface.** Fixing #7 (error state),
promoting the ETA to a hero card, gating the map to pickup, and adding a refund card are the
highest-leverage V2 changes — most are MVP-feasible on the already-shipped backend.

*No code written or files modified by this audit.*
