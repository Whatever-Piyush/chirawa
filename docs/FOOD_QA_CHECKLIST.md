# Bringly Food — Device QA Checklist (RC-1)

Manual test plan for real-device validation before pilot. Run on **Android**
(the launch platform) with a real UPI app installed. Each row: ☐ → ✅/❌ + note.

**Setup needed:** staging/prod-like API with `PAYMENTS_ONLINE_ENABLED=true` +
real (test-mode) Razorpay keys; migrations + `db:seed:food` applied; one seller
account linked to a restaurant (`Restaurant.sellerUserId`); one rider account;
two customer accounts (A, B). Use ₹59-item orders (Rishivan slush) to keep test
spend small.

Legend: 🍔 customer app · 🍽️ seller app (Restaurant tab) · 🛵 rider app · 🛠 backend/admin

---

## 1. Customer — discovery & cart

| # | Check | Expected |
|---|---|---|
| C1 | Food button visible in footer next to Special | Raised orange button, same design language as Special; existing tabs unchanged |
| C2 | Open Food tab | Header copy "Freshly prepared from Chirawa's favourite restaurants" + "Estimated Delivery: 30–50 mins (varies by your order)"; rail lists Aura → Bits & Bites → Dark Park → Foodies → Goggle Cafe → Rishivan (that exact order) |
| C3 | Tap each restaurant in rail | Right pane swaps in place; menu in rows of two under section headers; open/closed state correct for the current IST time |
| C4 | Rishivan menu spot-check | "Special Cheese Chilli Paneer Tandoori Burger" ₹110; Slush items ₹69; veg dots green |
| C5 | ADD an item | Button morphs to − 1 + stepper; cart bar appears with count + ₹ total |
| C6 | Increment to 3, decrement to 0 | Stepper counts correctly; at 0 reverts to ADD; cart bar hides when cart empties |
| C7 | Add items from a SECOND restaurant | Premium bottom sheet: "Items are from another restaurant" + [Start New Order] / [Continue Current Order] — never a toast/alert |
| C8 | Sheet → Continue Current Order | Cart unchanged, sheet closes |
| C9 | Sheet → Start New Order | Old cart cleared, attempted item added, cart bound to the new restaurant |
| C10 | With GROCERY items in the marketplace cart, add first food item | One-time informational sheet ("delivered separately") → [Got it] proceeds with the add; marketplace cart untouched |
| C11 | Marketplace cart pill on Food screens | The grocery CartDockPill does NOT float over food surfaces |

## 2. Customer — checkout & payment

| # | Check | Expected |
|---|---|---|
| C12 | Open View cart → Food Checkout | Items with steppers; bill: items total + **Delivery fee ₹30** ("Flat delivery fee for food orders") + grand total; visual language identical to grocery checkout |
| C13 | Payment methods | UPI preselected (not deselectable); **Cash on Delivery faded + "Coming Soon" badge**; tapping COD only shows an info toast |
| C14 | No address selected | Pay button routes to address selection first |
| C15 | Pay & Place Order | Razorpay sheet opens showing ONLY UPI options |
| C16 | Complete UPI payment | Verify runs → lands on Track Food Order; timeline shows "Order placed ✓" |
| C17 | **Payment failure** (fail in UPI app) | Error surfaced; tracking shows "Awaiting payment" banner with **Pay now** |
| C18 | **Dismiss payment sheet** without paying | Toast + tracking with pending-payment banner; **Pay now reopens the sheet**; completing it flips to paid |
| C19 | **Kill the app mid-payment**, complete payment in UPI app, reopen | Within ~5 min the order self-heals to "Order placed" (reconcile sweep) + push "Payment mil gaya ✓" |
| C20 | Double-tap Pay & Place Order | Exactly ONE order + ONE Razorpay order created (idempotency) |
| C21 | Closed restaurant (test outside hours or flip its switch) | Checkout button shows Closed and refuses; menu shows closed state |
| C22 | Place order, add nothing for 30+ min without paying | Order auto-cancels (`payment_timeout`) |

## 3. Customer — tracking, cancel, refund, history

| # | Check | Expected |
|---|---|---|
| C23 | Tracking timeline | Steps light up: placed → accepted → preparing → ready → picked up → on the way → delivered, with times; polls every ~10 s |
| C24 | Push notifications | Pushes at accepted / on-the-way / delivered (exactly one each) |
| C25 | Cancel while `paid` (before accept) | Cancel confirm → cancelled state + "refund 5–7 days" copy; `refund_status='processed'` on the row |
| C26 | Cancel button after restaurant accepts | Cancel option no longer offered |
| C27 | **Restaurant rejects** the order | Customer push "order cancelled + refund"; tracking shows cancelled + refund note |
| C28 | Restaurant never accepts (wait 15 min) | Auto-cancel + refund + push |
| C29 | Food order history (receipt icon on Food header) | All orders newest-first with status pills; tap opens tracking |
| C30 | Grocery Order-Again tab | Food orders do NOT appear there (separate pipelines) |

## 4. Restaurant (Seller app — Restaurant tab 🍽️)

| # | Check | Expected |
|---|---|---|
| R1 | Login as restaurant-linked seller | 🍽️ Restaurant tab appears; grocery-only sellers never see it |
| R2 | New paid order | Push "🍽️ Naya food order!"; order appears in आज के ऑर्डर within 15 s with items, total, elapsed time |
| R3 | Accept | Status pill flips; customer timeline + push update |
| R4 | Reject (confirm dialog warns full refund) | Order cancelled; customer refunded + notified |
| R5 | Preparing → Ready | Buttons advance the status; Ready puts the order in every rider's Food tab |
| R6 | Double-tap Accept | Single transition, no error, no duplicate customer push |
| R7 | Open/close toggle | बंद है ↔ खुला है; customer app reflects on next load; checkout blocks when closed |
| R8 | Menu tab → toggle item sold out | Strikethrough + "sold out"; item vanishes from customer menu; toggle back restores |
| R9 | History scope | Past orders (delivered/cancelled) listed |
| R10 | Restaurant "busy" workaround | Flip closed temporarily — documented pilot behaviour (no dedicated busy state) |

## 5. Rider (🛵 Food tab)

| # | Check | Expected |
|---|---|---|
| D1 | Restaurant marks Ready | Pickup appears in Food tab within 15 s: restaurant, items, **PAID ✓** badge, amount with "cash नहीं lena", drop shows **locality only** |
| D2 | Claim | Full drop address + receiver name/phone appear (only after claiming) |
| D3 | **Double claim** — second rider taps claim on the same order | Second rider gets "kisi aur rider ne le liya" + list refreshes; exactly one winner |
| D4 | Picked up → Out for delivery → Delivered | Buttons advance in order; customer timeline + pushes track each hop |
| D5 | Grocery Delivery tab | Marketplace deliveries unaffected |

## 6. Admin / Backend 🛠

| # | Check | Expected |
|---|---|---|
| A1 | `GET /food/admin/refunds` (admin JWT) | `[]` when clean; failed refunds appear here and self-clear after sweep retry |
| A2 | Force a refund failure (temporarily break Razorpay key, reject an order, restore key) | `refund_status: failed → processed` within ~2 sweep cycles |
| A3 | Reconcile logs | `food reconcile` tick lines; rescue/timeout/expiry actions logged with order ids |
| A4 | Restaurant availability via API | `PATCH /food/restaurant/open` works with seller JWT; 403 with customer JWT |
| A5 | Role guards spot-check | customer JWT on `/food/restaurant/*` → 403; rider JWT on `/food/cart` → 403; anon on `/food/restaurants` → 200 (public) |
| A6 | PII: rider pickups payload pre-claim | No street/phone/customerId/razorpay fields in `available[]` |
| A7 | Marketplace regression smoke | Grocery: browse → cart → COD checkout → seller accept → rider deliver — identical to pre-food behaviour |

## 7. Network resilience

| # | Check | Expected |
|---|---|---|
| N1 | Airplane mode on Food tab | Rail shows retry ↻; recovery on tap after reconnect |
| N2 | Kill app on tracking, reopen from history | State restores from server |
| N3 | Slow network (throttle) | Steppers stay optimistic then reconcile; no double-adds |
| N4 | Restaurant app backgrounded during new order | Push arrives; opening the app shows the order |
