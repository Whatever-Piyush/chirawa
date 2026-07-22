# Track Order — The Live Order Bubble

**Status:** Production specification — source of truth for implementation
**App:** `apps/customer-app`
**Owner surface:** Customer application (global, cross-screen)
**Component name:** `LiveOrderBubble`

> This document is the single source of truth. Implementation must match it exactly.
> Where a product decision had two reasonable answers, the choice is recorded as
> **Decision (locked)** with rationale so it can be challenged before build, not after.

---

## Vision

Today, getting back to a live order means finding the Home screen, not scrolling
past the Active-Orders strip, or digging into the Order-Again tab. The moment the
customer leaves Home, the thread to their in-flight order is lost.

The **Live Order Bubble** is a small, premium, always-present floating circle in
the bottom-right corner that keeps that thread unbroken. It is not a navigation
button with a label that says "Track". It is a **live status object**: a circular
progress dial that fills as the order advances, a professional icon that changes
with each phase, and a short status word underneath the customer's thumb.

**Why it exists:** In hyperlocal commerce the anxious window is short (minutes,
not days) and intense — "did the shop accept it?", "has the rider left?", "how
close is it?". A Tier-1 experience answers those questions *before* the customer
has to ask. The bubble turns "where is my order" from a search task into a glance.

**How it builds confidence:**

- **"My order is safe."** The bubble persists across every screen and survives
  scroll, app backgrounding, force-quit and restart — because its data comes from
  the server, not local memory. If it's there, the order is real and tracked.
- **"I know exactly what's happening."** The dial + status word ("Accepted",
  "Preparing", "On the way") reflect live socket updates within a second of the
  server changing state.
- **"I can track it instantly."** One tap opens full tracking. No hunting.

This is a signature interaction pattern for Bringly. It should feel as considered
as the CartDockPill and share its design language — not bolted on.

---

## UX Principles

| Principle | What it means here |
|---|---|
| **Always visible** | Renders as a sibling of the navigator (like `CartDockPill`), so it floats above every screen and is never clipped by a ScrollView. |
| **Minimal distraction** | A single 60pt circle in the corner. No banners, no takeover, no sound. Motion is subtle and stops when nothing is changing. |
| **One-tap tracking** | A single press opens the tracking screen (or the orders list when there are several). Never a multi-step path. |
| **Feels alive** | A slow breathing pulse while an order is in progress; a crisp pop + haptic on each real status change. It reads as *live*, not decorative. |
| **Professional** | Ionicons line/solid icons — **never emoji**. Colours, radii, shadows and motion all come from the design system. |
| **Fast** | No extra network calls of its own; it reads the already-shared active-orders feed. Animations run on the native driver at 60 FPS. |
| **Accessible** | ≥48pt target, VoiceOver/TalkBack labels that speak the live status, honours Reduce Motion and large text. |
| **Consistent** | Same tokens, spacing rhythm, shadow elevation and spring curves as `CartDockPill` and `ActiveOrdersStrip`. |

---

## Behaviour

- **Appears only when there is at least one active order.** "Active" reuses
  `useActiveOrders`' definition (any order not in `DELIVERED`/`CANCELLED`).
- **Auto-dismisses after delivery.** When the featured order flips to
  `delivered`, the bubble shows a brief success state, then animates out and
  unmounts. When it flips to `cancelled` it is dropped from the feed and the
  bubble updates or dismisses accordingly.
- **Persists across the application.** Visible on all main surfaces (see
  *Placement*), unaffected by navigation between tabs and pushed screens.
- **Unaffected by scrolling.** It is absolutely positioned outside all scroll
  containers.
- **Respects safe areas.** Bottom offset derives from `useSafeAreaInsets()`.
- **Respects the keyboard.** Hidden while the software keyboard is open (it would
  otherwise collide with input accessories / float mid-screen on Android where the
  view resizes). Reappears on dismiss.
- **Respects bottom sheets & modals.** Hidden on the `Search` modal and while the
  Food conflict sheet is presented; never draws over a focused modal surface.
- **Respects the CartDockPill.** When the cart pill is visible the bubble rides
  one row above it so the two never overlap (see *Placement*).

**Decision (locked) — coexistence with the Home Active-Orders strip:** the strip
stays on Home (rich, glanceable detail), and the bubble shows on every surface
*including* Home. They are driven by the **same** shared feed, so they can never
disagree. Rationale: Blinkit/Swiggy/Zepto all run a persistent pill *and* an
inline home card; the strip answers "show me details", the bubble answers "take me
there from wherever I am". A single flag (`HIDE_BUBBLE_ON_HOME`) is left in code to
flip this trivially if product prefers the strip-only Home.

---

## Placement

- **Corner:** bottom-right.
- **Horizontal inset:** `Spacing.lg` (16) from the right edge.
- **Vertical, on tab screens:** `insets.bottom + TAB_BAR_BASE(64) + GAP_ABOVE_BAR(10)`
  — sits just above the footer / Special / Food buttons.
- **Vertical, on pushed screens (no tab bar):** `insets.bottom + STACK_GAP(16)`,
  or `insets.bottom + PRODUCT_BAR(96)` on Product Detail (clears its add-to-cart
  bar). These constants are shared with `CartDockPill`.
- **Cart-pill coexistence:** when `cartPillVisible(activeRoute, cartCount)` is
  true, add `CART_PILL_HEIGHT(48) + CART_PILL_GAP(10)` to the bottom offset so the
  bubble stacks above the centred cart capsule. No horizontal collision is possible
  on any width because the bubble is right-aligned and lifted a full row.
- **Elevation:** `Shadow.lg` base with a brand-tinted variant (`Shadow.primary`
  colourway) so it lifts off the page consistently with other floating UI.
- **Never overlaps floating UI:** the shared geometry module (`dockGeometry.ts`) is
  the single source of truth for both floats, preventing drift.

---

## Appearance

A premium circular floating bubble — a **status object**, not a labelled button.

| Element | Spec (as built) |
|---|---|
| **Outer disc** | **64pt** "coin" (surface-coloured) carrying the tick ring — comfortably above the 48pt min target, expanded further via `hitSlop`. |
| **Core circle** | 48pt, tone fill (`Colors.primary` `#FF6B35` in progress; `Colors.warning` for payment-due; flips to `Colors.success` `#00C48C` on delivered). |
| **Progress dial** | Segmented ring of **5 ticks** in the 6pt band between core and disc edge (see *Progress Indicator*). Filled ticks = tone colour; empty ticks = `Colors.surfaceAlt` (legible on the surface disc in both themes). |
| **Icon** | Single Ionicon, 22pt, `Colors.white`, centred. Changes per phase (see *Dynamic Status*). **No emoji, ever.** |
| **Status caption** | 1-word caption pill above the circle (11pt, `FontWeight.semibold`), background `Colors.surface` @ `Shadow.sm`. Text uses `Colors.textPrimary` (not the tone) so warning-yellow stays AA-legible; the tone lives in the core + dial. `pointerEvents:none` so it never blocks touches; truncates to one line. |
| **Count badge** | When 2+ active orders: an 18pt badge at top-right, `Colors.surface` bg, `Colors.primary` border (1.5), primary text showing the count. |
| **Offline dot** | When the socket is disconnected/stale: a 10pt `Colors.textTertiary` dot replaces the live pulse and the caption reads "Reconnecting…". |
| **Shadow** | `shadowColor: Colors.primary`, offset `{0,6}`, opacity `0.30`, radius `14`, `elevation 12`. Delivered state switches shadow colour to `Colors.success`. |
| **Corner spacing** | 16 right / 10 above the nearest floating element or tab bar (above). |

**Exact sizes (as built):** 64pt disc, 48pt core, ~6pt ring band, 5 ticks ×
(3.5pt wide × 7pt tall, `Radius.full`), 16pt right inset, ≥48pt hit area via
`hitSlop`.

**Delivered celebration scope (as built):** the green "Delivered" flash is driven
by the `delivered` socket event (the REST feed drops delivered orders), and fires
only for the clean *"your last remaining order just arrived"* case — never
misattributed to a delivered child of a multi-shop group or a background order. In
multi-order cases the delivered order simply drops from the feed and the bubble
re-features the next.

---

## Dynamic Status

The bubble never just says "Track". It speaks the order's current phase. The 9
`OrderStatus` values collapse into the same **5 display phases** the tracking
screen already uses (`STATUS_STEP5`), plus two non-progress states (payment
pending, cancelled). Copy lives in i18n (`liveOrder.*`); English shown here.

| OrderStatus | Phase (step) | Caption (EN) | Ionicon | Core / accent colour | Motion |
|---|---|---|---|---|---|
| `pending_payment` | — (0) | **Payment due** | `card-outline` | `Colors.warning` | gentle pulse; tap resumes payment on tracking |
| `paid` | 0 | **Placed** | `receipt-outline` | `Colors.primary` | pulse |
| `confirmed` | 0 | **Accepted** | `checkmark-circle` | `Colors.primary` | pop on entry |
| `preparing` | 1 | **Preparing** | `cube-outline` | `Colors.primary` | pulse |
| `ready_for_pickup` | 1 | **Packed** | `bag-check-outline` | `Colors.primary` | pop |
| `picked_up` | 2 | **Picked up** | `bicycle-outline` | `Colors.primary` | pop |
| `out_for_delivery` | 3 | **On the way** | `navigate` | `Colors.primary` | pulse (fastest cadence) |
| `delivered` | 4 | **Delivered** | `checkmark-done-circle` | `Colors.success` | success pop + haptic, then dismiss |
| `cancelled` | — | (removed from feed) | — | — | bubble updates/dismisses |

**Numeric ETA ("8 min", "Almost there"):** the bubble's data source
(`getMyOrders`) does **not** include ETA today — ETA is computed on the single-order
detail/tracking path. So **v1 shows phase captions, not a live minute countdown.**
The precise minute ("8 min") remains on the full tracking screen (`EtaHero`).
*Fast-follow (documented, not built here):* add a lightweight `etaSeconds` to the
orders-list payload; when present and the featured order is `out_for_delivery`,
the caption becomes "N min" and, under ~3 min, "Almost there". This is a
backend+DTO change and is intentionally out of v1 scope to avoid per-order detail
fetches from the bubble.

---

## Progress Indicator

A **segmented progress dial** wraps the core circle — chosen over a continuous SVG
arc because (a) `react-native-svg` is **not** a dependency and adding it is
unnecessary, and (b) a 5-tick dial mirrors the existing 5-segment progress bar in
`ActiveOrdersStrip`, keeping one visual language for "order progress" across the app.

- **5 ticks**, evenly spaced at 72° around the core, top-anchored (12 o'clock =
  first tick), filling clockwise.
- **Fill mapping** (phase step → filled ticks): `filledTicks = step + 1`.

| Phase (step) | Statuses | Filled ticks | Reads as |
|---|---|---|---|
| 0 | placed / accepted / payment-due | 1 / 5 | "just started" |
| 1 | preparing / packed | 2 / 5 | "being prepared" |
| 2 | picked_up | 3 / 5 | "rider has it" |
| 3 | out_for_delivery | 4 / 5 | "on the way" |
| 4 | delivered | 5 / 5 | "complete" |

- Filled ticks animate in one-at-a-time with a 60ms stagger on a status change.
- Delivered fills all five and recolours the whole dial to `Colors.success`.
- Implementation is pure `View` + rotation transforms (native driver), no new deps.

---

## Animations

All motion uses the RN `Animated` API on the **native driver** (transforms/opacity
only), matching `CartDockPill`/`ActiveOrdersStrip`. Every animation below is
**skipped or reduced to an instant state change when Reduce Motion is on.**

| Moment | Animation | Timing |
|---|---|---|
| **Appearance** | scale `0.8→1` (spring) + fade `0→1` | tension 200 / friction 18 (≈320ms) |
| **Dismiss** | fade `1→0` + scale `1→0.85` (timing), then unmount | 220ms |
| **Status change** | core pop `1→1.12→1` (spring) + one extra dial tick fills + brief caption cross-fade | 260ms pop, 60ms/tick |
| **Delivered** | success pop + colour morph to green + all ticks fill | 400ms, then 1.2s hold, then dismiss |
| **Live pulse** | halo ring behind the core scales `1→1.6`, opacity `0.35→0`, looping | 1800ms in-progress; 1200ms for `out_for_delivery` (subtly faster = "closer") |
| **Bounce on press** | scale `1→0.9→1` | 80ms down / 120ms up |

**Haptics** (`expo-haptics`, already installed):

- Press → `ImpactFeedbackStyle.Light`.
- Transition into `delivered` → `NotificationFeedbackType.Success`.
- No haptics for routine phase changes (avoids buzz fatigue).

**Motion restraint:** at most one looping animation at a time (the pulse). No
parallax, no confetti, no continuous rotation. When idle (no status change, Reduce
Motion on, or offline) the bubble is completely still.

---

## Multiple Orders

`useActiveOrders` already returns one entry per order **or per multi-shop group**
(groups are collapsed with a least-advanced-child status). The bubble consumes that
list directly.

- **0 active orders:** bubble hidden.
- **1 active order:** bubble reflects that order's live phase (dial + caption +
  icon). Tap → `OrderTracking` with `{ orderId, groupId? }`.
- **2+ active orders:**
  - **Featured order = the newest active entry** (the feed is newest-first, so
    `entries[0]`). Rationale: the order the customer most recently acted on is the
    one they're most likely looking for; it's also the most predictable rule.
    (An alternative "most-advanced/closest-to-arrival" rule is documented in code
    behind `FEATURED_STRATEGY` for easy change.)
  - **Count badge** shows the total active count.
  - Tap → the **Order-Again list** (`MainTabs → OrderHistory`), where every active
    order has its own Track button — mirrors the existing strip's "view all".
- **Newest vs previous:** the bubble always features the newest; previous orders
  remain reachable via the list (2+) or their own bubble state once the newest
  completes and drops out of the feed.

---

## Integration

Reuse-first. No parallel implementations, no second socket.

- **ActiveOrders:** a new `ActiveOrdersProvider` calls `useActiveOrders()` **once**
  at the app root and exposes `{ entries, connected, refresh }` via
  `useActiveOrdersContext()`. `HomeScreen` switches from calling the hook directly
  to consuming the context. The bubble consumes the same context. → one socket, one
  fetch loop, guaranteed-consistent strip ↔ bubble.
- **Socket updates:** unchanged. `useActiveOrders` already joins the per-user room
  (`user:{id}`), listens to `order:status`, debounces bursts (400ms) and re-GETs
  the authoritative list. The bubble simply re-derives its state from `entries`.
- **Navigation:** uses the shared `navigationRef` (guarded by `isReady()`), exactly
  like `CartDockPill`. Renders as a sibling of `Stack.Navigator` in `AppNavigator`.
- **CartDockPill:** shares `dockGeometry.ts` (constants + `cartPillVisible`
  predicate). CartDockPill is refactored to import from it (no behaviour change).
- **Tracking screen:** the destination. No changes to `OrderTrackingScreen`; the
  bubble navigates to the existing route with the existing params.
- **Shared contexts:** lives inside `AuthContext` (auth gate), `CartProvider`
  (reads `useCart().count` for the collision predicate) and the new
  `ActiveOrdersProvider`. No new global state beyond the one provider.

---

## Accessibility

- **VoiceOver / TalkBack:** `accessibilityRole="button"`, and a live
  `accessibilityLabel` composed from the status, e.g. *"Live order — On the way.
  Double-tap to track."* For 2+: *"2 live orders. Double-tap to view all."* The
  label updates as the phase changes (`accessibilityLiveRegion="polite"` on
  Android; label recompute on iOS).
- **Large touch target:** 60pt visual, expanded via `HIT_SLOP` to comfortably clear
  48pt even accounting for the corner inset.
- **Contrast:** white icon on `#FF6B35` ≈ 3.4:1 (large-graphic/AA for the icon
  glyph size); caption text uses `textPrimary`/phase colour on `surface` (AA). The
  offline dot pairs with a text caption, never colour-only.
- **Dynamic text:** the caption uses the app `Text` component (respects font
  scaling); it truncates to one line and never pushes the circle. The circle itself
  is icon-based, unaffected by text scale.
- **Reduced motion:** `useReducedMotion()` (wrapping
  `AccessibilityInfo.isReduceMotionEnabled()` + change listener) disables the pulse
  and all springs; appearance/dismiss/status changes become instant opacity/state
  swaps. The bubble remains fully functional and legible.
- **Colour-independence:** every state is conveyed by icon + caption, not colour
  alone.

---

## Offline Behaviour

- **Offline indicator:** when the shared socket is disconnected (or the last
  successful sync is stale), the live pulse is replaced by a static offline dot and
  the caption reads "Reconnecting…". The last-known phase/dial remain visible (the
  order didn't vanish — we just can't confirm changes right now).
- **Reconnect:** `useActiveOrders` already refetches on socket `connect`
  (post-first) and re-arms its auth token on `connect_error`. On reconnect the
  bubble's state refreshes automatically and the pulse resumes.
- **Socket recovery:** handled entirely by the existing hook; the bubble adds no
  socket of its own.
- **Background resume:** the hook refetches on `AppState → active`. Returning to the
  app shows fresh state within one request.
- **Cold launch:** server is the source of truth. On mount the provider fetches the
  list; if the user has an active order, the bubble appears without any local
  persistence. Nothing to hydrate, nothing stale.

**New requirement on the hook:** expose a `connected: boolean` (and derive `stale`)
so the bubble can render the offline affordance. This is a small additive change to
`useActiveOrders` — it already owns the socket lifecycle.

---

## Edge Cases

| Case | Handling |
|---|---|
| **Very long tracking** (order sits in a phase for a while) | Static bubble in that phase; pulse continues; no timers spin needlessly. |
| **Multiple deliveries** | Featured = newest; badge = count; list on tap. As each completes it drops from the feed and the bubble re-features the next. |
| **Cancelled order** | Filtered out by `useActiveOrders`. If it was featured, bubble re-features the next active order or dismisses. |
| **Payment pending** | Shown as "Payment due" (warning). Tap → tracking, which can resume the UPI/Razorpay sheet. |
| **Payment failed** | Order goes `cancelled` → removed from feed → bubble updates/dismisses. |
| **Network changes** (wifi↔cellular) | Socket drops+reconnects; hook refetches; offline dot shows only during the gap. |
| **App killed** | No local state relied upon; relaunch refetches from server. |
| **Phone restart** | Same as cold launch. |
| **Slow backend** | Bubble keeps last-known state (hook keeps the previous list on a failed fetch); no spinner flash. |
| **Late websocket event** | Hook re-GETs the full list on any event → always reflects server truth regardless of event lateness. |
| **Duplicate events** | Debounced (400ms) and idempotent (full-list refetch) → no double work, no flicker. |
| **Out-of-order events** | Irrelevant: state is derived from the authoritative list, not from applying deltas in sequence. |
| **Keyboard open** | Bubble hidden (see Behaviour). |
| **On the tracking screen already** | Bubble hidden (route not in allowlist). |

The debounce + full-refetch design is the key robustness property: the bubble is a
**pure projection of server state**, so late/duplicate/out-of-order sockets can't
corrupt it.

---

## Performance

- **No unnecessary renders:** `LiveOrderBubble` is `React.memo`; derived view-state
  (phase, colour, icon, ring fill, caption) computed via `useMemo` over `entries`
  and `activeRoute`. The segmented dial is a memoized subcomponent.
- **Shared socket:** exactly one, owned by `useActiveOrders` via the provider. The
  bubble opens none.
- **No duplicate subscriptions:** migrating `HomeScreen` to the context removes the
  second `useActiveOrders` instance (and its socket) that would otherwise exist.
- **Native-driver animations:** all transforms/opacity; no JS-thread animation. 60
  FPS target on mid-range Android.
- **No per-second work:** v1 has no countdown; the only timer is the pulse loop
  (native driver, cheap) which is stopped when idle/offline/reduced-motion.
- **Battery:** no polling; event-driven refetch only. Pulse pauses when the order
  isn't in an active-motion phase if we choose (config), and always under Reduce
  Motion.

---

## Analytics

No analytics infrastructure exists in the app yet, so a **single minimal, typed
sink** is introduced (`analytics.service.ts`) — one `track(event, props?)` entry
point with a typed event union and a provider-ready dispatch (no console logging;
a documented no-op/queue until a provider is wired). All events fire through this
one function so there is no scattered instrumentation.

| Event | When | Key props |
|---|---|---|
| `tracking_bubble_viewed` | Bubble first becomes visible in a session/for an order | `orderId`, `phase`, `activeCount` |
| `tracking_bubble_pressed` | User taps the bubble | `orderId`, `phase`, `activeCount` |
| `tracking_opened` | Navigation to tracking succeeds | `orderId`, `groupId?`, `source: 'bubble'` |
| `multiple_orders_viewed` | Bubble shown with `activeCount ≥ 2` | `activeCount` |
| `bubble_hidden` | Bubble leaves (route/keyboard/no-active) | `reason` |
| `bubble_dismissed` | Auto-dismiss after delivered | `orderId` |
| `order_delivered_viewed` | Delivered state rendered on the bubble | `orderId` |

Events are debounced/de-duped per order+phase so a socket burst can't spam them.

---

## QA Checklist

**Platforms & sizes**
- [ ] Android (mid-range) — placement, shadow (elevation), haptics
- [ ] iOS — placement, shadow, haptics
- [ ] Small device (≤360dp width) — no overlap with CartDockPill, caption truncates
- [ ] Large device / tablet-ish — bubble stays corner-anchored, not stretched

**Network**
- [ ] Poor network — last-known state held, offline dot on drop
- [ ] Offline → online — pulse resumes, state refreshes on reconnect
- [ ] Wifi ↔ cellular switch — brief offline dot only

**Lifecycle**
- [ ] Background → foreground — refetch, correct phase
- [ ] Cold launch with an active order — bubble appears, no flash of wrong state
- [ ] App killed / phone restart — reappears from server truth

**Navigation & surfaces**
- [ ] Visible on Home, Categories, Special, Food, Profile, Order-Again, Shop,
      Product, Category
- [ ] Hidden on Search modal, Checkout, OrderPlaced, address flows, auth, tracking
      screens, and while the Food conflict sheet is open
- [ ] Deep link into tracking — bubble hides on that screen, restores on back
- [ ] Cart pill present — bubble stacks above, never overlaps

**States**
- [ ] Each phase renders correct icon/caption/colour/dial fill
- [ ] 2+ orders — badge count, tap → list
- [ ] Delivered — success pop → auto-dismiss
- [ ] Cancelled/payment-failed — removed cleanly

**Accessibility**
- [ ] VoiceOver/TalkBack reads live status; double-tap tracks
- [ ] Reduce Motion — no pulse/springs, still functional
- [ ] Large font — caption truncates, circle unaffected

**Other**
- [ ] Keyboard open — hidden, restores on dismiss
- [ ] Landscape — corner anchoring holds
- [ ] Dark mode (future) — colours pull from theme context, ready when dark ships

---

## File Changes (implementation plan)

Reuse-first; no parallel sockets; no new runtime dependencies (haptics already
present; ring is dependency-free; vitest is the repo's existing test runner).

### New files

| File | Purpose |
|---|---|
| `apps/customer-app/src/utils/liveOrder.ts` | **Pure, framework-free logic.** `resolveLiveOrderState(status)` → `{ step, captionKey, icon, tone }`; `filledTicks(step)`; `selectFeatured(entries)`; `activeCount(entries)`. The one place order→UI mapping lives (reuses `STATUS_STEP5` semantics). |
| `apps/customer-app/src/utils/liveOrder.test.ts` | **Vitest** unit tests for every mapping, featured-order selection, tick counts, terminal filtering. |
| `apps/customer-app/src/components/dockGeometry.ts` | Shared floating-dock geometry constants (`TAB_BAR_BASE`, `GAP_ABOVE_BAR`, `STACK_GAP`, `PRODUCT_BAR`, `CART_PILL_HEIGHT`, `CART_PILL_GAP`, route allowlists) + `cartPillVisible(activeRoute, cartCount)`. |
| `apps/customer-app/src/context/ActiveOrdersContext.tsx` | `ActiveOrdersProvider` (calls `useActiveOrders` once, auth-gated) + `useActiveOrdersContext()`. |
| `apps/customer-app/src/hooks/useReducedMotion.ts` | Wraps `AccessibilityInfo.isReduceMotionEnabled()` + change listener. |
| `apps/customer-app/src/components/LiveOrderBubble.tsx` | The floating bubble: visibility rules, positioning (via `dockGeometry`), animations, haptics, navigation, analytics, a11y. Props: `{ activeRoute?: string }`. |
| `apps/customer-app/src/components/LiveOrderDial.tsx` | Memoized 5-tick segmented progress dial (dependency-free). |
| `apps/customer-app/src/services/analytics.service.ts` | Minimal typed `track(event, props?)` sink + event union. |
| `apps/customer-app/vitest.config.ts` | Minimal vitest config so the pure-logic tests run (mirrors `apps/api`'s vitest). |

### Modified files

| File | Change |
|---|---|
| `apps/customer-app/src/navigation/AppNavigator.tsx` | Wrap authed tree in `<ActiveOrdersProvider>`; render `<LiveOrderBubble activeRoute={activeRoute} />` as a sibling of `Stack.Navigator`, beside `CartDockPill`, gated on `isAuthenticated && name`. |
| `apps/customer-app/src/components/CartDockPill.tsx` | Import geometry + `cartPillVisible` from `dockGeometry.ts` (move its local constants there). No visual change. |
| `apps/customer-app/src/screens/home/HomeScreen.tsx` | Consume `useActiveOrdersContext()` instead of calling `useActiveOrders()` directly. |
| `apps/customer-app/src/hooks/useActiveOrders.ts` | Additively expose `connected` (socket state) for the offline affordance; behaviour otherwise unchanged. |
| `packages/i18n/src/translations.ts` | Add `liveOrder.*` keys: per-phase captions, a11y labels (single/multi), "Reconnecting…", "Payment due". EN + HI. |
| `apps/customer-app/package.json` | Add `vitest` devDependency + `"test": "vitest run"` script (repo-standard runner) so the pure-logic tests execute. |

### Hooks / contexts / components / tests summary

- **Hooks:** `useActiveOrders` (modified, +`connected`), `useReducedMotion` (new),
  `useActiveOrdersContext` (new).
- **Contexts:** `ActiveOrdersProvider` (new).
- **Components:** `LiveOrderBubble`, `LiveOrderDial` (new); `CartDockPill`
  (refactor-only).
- **Services:** `analytics.service` (new).
- **Tests:** `liveOrder.test.ts` (new, vitest) — pure logic only (RN component
  testing is out of scope; the app has no RN test harness and adding one is not
  justified for this feature).

### Verification per step (this repo's reality)

- **Typecheck:** `cd apps/customer-app && npx tsc --noEmit` (strict; extends
  `expo/tsconfig.base`). Run after each major step.
- **Tests:** `pnpm --filter <customer-app> test` (vitest) for `liveOrder.ts`.
- **Lint:** the customer-app has no ESLint config; there is no lint step to run.
  Code must match the surrounding style instead.
- **Manual/interaction:** drive the app (`/run`) to verify appearance, motion,
  stacking with the cart pill, keyboard hide, and the delivered→dismiss flow.

---

## Out of scope for v1 (documented fast-follows)

- Numeric ETA ("8 min") on the bubble — needs `etaSeconds` in the orders-list DTO.
- Food-delivery orders — they have a separate `FoodOrderTracking` flow and no
  active-food feed; unifying is a follow-up.
- Dark mode — colours already come from the theme context, so the bubble is ready
  when dark ships; no dedicated work now.
- Wiring analytics to a real provider (Segment/PostHog/etc.) — the typed sink is
  provider-ready.
