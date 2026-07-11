# Bringly — Product & UX Audit (July 2026)

**Perspective:** first-time customer / PM / marketplace founder. Not an engineering review.
**Question answered:** *Can Bringly compete with Blinkit, Zepto, Instamart, Swiggy, Zomato as a product?*
**Scope reviewed:** customer app, seller app, rider app, admin surface — every screen in the repo as of `eng/p0-hardening`.

**Context that frames every judgment below:** Bringly is a single-town (Chirawa, ~333026), COD-only, 9 AM–8 PM hyperlocal service with salaried riders and 0% seller commission. The bar is not feature-parity with Blinkit; the bar is: *a first-time Chirawa user orders, gets the order, trusts the app, and orders again.* Findings are weighted accordingly.

---

## 1. Customer Journey Audit

### Launch → Login → OTP
| Step | Verdict |
|---|---|
| Language picker (Hindi/English) on first launch | ✅ Present, before anything else — right call for the market |
| Phone entry with +91, validation | ✅ Clean |
| OTP verify | ⚠️ **No "Resend OTP", no countdown timer, no SMS autofill** (`VerifyOtpScreen.tsx`) |
| Wrong number recovery | ✅ "Change number" goes back |
| Profile setup (name/DOB) interceptor | ✅ Blocks main app until name exists — good |

**P0 finding — OTP dead end.** If the SMS doesn't arrive (routine on Indian carriers), the user's only move is to go back and resubmit the whole phone form — which the API may rate-limit without explaining. This is the top of the funnel; every user passes through it. Blinkit/Zepto all have resend-with-countdown.

### Location & first browse
- App-open prompt when GPS permission is off, with "select manually" escape hatch (`LocationPermissionModal`) — ✅ good.
- Address flow: map pin (Google map tiles, Mappls geocoding/autosuggest via backend) → details form with house/landmark/label → save. Edit mode supported. ✅
- **Delightful & unusual:** address sharing via `bringly://` deep links, and "request address from someone else" over WhatsApp — genuinely clever for gifting/ordering for parents. No big competitor has this.
- ⚠️ No serviceability gate UX: an address outside Chirawa isn't clearly rejected at selection time (backend enforces at pricing/order time — user finds out late).

### Browse → Search → Product
- Home: daily essentials rail, bestseller clusters, curated category sections, night theme + "closed" banner outside 9 AM–8 PM. ✅ Polished.
- Search: recent searches, browse feed while idle, debounced results, **voice search in Hindi** (`VoiceSearchSheet`), filters (category, price, in-stock) + sort (incl. rating), no-results state. ✅ Competitive — better than expected for v1.
- Product detail: image gallery, pack-size variants, in/out-of-stock states, related products. ✅
- ❌ No wishlist/favorites (Profile row shows "coming soon" alert), no "recently viewed."
- ❌ No product reviews to read — ratings are collected per-order but customers can't see other people's ratings or comments on a product page.

### Cart → Checkout
- No separate cart page: the floating "View cart" pill (visible on all browse surfaces, correctly hidden on transactional ones) goes straight to Checkout, which doubles as the cart with quantity steppers. This is the Blinkit pattern — ✅ fine.
- Delivery-fee savings nudge with progress bar (₹25 → ₹10 at ₹100) ✅.
- "You might also like" rail in checkout, race-safe with order placement ✅.
- Payment: COD selected; "Pay Online" visible but marked coming-soon (deliberate flag `FEATURES.onlinePayments=false`) ✅ honest presentation.
- Cancellation policy shown before ordering ✅.
- Store-closed state disables Place Order with a notice ✅.
- ❌ **No promo-code entry field** — even though the backend fully supports promo validation (`promotions.service.ts`) and the i18n strings + styles for the promo UI still exist (orphaned in `CheckoutScreen.tsx`). Customers cannot redeem any code you print on a flyer. For a launch-marketing town push, this is a real loss.
- ❌ **No discount line in the bill.** The backend auto-applies FIRSTORDER (free delivery on first order), and `pricing.routes.ts` returns `discount` + `appliedPromoCode` — but the bill renders only Items Total, Delivery Fee, Grand Total. A first-order customer sees a bill whose lines don't add up to the total, and never learns they got a gift. This is *worse* than not having the promo: it looks like a math bug and squanders the delight moment.
- ❌ No delivery instructions, no rider tip (both were designed — styles remain — then cut).

### Order placed → Tracking
- Celebration screen, auto-advance to tracking, hardware-back blocked during it, multi-shop split breakdown ✅.
- Tracking screen is the strongest surface in the app: live ETA hero with clock-skew-safe countdown, collapsible 5-phase timeline with timestamps, socket + 15s poll fallback, "reconnecting" banner, refund visibility card, out-of-stock-at-pickup alert **with substitute suggestion**, rider card with call button, COD "pay on delivery" amount card, change address / change receiver before pickup, cancel with reason sheet (until preparing starts), WhatsApp help with order ID prefilled. ✅✅
- ❌ **The live map can never show the rider.** The map renders during picked-up/out-for-delivery and waits for `order:location` socket events — but the rider app **never publishes location** (`expo-location` is imported and unused; zero socket emits in the rider app). The backend ingest path is fully built (`realtime.plugin.ts`: authz, Redis, broadcast, persistence) and simply has no producer. Every customer on every order will watch a map with a permanent "location unavailable/stale" state. A broken promise is worse than no promise.
- ⚠️ No delay handling: when an order blows past its ETA it switches to "Arriving soon" forever (acknowledged stopgap in code). No proactive "we're late, here's what's happening" messaging.

### Delivery → Rating → Reorder
- Delivered: confetti banner + 5-star rating with comment, thank-you state, rating visible in order history ✅.
- Reorder: on every order card; clears cart with confirmation, re-adds items, lands in checkout ✅.
- ❌ No invoice/receipt (no share/download bill, no GST invoice — "GST details" row is a coming-soon alert).
- ❌ No refund *history* page (refunds show on the order's tracking page only).

### Return after hours / reopening the app
This journey has the single biggest navigation gap:

> Customer places an order at 10 AM, closes the app, reopens at noon. **Home shows nothing about the active order.** They must know to tap the "Order Again" tab and find the card with the Track button — or have kept the push notification.

Blinkit/Zepto/Swiggy all pin an active-order strip/banner on Home. Bringly's notification taps deep-link correctly (including cold start — nicely done in `NotificationsBootstrap`), but if the user swiped the notification away, discovery of an in-flight order relies on remembering that history lives in a tab labeled **"Order Again"** — a label that says "shop here," not "your active order is here."

### Order history
- Cards with status chips, date, totals, Track/Reorder, rate-link ✅.
- ❌ **Hard cap of 20 orders.** The screen fetches page 1 (limit 20) once; the "infinite scroll" only re-slices that same array (`OrderHistoryScreen.tsx`). A weekly shopper loses access to everything past ~2 months. Old orders become unfindable — an unrecoverable dead end.
- ⚠️ Error state is hardcoded Hindi even in English mode.

### Support / account
- Help = WhatsApp. For a small town with a founder-operated ops desk this is the right v1 model, **but**:
- ❌ **P0: Profile → "Need help?" and Account & Privacy → data-download / delete-account all open WhatsApp to `919999999999` — a placeholder.** The tracking screen uses the real number (`916350076685`). So the *only* support entry points a user can find without an active order are dead. Delete-account (a Play-Store compliance requirement) is also behind this dead number.
- ⚠️ Legal links point to `chirawa.in/privacy|terms` while the brand everywhere else is Bringly and deep links use `bringly.in` — brand mismatch users can notice (and a store-review risk if the pages 404).
- ✅ Dark/light/system theme, language switch, logout confirm, account summary.
- ❌ No FAQs, no notification inbox/center (push only — if you swipe it, it's gone), no order-issue flow ("item missing/damaged" leads to WhatsApp free-text).

---

## 2. Seller Journey Audit

**Present and working:** OTP + PIN login; live order queue with socket push, continuous alarm (vibration, optional sound), notification-tap deep link that reopens the Accept/Reject modal after cold start; accept / reject with reasons; preparing → ready progression; cancelled-order alerts; auto-accept after seller timeout (backend safety net); stock screen with availability toggle, stock quantity, price+MRP edit, **barcode-scanner add-product against a master catalog**, image upload; settlement screen with today/week/month sales, best seller, unsettled balance, settlement history (0% commission).

**Missing / gaps:**
- ❌ **No pause-store / holiday toggle and no per-shop business hours.** A seller who runs out for an hour keeps receiving alarmed orders they must individually reject ("Dukaan band hai" is literally one of the canned reject reasons — the feature is being simulated through rejections, which hurts the customer experience and the seller's metrics).
- ❌ No store profile management (name, address, photo, contact) — profile tab is only a Logout button.
- ❌ No seller-side coupons/discounts; no price-drop promotions.
- ❌ No reports beyond three tiles (no downloadable statement, no item-wise report).
- ❌ No payout/bank account setup visible (how do sellers get paid / verify where?).
- ❌ No rider visibility ("who is picking up, when") on ready orders; no rider contact.
- ❌ No support channel at all inside the seller app.

For a founder-managed pilot where you personally onboard every shop, these are survivable — but pause-store will be requested in week one.

## 3. Rider Journey Audit

**Present:** OTP + PIN login; online/offline toggle (giant button — appropriate); incoming-assignment modal with 60s countdown, vibration alarm, order + COD indicator; active batch view grouped Pickup → Deliver with "sab pickup pehle" gating; navigate buttons (Google Maps link-out); call customer; COD cash-collect confirmation with amount; delivered state; Hinglish UI matching the workforce.

**Broken / dishonest:**
- ❌ **Accept and Decline are theater.** Accept just closes the modal ("Accept is handled by backend assigning — just dismiss"); Decline also only closes the modal, calling no API. The backend keeps the assignment either way. A rider who declines (or lets the 60s expire) still owns the order — it silently sits in their Delivery tab while they believe they've refused it. This *will* produce stuck orders and confused riders in week one. Either wire a real reject/reassign endpoint or remove Decline and the fake countdown, and present it as "New delivery assigned to you."
- ❌ **No location publishing** (see customer tracking above). One `watchPositionAsync` → socket emit would light up the flagship customer feature the backend already supports.
- ❌ Earnings screen is a stub: delivery counts + hardcoded "₹7,500 Monthly Salary." No real payroll data, no trip history detail, no incentives. Fine for salaried v1, but the hardcoded number will be wrong the moment a second pay grade exists.
- ❌ No COD reconciliation ("how much cash am I carrying / owe tonight?") — a daily flashpoint for COD operations. (A `COD_CAP` constant exists in code and is used nowhere.)
- ❌ No proof of delivery (photo/OTP), no call-seller, no support contact, profile = logout only.

## 4. Admin Journey Audit

**There is no admin product.** There are useful JSON endpoints (`admin.routes.ts`: dispatch live-ops snapshot, search-alias management, catalog moderation — master status, image-report resolution, takedowns, price outliers — coverage, metrics, category-image upload), but no UI of any kind (the route itself says "the full UI is Chunk 9"). Day-one operations — "cancel this order," "refund this customer," "ban this user," "push this notification," "create a coupon" — have **no tool**, not even curl-able endpoints for several of them (no admin order-cancel/refund/user routes exist).

Reality check: the founders will run ops over WhatsApp + database console. That works for ~20 orders/day and becomes the growth ceiling immediately after.

---

## 5. Missing Screens
1. **Resend-OTP affordance** on Verify screen (not a screen, but the missing element of one).
2. **Active-order strip/banner on Home** (and on Order Again tab above the fold).
3. **Notification inbox** (customer) — push-only today.
4. **Help/FAQ screen** (customer; and any support surface at all for seller/rider).
5. **Invoice / bill share** view per order.
6. **Refund history** (list level; per-order card exists).
7. **Seller: store settings** (pause, hours, profile).
8. **Rider: COD cash summary + trip history.**
9. **Admin: everything** (dispatch board, order ops, refunds, catalog, users).
10. Wishlist (entry point exists and dead-ends into an alert).

## 6. Missing Navigation
- Home ⇄ active order (biggest one — see above).
- "Order Again" label hides order *history/tracking* semantics.
- Profile is reachable only via the Home-header avatar (deliberate; acceptable, but note the tab bar shows no Profile).
- No universal-link hosting yet (`https://bringly.in/*` listed but not live), so shared links/deep links outside the app scheme won't open the app.
- Search results → product → back preserves state ✅; no dead ends found in browse loops.

## 7. Missing Features (vs. modern hyperlocal baseline)
**Customer:** promo-code entry ▸ discount visibility ▸ wishlist ▸ recently viewed ▸ product-level reviews display ▸ invoices/GST ▸ wallet ▸ referral UI (backend already issues codes!) ▸ loyalty UI (flagged off — deliberate) ▸ tips ▸ delivery instructions ▸ scheduled delivery ▸ order-issue flows (missing/damaged item) ▸ force-update mechanism (no expo-updates / version gate — old builds live forever) ▸ analytics & crash reporting (Chunk 10 planned, absent — you're launching blind).
**Seller:** pause store ▸ hours ▸ store profile ▸ discounts ▸ payout details ▸ reports.
**Rider:** real reject ▸ location publishing ▸ real earnings ▸ COD ledger ▸ POD.
**Admin:** the dashboard.

## 8. Broken User Flows
1. **Support from Profile / delete-account → WhatsApp to a placeholder number** (`919999999999` in `ProfileScreen.tsx`, `AccountPrivacyScreen.tsx`). Dead end at the worst moment.
2. **Rider Decline → order still assigned** (silent inconsistency between what the rider believes and reality).
3. **Customer live map → permanently rider-less** (producer never wired).
4. **First-order discount → invisible + bill lines don't sum** to the charged total.
5. **Order #21+ → unreachable** (history pagination cap).
6. OTP not received → no in-screen recovery.

## 9. Dead Ends
- Wishlist / GST / Rewards rows → "coming soon" alerts (acceptable only if they survive one release; three of them in one list reads unfinished).
- Delete account & download-my-data → dead WhatsApp number (compliance-relevant).
- Notification swiped away + no Home banner → user must rediscover tracking by intuition.
- Seller/rider apps: zero support paths — any problem dead-ends at "call the founder if you have his number."

## 10. Confusing UX
- "Order Again" as the name of the orders/history/tracking tab.
- Bill that doesn't itemize the auto-discount (math looks wrong).
- Rider's fake 60-second countdown implying a choice that doesn't exist.
- Brand split: app = Bringly; legal/API domains = chirawa.in; tagline mark = "chirawa". Users see two names.
- COD card on tracking offers "Pay online" → tapping it toasts "coming soon" (a button that exists only to refuse; drop it until Razorpay ships).
- Hardcoded Hindi error strings in English mode (order history offline state).

## 11. Expected-but-missing (competitor table)

| Capability | Blinkit/Zepto/Instamart | Bringly |
|---|---|---|
| OTP resend / autofill | ✅ | ❌ |
| Active order on Home | ✅ | ❌ |
| Live rider on map | ✅ | ❌ (backend ready, no producer) |
| Coupons/offers UI | ✅ | ❌ (backend ready, no UI) |
| Product reviews display | ✅ | ❌ (collects, doesn't show) |
| Wallet / refunds to wallet | ✅ | ❌ (COD-only: low urgency) |
| Invoices | ✅ | ❌ |
| Scheduled slots | ✅ (Instamart) | ❌ (9–8 town model: fine) |
| Tips / instructions | ✅ | ❌ |
| Search + filters + voice | ✅ | ✅ (voice in Hindi is a differentiator) |
| Substitution on OOS | ✅ | ✅ (suggestion after refund — good) |
| Order cancel w/ reasons | ✅ | ✅ (pre-preparing) |
| Mid-order address/receiver change | rare | ✅ (differentiator) |
| Address sharing/request | ❌ | ✅ (differentiator) |
| Multi-shop single cart | ❌ | ✅ (group orders — differentiator) |
| Dark mode + night store theme | partial | ✅ (charming) |
| Hindi-first i18n | partial | ✅ |

Where Bringly is *ahead*: address sharing, multi-shop carts, honest COD UX, night theming, voice search, change-receiver. The core loop, when it works, feels loved, not cloned.

---

## 12–14. Scores

| Dimension | Score | Rationale |
|---|---|---|
| **Product completeness** | **58 / 100** | Customer core loop ~85% complete and genuinely competitive; seller ~60% (works, no store controls); rider ~40% (functional path exists; accept/decline/location/earnings hollow); admin ~10% (API-only). Growth layer (promos/loyalty/referral) built server-side but invisible. |
| **UX quality** | **72 / 100** | The flows that exist are polished: error/retry states, skeletons, animations, i18n, offline banners on tracking, cold-start deep links. Docked for the six broken flows in §8 and the naming/bill confusions in §10. |
| **Customer delight** | **74 / 100** | Confetti, night sky, Hindi voice search, address gifting, birthday capture — real personality. Delight collapses at the edges: dead support number, invisible first-order gift, rider-less map. |

## 15. Launch readiness (product perspective)

**Conditional GO for a single-town, COD, founder-operated soft launch** — after the P0 list below, which is roughly 2–4 days of work, none of it architectural. The engineering foundation (sockets, queues, promo engine, moderation, settlement) is *ahead* of the product surface; most P0s are "turn on what's already built" or "stop promising what isn't."

**Do not scale marketing** (flyers with coupon codes, second town, >50 orders/day) until P1 lands: there is no promo entry, no admin tooling, no analytics, and no force-update path — all four become bottlenecks exactly when growth starts.

## 16. Priority roadmap

### P0 — before launch (trust & dead ends)
1. Replace placeholder WhatsApp number in Profile + AccountPrivacy with the real support number (one constant, three files — consider centralizing).
2. Add Resend OTP with countdown (+ `autoComplete="sms-otp"` / `textContentType="oneTimeCode"`).
3. Rider location: wire `watchPositionAsync` → `rider:location:update` socket emit during active delivery, **or** remove the customer map for launch. Ship the broken-promise fix either way.
4. Rider Decline: call a real reject/reassign API or remove the button + fake timer.
5. Render the discount line + "FIRSTORDER applied — free delivery 🎉" in the checkout bill (data is already in the pricing response).
6. Fix order-history pagination (fetch next pages on scroll).
7. Active-order banner on Home (an `/orders?active` check on focus + a tappable strip).
8. Verify `chirawa.in/privacy|terms` actually resolve; align on one public brand.
9. Remove the "Pay online" refusal button from tracking's COD card.

### P1 — first month (operate & grow)
1. Promo-code input in checkout (backend done).
2. Minimal admin web dashboard: dispatch board (endpoint exists), order cancel/refund actions, catalog moderation UI.
3. Seller pause-store toggle + per-shop hours.
4. Rider COD cash summary + real earnings source; delete the hardcoded salary figure.
5. Product ratings surfaced on PDP/listing (data being collected already).
6. Order-issue flow (missing/damaged → structured WhatsApp template or in-app form).
7. Invoice share (even a text/HTML bill via the share sheet).
8. Analytics + crash reporting (Chunk 10) and a force-update gate.
9. Notification inbox (simple list backed by the notifications table).
10. Localize the hardcoded Hindi error strings.

### P2 — later (scale levers)
- Online payments GA (Razorpay is integrated end-to-end behind flags), wallet + refund-to-wallet.
- Referral UI + loyalty launch (`FEATURES.growthLoops` — needs the unlock worker rebuilt per `features.ts` note).
- Wishlist, recently viewed, product reviews with text.
- Tips, delivery instructions, scheduled slots.
- Proof-of-delivery photo; rider incentives; seller self-serve promotions.
- Multi-town model (per-town hours/serviceability), universal links, web storefront.
- Live chat or in-app support center replacing raw WhatsApp.

---

*Grounding: every claim above was verified against the code (screens listed in §1–4 map to files under `apps/customer-app/src/screens/**`, `apps/rider-app/src/screens/**`, `apps/seller-app/src/screens/**`, `apps/api/src/modules/**`). Key evidence: placeholder number `ProfileScreen.tsx:37` / `AccountPrivacyScreen.tsx:11` vs real number `OrderTrackingScreen.tsx:43`; rider no-op accept `rider-app HomeScreen.tsx:85-103`; unused location import `DeliveryScreen.tsx:6` + zero emits; backend ingest `realtime.plugin.ts:150-200`; history cap `OrderHistoryScreen.tsx:193-249`; promo backend `promotions.service.ts` vs orphaned styles `CheckoutScreen.tsx:951-969`; discount omitted from bill `CheckoutScreen.tsx:471-501`; auto-accept `seller-timeout.plugin.ts`; admin JSON-only `admin.routes.ts:117`.*
