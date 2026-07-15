# Bringly Customer App — Production Audit

**Date:** 2026-07-12 · **Scope:** `apps/customer-app` (+ `packages/api-client`, `packages/i18n` where the app depends on them) at branch `eng/p0-hardening`, working tree included.
**Method:** Fresh code-level audit — every claim below was verified against the current source this session (file:line citations throughout). Backend readiness is **out of scope**: it holds its own audit (`docs/FINAL_PRODUCTION_AUDIT.md`, 88/100 GO, conditional on the operational gate) and is not re-litigated here.
**Honesty note:** This is a *static* audit plus repo evidence. Items that can only be proven on a physical device (frame rates, haptics, real-network behaviour, TalkBack) are explicitly marked **[device-validate]** rather than asserted.
**Verification evidence this session:** `tsc --noEmit` → clean · `vitest` → 12/12 passing · launch context per `docs/PROJECT_BASELINE.md`: Android-first, COD-only, one town (Chirawa), Hindi/English.

---

## 1. Executive Summary

The customer app's **core commerce loop is genuinely production-grade**. This is not an MVP with gaps papered over: the checkout has a double-submit guard backed by server-side idempotency (`CheckoutScreen.tsx:201,486`), the API client aborts black-holed requests after 15s and single-flights token refresh with queued-waiter settlement (`api-client/src/index.ts:62–99,169–199`), session expiry is wired end-to-end (`onAuthFailure` → `SIGN_OUT`, `AuthContext.tsx:87`), tokens live in SecureStore, live tracking runs socket + 15s poll with a stale-socket banner and retry states, order history paginates with re-entrancy guards (`OrderHistoryScreen.tsx:253–279`), and the whole surface is bilingual with dark mode and a night "closed" theme.

What stands between this app and real customers is **not features — it is observability, resilience visibility, and launch hygiene**:

1. **You cannot see crashes.** There is no crash reporting of any kind in the app (backend has Sentry; the app has zero). `ErrorBoundary.componentDidCatch` logs only in `__DEV__` and reports nowhere in production.
2. **You cannot hotfix.** `expo-updates` is not configured (no `updates`/`runtimeVersion` in `app.json`) — every JS bug requires a full store release cycle at v1, the riskiest moment of the product's life.
3. **The app has two identities.** A root-level `app.json` + `eas.json` (untracked/new) declare package `in.bringly.customer`, EAS project `3c4033eb…`; `apps/customer-app/app.json` declares `com.chirawa.customer`, project `db00e0a8…`. Whichever directory a build is run from ships a different app.
4. **Failure is invisible to the user in the wrong places.** Home swallows every fetch error silently — sections just collapse (`HomeScreen.tsx:70–130`) — so a first-time customer on bad internet sees a mostly-empty page with no message and no retry. There is no global offline detection (no NetInfo anywhere).
5. **The funnel is dark.** Analytics coverage is 8 call sites, all on the Live Order Bubble. No screen views, no search/add-to-cart/checkout/purchase events. Launch decisions will be guesswork.

None of these is architecturally hard; together they are roughly **8–11 dev-days**. The recommendation is a **conditional GO**: fix the four P0s (≈3 days), take the P1 list into the same release train, and launch.

---

## 2. Launch Readiness Score: **78 / 100**

| Dimension | Score | Rationale |
|---|---|---|
| Core flows (browse→track) | 9/10 | Hardened, idempotent, retryable; verified path-by-path (§ Critical Flows) |
| Reliability & edge cases | 8/10 | Excellent client patterns; gaps are *visibility* (Home silent-collapse, no offline banner) |
| Observability | 2/10 | No crash reporting, no OTA, near-zero analytics |
| Accessibility | 4/10 | ~39 `accessibilityLabel` across 391 touchables (~10%); good foundations (Reduce Motion hook, live regions) but coverage is thin |
| Visual/UX consistency | 8/10 | Strong token discipline; 9 hardcoded English nav headers in a Hindi-first market |
| Performance (static review) | 7/10 | Native-driver animation, scoped timers, virtualized lists; no image-cache layer on an image-heavy app **[device-validate]** |
| Security | 9/10 | SecureStore, HTTPS prod, IDOR-guarded sockets (backend-verified), validated deep-link payloads |
| Launch hygiene | 4/10 | Build-identity drift, iOS unconfigured (accepted: Android-first), Play data-safety prep pending |

Scores are weighted toward what hurts real customers in week one. The backend's 88/100 does not transfer; this is the app-layer score.

---

## 3. What's Already Production Ready

Verified in code this session — credit where due:

- **Networking:** 15s abort timeout on every request; typed `ApiError` with codes; single-flight refresh where a *failed* refresh still settles all queued requests (previously-hung-forever bug already fixed) — `api-client/src/index.ts:59–99,169–199`.
- **Session lifecycle:** `onAuthFailure` → global `SIGN_OUT` (`AuthContext.tsx:87–92`); launch-time liveness probe via `/users/me` with server-side profile recovery on reinstall/new device; malformed-token hard reset.
- **Checkout & payment:** COD default with Razorpay lazy-loaded so the JS bundle boots without the native module (`CheckoutScreen.tsx:43–45`); place-order disabled until address + pricing + operating-hours + zero pending cart mutations (`:486`); double-submit blocked at source with server idempotency as the real guarantee (`:201`); pricing-preview failure keeps Place Order disabled with a visible error (`:663`).
- **Live tracking:** socket + 15s poll belt-and-braces; `disconnect`/`connect_error` → informational stale banner (poll keeps data flowing) (`OrderTrackingScreen.tsx:704–760`); load-failure retry states (`:558,897`); clock-skew-safe ETA countdown scoped to its own component so the 1s tick doesn't re-render the screen (`:127–141`).
- **Active orders / Live Order Bubble:** one shared socket app-wide via `ActiveOrdersProvider`; server-as-source-of-truth with debounced full-list refetch (immune to duplicate/out-of-order events); offline dot + reconnect recovery; Reduce Motion support; keyboard-aware; CartDockPill collision-proofed via shared `dockGeometry.ts`.
- **Order history:** page-1-reset refresh, `onEndReached` with ref-based re-entrancy guard, failed page keeps `hasMore` so scroll retries (`OrderHistoryScreen.tsx:249–279`).
- **Error boundary:** bilingual (Hindi-first), retry button, `__DEV__`-gated logging — `ErrorBoundary.tsx`.
- **Security posture:** tokens in SecureStore only (`storage.service.ts`); prod URL is HTTPS (`api.service.ts:5–7`); deep-link address payload validated before use (`ReceiveAddressScreen.tsx:43–46`); only 4 `console.*` in src, all dev-gated or FCM setup warnings.
- **i18n & theming:** ~730-line EN+HI catalogue incl. 13 empty-state keys; full dark palette mirroring every light token (`ThemeContext.tsx`); skeleton shimmers on Search, Food, Special, Addresses, Food Orders.
- **Lists:** everything long is `FlatList` (13 screens); Home's horizontal rails are bounded carousels.

### Screen-by-screen verdict

| Screen | Verdict | Notes |
|---|---|---|
| Splash | ✅ | Native Expo splash + font gate with cream fallback (`App.tsx:36–40`) |
| Login / OTP | ✅ | KeyboardAvoiding, resend (A2), OTP expiry countdown |
| Home | ⚠️ | Rich, but silent-collapse on fetch failure (P1-2); pull-to-refresh is the only recovery |
| Categories / Category products | ✅ | FlatList, header hardcoded EN (P1-5) |
| Search | ✅ | Debounced (2 tiers), stale-on-error, voice gated by availability, skeletons |
| Shop / Product | ✅ | Virtualized; product images uncached (P2-1) |
| Cart (dock + checkout list) | ✅ | Optimistic with pending-mutation gate |
| Checkout / Payment | ✅ | See §3 bullets |
| Order confirmation | ✅ | `gestureEnabled:false` + fade — no back-swipe into re-submission |
| Live tracking | ✅ | Strongest screen in the app |
| Order history | ✅ | Pagination hardened |
| Food (browse→track) | ✅ | Mirrors marketplace patterns; UPI-only by design |
| Profile | ⚠️ | Wishlist/GST/Rewards rows are "coming soon" alerts (`ProfileScreen.tsx:197–207`) — fine if intended, see P2-4 |
| Addresses (list/map/details/share) | ✅ | Permission-denial handled; deep-link share validated |
| **Help & Support** | ❌ | **Does not exist** — no screen, no route (P1-6) |
| Settings | ⚠️ | Split across Profile (theme/language) + AccountPrivacy; no single surface — acceptable, document it |

### Critical flow trace (Browse → … → History)

Every hop verified present and guarded: Home→Search (modal), Search→Shop/Product, add-to-cart (optimistic + FlyToCart), quantity stepper (busy-disabled, `CheckoutScreen.tsx:87–91`), Checkout (gates above), payment (COD path trivially safe; Razorpay lazy + result verification `verifying` state), OrderPlaced (back-locked), Tracking (bubble + strip + history all converge on `OrderTracking`), delivered → bubble celebration → history. **No broken journey found.** One soft spot: after `SESSION_EXPIRED` mid-checkout the user lands on login with cart intact (server-side cart) — acceptable, un-messaged (see UX-4).

---

## 4. P0 Launch Blockers

**P0-1 · No crash reporting in the app.**
Evidence: zero Sentry/Crashlytics references in `apps/customer-app`; `ErrorBoundary.componentDidCatch` is `__DEV__`-only. Launching to real customers on low-end Androids with no crash telemetry means the first sign of a bricked flow is a WhatsApp complaint. Backend Sentry proves the org already has the account/process. Fix: `sentry-expo` (or `@sentry/react-native`), wire `componentDidCatch` + global JS handler, tag with `versionCode`.

**P0-2 · No OTA update channel.**
Evidence: `app.json` has no `updates`/`runtimeVersion`; `expo-updates` not in dependencies. At v1, a single bad JS branch (e.g., a crash in checkout) is unfixable without a 1–7-day store review. Fix: configure EAS Update with a production channel + `runtimeVersion.policy`, verify a test update round-trips before launch.

**P0-3 · Build identity drift — two apps in one repo.**
Evidence: root `app.json` → `in.bringly.customer`, EAS project `3c4033eb…`; `apps/customer-app/app.json` → `com.chirawa.customer`, project `db00e0a8…`; `eas.json` exists in **both** root and app dir. A build kicked off from the wrong cwd ships a different package name under a different EAS project. The Android package is permanent on Play — this must be decided once, now (brand says `in.bringly.customer`; baseline history says `com.chirawa.customer`). Fix: pick one, delete the other pair of files, document in README.

**P0-4 · Home cold-start failure is silent.** *(promoted to P0 because it's the first-time-customer's first screen)*
Evidence: every Home loader swallows errors (`HomeScreen.tsx:70,79,84,103,111,130` — `catch { /* tolerate */ }`). On a failed cold start the customer sees a near-empty page, no message, no retry button; pull-to-refresh is undiscoverable for a first-timer. Fix: track a `loadFailed` flag when the *essential* loaders all fail → full-bleed "You're offline / tap to retry" state (i18n keys largely exist). Per-section tolerance can stay.

---

## 5. P1 Must Fix Before Launch

**P1-1 · No global offline detection.** No NetInfo anywhere in the app. Each surface degrades in its own way (search keeps stale, bubble shows a dot, Home collapses). A single top banner ("No connection — retrying…") via `@react-native-community/netinfo` unifies the story. Note: adds a native module → schedule *before* the store build, pairs with P0-2 decisions.

**P1-2 · Analytics funnel absent** — see §11. Minimum launch set: screen views + search / add_to_cart / begin_checkout / purchase / order_tracked, reusing the existing typed sink (`analytics.service.ts`) with one real provider.

**P1-3 · Push notification polish.** `expo-notifications` plugin is present and `NotificationsBootstrap` registers tokens, but `app.json` has **no `notification` key** (Android small icon/accent color) — order-status pushes will show the default grey Android bell. Also confirm FCM server key in the operational gate. **[device-validate]**

**P1-4 · Accessibility floor** — see §9. Minimum: labels on all icon-only touchables on Home header, tab bar, product cards, steppers; `accessibilityState` on toggles; TalkBack pass on the checkout flow. **[device-validate]**

**P1-5 · Nine hardcoded English navigation headers** in a Hindi-first market: `AppNavigator.tsx:261,275,284,293,302,311,328,337,346` ("Checkout", "Order Track", "My Addresses", "Confirm location", "Add address details", "Account & Privacy", "Food Checkout", "Track Food Order", "My Food Orders"). The screens themselves are bilingual — the headers betray them. Also `Alert.alert('Bringly', …)` title is fine, but audit the 25 alert bodies for the few not routed through `t()`.

**P1-6 · No Help & Support surface.** For a COD launch, "how do I cancel / where's my refund / call someone" is a trust requirement. Minimum viable: one static screen (FAQ + tel: link to the ops number + WhatsApp deep link) reachable from Profile. The cancellation FAQ copy already exists in i18n (`cancellation.*`).

**P1-7 · Play Store data-safety prep** (operational, listed for completeness): `READ_CONTACTS` permission (used by the "deliver to someone else" contact picker) needs a declared purpose in the Play data-safety form and a just-in-time in-app rationale, or Play review will flag it. Same form must cover location + phone number collection.

---

## 6. P2 Nice Improvements

- **P2-1 · Image caching:** no `expo-image`/FastImage — product/shop imagery re-fetches on RN's default cache heuristics. `expo-image` is a drop-in `<Image>` replacement with disk cache + blurhash placeholders; biggest single win for low-end-device feel. **[device-validate]**
- **P2-2 · React Navigation v6 → v7:** pnpm flags v6 as deprecated. Not urgent; schedule post-launch.
- **P2-3 · `@chirawa/types` OrderStatus import weight:** app imports from source (`main: ./src/index.ts`) — fine under Metro, just don't add server-only deps to that package.
- **P2-4 · Profile stub rows:** Wishlist/GST/Rewards show "coming soon" alerts (`ProfileScreen.tsx:197–207`). Either hide for launch or keep deliberately (they do set roadmap expectations); decide, don't default.
- **P2-5 · Search voice UX:** `voiceSearchAvailable` gating is correct; add a one-time tooltip explaining Hindi voice search — it's a differentiator for the market.
- **P2-6 · Bubble numeric ETA** fast-follow (needs `etaSeconds` in the orders-list DTO — documented in `Track_Order.md`).
- **P2-7 · Landscape/tablet:** no orientation lock in `app.json`; portrait-lock (`"orientation": "portrait"`) is the cheap correct answer for v1. *(Verify key — it was absent from the audited config.)*

---

## 7. UX Improvements

- **UX-1 (=P0-4):** Home failure state — the single highest-leverage UX fix.
- **UX-2:** After address permission denial (`AddressMapScreen.tsx:139,151`) the user gets an alert but no path forward; add a "open Settings" button (`Linking.openSettings()`).
- **UX-3:** Checkout `pricingError` (`CheckoutScreen.tsx:172,663`) disables Place Order correctly, but the retry affordance should be inline at the bill, not only at the top.
- **UX-4:** Session expiry mid-flow lands on login with no message. Pass a "session expired, please log in again" toast through the SIGN_OUT path — the string exists in the ApiError already.
- **UX-5:** OTP screen: auto-submit on 6th digit + SMS autofill (`textContentType="oneTimeCode"` / Android SMS Retriever) — check current state on device. **[device-validate]**
- **UX-6:** Cart pill + bubble + food conflict sheet can theoretically co-occupy the bottom zone with a tab bar — verified geometrically safe via `dockGeometry.ts`, but do one small-screen (≤360dp) visual pass. **[device-validate]**

## 8. Performance Improvements

Static review found **no red flags**, and several deliberate good patterns (scoped 1s ETA timer; native-driver everywhere; memoized bubble; single shared socket for active orders + one per-order socket only while tracking is open — both with clean disconnect on unmount/blur). Remaining items:

- **PF-1 (=P2-1):** image cache layer.
- **PF-2:** Home is a `ScrollView` of 8 sections — fine at this catalogue size; if rails grow, migrate to a virtualized section list. Not now.
- **PF-3:** `OrderTrackingScreen` is ~1,500 lines with a map; confirm `react-native-maps` lite-mode or bounds on low-end devices. **[device-validate]**
- **PF-4:** Battery: sockets close on unmount and the bubble's pulse pauses when idle/offline/reduced — verified in code; confirm no wakelock from `expo-location` on the address map after leaving the screen. **[device-validate]**
- **PF-5:** No memory-leak candidates found in hooks audit (all listeners/timers/sockets cleaned up); re-verify with a 30-minute soak on device. **[device-validate]**

## 9. Accessibility Improvements

Foundations exist and are better than typical RN apps at this stage: `useReducedMotion` respected by the bubble; `accessibilityLiveRegion` on live status; `MIN_TAP=48` + `HIT_SLOP` tokens in the theme; font scaling flows through the shared `Text`.

Gaps, in priority order:
1. **Coverage:** 39 labels / 24 roles across 391 touchables (~10%). Sweep: tab bar items (have labels ✅), Home header icons, search bar mic/clear, product card add-buttons, quantity steppers, address row actions.
2. **Announcements:** order status changes announce via the bubble only; add `AccessibilityInfo.announceForAccessibility` on tracking-screen phase transitions.
3. **Contrast:** white-on-`#FF6B35` icons ≈3.4:1 — acceptable for large graphics, not for the 10–11pt caption texts if ever tinted; keep captions `textPrimary` (bubble already does).
4. **Dynamic type:** shared `Text` scales, but a few fixed-height containers (48pt pill, 64pt tab bar) will clip at 1.3×+ scale — test at max font size. **[device-validate]**
5. **TalkBack end-to-end pass** on login→checkout→track. **[device-validate]**

## 10. Security Observations

No launch-blocking findings. Posture is strong:

- Tokens: SecureStore only; cleared on refresh failure; no tokens in AsyncStorage (profile-name cache only).
- Transport: HTTPS in prod; `http://DEV_HOST` strictly behind `__DEV__` (`api.service.ts:5`).
- Deep links: `ReceiveAddress` validates shape before use (`:43–46`) — recommend adding max-length caps on `street/locality` (paranoia, P2); `ShareAddress` payload is user-owned data.
- Logging: no PII in the 4 remaining `console.*` calls.
- Sockets: order rooms are IDOR-guarded server-side (backend audit ✓-verified).
- JWT parse at bootstrap (`AuthContext` `atob` on payload) trusts the *stored* token only for display identity, with server `/users/me` as the authority — acceptable.
- Watch item: the previously compromised Google Maps key (backend audit S1) — confirm the **app's** Mappls/Maps keys are restricted by package name + SHA-1 in the operational gate.

## 11. Analytics Gaps

Current instrumentation: **8 events, all Live-Order-Bubble** (`tracking_bubble_*`, `bubble_*`, `order_delivered_viewed`), firing into a typed sink with **no provider attached** (`analytics.service.ts` — events go nowhere by design until a provider is registered). The two `track(` hits in Cart contexts are an unrelated local helper, not analytics.

Missing for a commerce launch (minimum viable funnel):

| Event | Where |
|---|---|
| `screen_view` | navigation `onStateChange` (already centralized in `AppNavigator`) |
| `search` / `search_result_tap` | SearchScreen |
| `add_to_cart` / `remove_from_cart` | CartContext (single choke point ✅) |
| `begin_checkout` / `purchase` (+ amount, COD/online) | CheckoutScreen success path |
| `order_cancelled`, `login_success`, `otp_failure` | respective flows |

Plus: attach one real provider (PostHog self-hosted fits the org's infra taste) and forward the existing bubble events. Effort is small because the sink pattern already exists.

## 12. Visual Consistency Improvements

Token discipline is genuinely good (theme header comment "no hardcoded hex anywhere in screens" is *mostly* true). Remaining:

- **VC-1 (=P1-5):** English nav headers.
- **VC-2:** `CustomTabBar.tsx:26–29` hardcodes pill/icon hexes (`#FFF0E9`, `#2E7D32`…) — they don't adapt to dark mode; footer bg does. Low effort, visible nightly.
- **VC-3:** Bubble/pill/food-button raised language is consistent; `SpecialTab`/`FoodTab` duplicate ~40 lines — merge into one `RaisedTab` (maintenance, not visual).
- **VC-4:** Two "delivered" celebration styles (tracking screen 🎊 emoji vs bubble icon-based) — acceptable; pick one long-term.
- **VC-5:** `ErrorBoundary` uses static `Colors` (light palette) — dark-mode users get a light error screen. One-line theme read (class component → wrap in consumer).

## 13. Recommended Implementation Order

1. **P0-3** build identity (½ d) — unblocks all store work; everything else rides on the chosen package.
2. **P0-1** crash reporting (1 d) + **P0-2** EAS Update (1 d) — same native-build train.
3. **P1-1** NetInfo offline banner (1 d) — same native-build train (adds a module).
4. **P0-4/UX-1** Home failure state (½ d).
5. **P1-5/VC-1** header i18n + alert-body sweep (½ d).
6. **P1-2/§11** analytics minimum funnel + provider (1½ d).
7. **P1-6** Help & Support static screen (½ d).
8. **P1-3** notification icon/color + FCM device pass (½ d) **[device]**.
9. **P1-4/§9** a11y sweep + TalkBack pass (1–1½ d) **[device]**.
10. **P1-7** Play data-safety + permission rationale (½ d, parallel/ops).
11. P2s post-launch, `expo-image` (P2-1) first.

Items 2+3 must land **before** the release build is cut (native modules). Total critical path: **≈8 dev-days** engineering + the operational gate.

## 14. Estimated Effort Per Item

| Item | Effort | Native rebuild? |
|---|---|---|
| P0-1 Crash reporting | 1 d | Yes |
| P0-2 EAS Update | 1 d | Yes |
| P0-3 Build identity | 0.5 d | Yes (config) |
| P0-4 Home failure state | 0.5 d | No |
| P1-1 Offline banner | 1 d | Yes |
| P1-2 Analytics funnel | 1.5 d | Provider-dependent |
| P1-3 Notification polish | 0.5 d | Yes (config) |
| P1-4 A11y floor | 1–1.5 d | No |
| P1-5 Header i18n | 0.5 d | No |
| P1-6 Help & Support | 0.5 d | No |
| P1-7 Play data-safety | 0.5 d (ops) | — |
| P2-1 expo-image | 1 d | Yes |
| P2-2 Nav v7 | 2–3 d | Post-launch |
| Other P2/UX/VC | 0.25–0.5 d each | Mostly no |

## 15. Final Recommendation

**Conditional GO.** The customer app's commerce core is launch-quality — hardened in the places that lose money or orders (idempotent checkout, session lifecycle, tracking resilience). It is **not yet launch-safe operationally**: today you would ship an app you cannot observe (no crashes), cannot patch (no OTA), under an ambiguous identity (two packages), that goes silently blank for exactly the customer you most need to impress (first-timer, bad network).

Close the four P0s (~3 days, one native build train), pull P1s 1–6 into the same release, run the device-validation pass this audit marks **[device-validate]** (one mid-tier + one low-end Android), and ship. The P2 list is a healthy post-launch backlog, not debt.

The remaining distance to launch is short, finite, and enumerated above — the same posture the backend audit reached, now true of the app.
