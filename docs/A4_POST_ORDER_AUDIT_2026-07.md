# Milestone A4 — Orders & Post-Order Experience Audit (July 2026)

**Scope:** everything after "Place Order" — tracking, delivery, rating, order history, order details, invoices, refunds, reorder, support, repeat purchase. Audit only; no implementation.
**Baseline:** working tree including A1 (active-order recovery), A2 (login), A3 (pricing transparency). Every claim below was verified against code this session.
**Context that frames judgments:** single town, COD-only, ≤50 orders per customer realistically in year one, founder-operated support over WhatsApp.

---

## 1. Executive Summary

The **live** half of the post-order journey — placed → tracking → delivered — is genuinely competitive, in places better than the big apps. The **archival** half — what an order becomes after the confetti — is thin and carries three trust-breaking defects: the money line on every order-history card renders **"₹NaN"**, order history silently caps at 20 visible / 50 fetchable orders, and a delivered order's "detail view" hides its own timeline, payment method, and rider. Post-order support has a working entry from tracking but still dead-ends from Profile (placeholder WhatsApp number, open since the first audit) — and the order reference the app puts into the support message doesn't match any reference shown on screen.

Verdict: **the journey works until the customer looks back.** Fixing the archival half is mostly display work on data the API already returns.

## 2. Current Journey Review — what exists and what already works well

| Step | State | Notes |
|---|---|---|
| Order placed → tracking | ✅ **Excellent** | Celebration → auto-advance; ETA countdown, 5-phase timeline, socket+poll, reconnect banner, OOS-item alerts **with substitute suggestion**, refund card, mid-order address/receiver change, cancel with reasons. Best surface in the app. |
| Tracking re-entry | ✅ **Solid (A1)** | Home strip (live, restart-safe, multi-order, group-aware), notification deep links incl. cold start, Order Again tab. Explicitly: this now works well — no further work needed. |
| Delivery moment | ✅ Good | Confetti + rating card (1–5 + comment), thank-you state. |
| Rating | ✅ Adequate | Collected per order; stars shown in history; "rate" link from history lands on the rating card. Not editable after submit (acceptable). |
| Bill transparency | ✅ **Solid (A3)** | Checkout, success, and tracking bills reconcile: items/fee/discount/savings. |
| Order history list | ⚠️ Mixed | Good: status chips, Track/Reorder per card, skeletons, pull-to-refresh, charming empty state ("Reordering will be easy"), reorder product grid. Bad: see §4. |
| Order detail | ⚠️ Weak for finished orders | Tracking screen doubles as detail — great live, hollow after delivery (§4.3). |
| Reorder | ⚠️ Fragile | Confirm-replace dialog is right; failure behavior is not (§4.4). |
| Invoices | ❌ None | No view/share/download; GST row in Profile is a "coming soon" alert. |
| Refunds | ✅ *for COD scope* / ❌ beyond | Per-order refund card with cash-adjustment wording is exactly right for COD line-refunds. No refund history/status center — acceptable until online payments. |
| Support | ⚠️ Split | From tracking: WhatsApp with order ref prefilled, real number ✅. From Profile: placeholder number ❌ (open since first audit). |
| Repeat purchase | ✅ Good | Reorder grid + bestsellers on the orders tab; Home rails. |

## 3. Missing Features
1. Order search / filters (by status, store, date, ID) — none.
2. Invoice: view/share/download; GST invoice.
3. Refund history list + refund status states (initiated → completed).
4. Active/past sectioning in the orders list (actives are mixed into one chronological list).
5. Delivered-order completeness: payment method, delivered-at timestamp, rider name, shop info, cancellation reason echo (stored in `Order.cancelReason`, never shown).
6. Reorder availability preflight ("2 of 5 items unavailable — add the rest?").
7. Order-issue flow (missing/damaged item → structured path) — today it's free-text WhatsApp.

## 4. Broken Flows (verified)
1. **₹NaN on every order card** — `OrderHistoryScreen` reads `item.total`; the API's raw rows carry `totalAmount`. The money line on the order list has never rendered. (`OrderHistoryScreen.tsx:290`)
2. **History hard-caps** — client fetches page 1 × 20 and its "infinite scroll" re-slices that array; the server ignores `page`/`limit` entirely and returns newest 50 (`orders.service.getMyOrders`, `take: 50`). Order #51 is unreachable forever; #21–50 are fetched but never shown.
3. **Delivered order detail is hollow** — the timeline renders only `!isDelivered` (the one order state where a customer wants the receipt-view of what happened); payment method shows only on *active* COD orders; rider identity disappears after delivery.
4. **Reorder aborts mid-cart** — items re-add in a sequential loop; the first unavailable/deleted product throws, leaving a **partially filled cart** and a generic error. No per-item skip, no "prices may have changed" notice.
5. **Support reference mismatch** — WhatsApp message sends `orderId.slice(0, 8)` (first 8); every screen (and the seller/rider views) shows `slice(-6)` (last 6). Support cannot correlate the customer's message to an order. Three formats coexist on one screen (`-6` header, `-10` summary, `0,8` support).
6. **Profile → "Need help?" still dials the placeholder number** (`919999999999`) — the only support entry a user can find without an open order.

## 5. UX Problems
- Offline/error strings on the orders list are hardcoded Hindi even in English mode.
- Confetti + delivered banner replay on *every* revisit of an old delivered order — delight becomes noise (minor).
- Status chips collapse everything active into one word ("Active") — fine — but give no refund indicator on refunded/cancelled cards.
- The orders list loads *all shops* just to label cards (fine at town scale; note for later).

## 6. Navigation Problems
- **Tab label "Order Again"** still names the marketing verb, not the noun users hunt for ("Orders"). Recommendation open since A1; the i18n key (`home.tabOrders`) already exists. One-line change whenever approved.
- No dead ends found in the live loop (A1 closed them): every tracking entry has a working back path. Explicitly: navigation *into* tracking is now solved.
- Dead end that remains: Profile → help (wrong number), and any impulse to "get a bill."

## 7. Missing Screens
None required. The single-screen model (tracking = detail) is right for this product — it needs *states*, not new screens: a "finished order" presentation of the same screen (timeline expanded, payment method, rider, shop, refund/cancel reason). A refund center and invoice viewer are P2 screens tied to online payments.

## 8. Missing Actions
Share bill · download/view invoice · search orders · filter orders · report an issue (structured) · edit rating (P2) · repeat-order shortcut from tracking screen itself (Reorder lives only on history cards — minor).

## 9. Edge Cases

| Case | Verdict |
|---|---|
| Reinstall / new phone / multiple devices | ✅ Server-side orders + A2 profile hydration — history and names survive. |
| Force close / restart mid-delivery | ✅ A1 Home strip + notifications. |
| Offline | ✅ Retry states everywhere (tracking banner, list retry) — minus the Hindi-only strings. |
| Hundreds of orders | ❌ Invisible past 20/50 (§4.2). |
| Deleted/renamed products in old orders | ✅ Names snapshotted on order items (good design) — but ❌ reorder of them aborts the cart (§4.4). |
| Store closed at reorder time | ⚠️ Items add silently; checkout then blocks. Works, but a heads-up at tap time would be kinder. |
| Cancelled order revisit | ✅ Timeline shows the cancelled branch; ❌ chosen reason never echoed. |
| OOS refund mid-delivery | ✅ **Best-in-class**: socket alert, refund card, substitute suggestion. |
| Multiple active orders | ✅ A1 strip + group cards. |

## 10. Competitor Comparison

**They have, Bringly doesn't:** finished-order detail (payment method, address, savings recap, invoice download) · refund center · structured per-order issue flows ("item missing") · order search (Swiggy/Zomato) · scheduled repeats/subscriptions (Zepto) · editable ratings.
**Bringly does better:** mid-order address & receiver change · multi-shop single cart with group tracking · OOS substitute suggestion at pickup · honest COD messaging · night theming · WhatsApp-native support fit for its town.
**Parity:** live tracking UX (minus the rider-location producer, out of A4 scope), rating capture, reorder existence, notification deep links.

## 11–13. Priorities

**P0 — trust bugs (post-order money & reference integrity):**
1. Fix ₹NaN money line (read `totalAmount`).
2. Real pagination: server honors `page`/`limit` (backend change, flagged) + client fetches on scroll. Removes both the 20 and 50 caps.
3. Unify order references on last-6 everywhere, including the WhatsApp support message.
4. Fix Profile/AccountPrivacy placeholder support number (two constants — carried from the first audit, now blocking the post-order support path).
5. Finished-order state on tracking: show timeline (expanded) for delivered orders, payment method line, delivered-at time, rider name, cancel-reason echo. Display-only; data already in the response.
6. Localize the orders-list offline strings.

**P1 — completeness:**
7. Reorder robustness: per-item add with per-item failure tolerance → summary ("Added 4 of 5 — Parle-G is unavailable"), price-change note, closed-store heads-up at tap.
8. Orders list: Active/Past sections (actives pinned on top) + refunded chip on cards. No search yet.
9. Share bill: order summary → OS share sheet as formatted text (invoice-lite; zero backend).
10. Tab rename "Order Again" → "Orders" (pending since A1).
11. Reorder button on the finished-order (tracking) screen.

**P2 — later:**
12. PDF/GST invoices (pair with online payments) · refund center · order search/filters · editable rating window · confetti-once polish · structured issue flow · subscriptions.

## 14. Final UX Score — **76 / 100**
Live journey ~90 (tracking is the app's crown jewel; A1–A3 closed its gaps). Archival journey ~55: broken money line, capped history, hollow finished-order view. Weighted toward the live loop, which is what customers feel most.

## 15. Product Completeness Score — **64 / 100**
Against the full post-order checklist (orders, details, invoices, refunds, search, support): strong on tracking/rating/reorder-existence/refund-for-COD; absent on invoices/search/refund-center; broken on history depth.

## 16. Recommended implementation roadmap
- **A4-impl-1 (P0):** items 1–6. One small backend change (pagination params honored — additive, default keeps current behavior); everything else client display work. Est. the smallest milestone yet, highest trust yield.
- **A4-impl-2 (P1):** items 7–11. Zero schema changes; item 9 needs no backend at all.
- **Later:** P2 bundle rides the online-payments milestone (invoices + refund center belong together).

*Everything above was code-verified this session: `OrderHistoryScreen.tsx` (NaN line 290, page-1 fetch line 194, local-slice pagination), `orders.service.ts` (`take: 50`, ignored params), `OrderTrackingScreen.tsx` (timeline `!isDelivered` gate, COD-card gating, rider gating, ID slices at lines 802/987/1185), `ProfileScreen.tsx`/`AccountPrivacyScreen.tsx` (placeholder number), `schema.prisma` (`cancelReason` stored, no invoice/instruction fields).*
