# Tracking V2 — Customer Experience Spec

**Author lens:** Head of Product, q-commerce. **The tracking page is the product** after
checkout — it's where trust is won or lost. The job: answer *"where is my order and when
will it arrive"* in one glance, proactively, beautifully, with self-serve recovery when
things go wrong.

**Foundation already shipped** (this spec builds on it, doesn't re-derive it):
- **BUG-1** — rider identity fixed (delivery completion + COD work).
- **BUG-2** — `GET /orders/:id` returns `rider {name, phone}`, gated to `picked_up`/`out_for_delivery`
  and to customer/rider/admin (never seller).
- **ETA Phase 1** — server `eta {secondsRemaining, spreadSeconds, serverNow, source}` in `GET`,
  recomputed per phase, coord-based (no provider calls), best-effort.
- **Live ETA** — `order:eta` socket push (P3) + `order:status` + `order:location`; 15 s poll fallback.

Sources: `TRACKING_PAGE_RESEARCH.md`, `ETA_ARCHITECTURE.md`, `ETA_ARCHITECTURE_REVIEW.md`,
`ETA_MVP_IMPLEMENTATION_PLAN.md`, `ETA_PHASE1_FINAL_VERIFICATION.md`.

Each of the 14 sections gives **UX rationale · Mobile layout · Required backend data ·
Priority (MVP / Phase 2)**. "MVP" = achievable on the shipped backend (± small additions);
"Phase 2" = needs new backend (masking, routing, delay engine, group ETA, refund model,
support tickets).

---

## 0. Competitor synthesis → Bringly north star

| App | Tracking signature |
|---|---|
| **Blinkit / Zepto** | **Countdown is the hero** ("Arriving in 8 min"); minimal stepper; map only at OFD; rider card with masked call; reorder + crisp support entry. |
| **Swiggy Instamart** | Countdown + slim progress bar; conservative ETA; clear bill. |
| **Uber Eats / DoorDash** | Range→time; **assignment + pickup surfaced as milestones**; live map with **route + smooth marker**; proactive lateness + credits; structured chat support. |

**Bringly's seven principles (the north star):**
1. **ETA is the hero** (Blinkit) — a single, confident, server-truth countdown.
2. **One glance** — phase + ETA + rider answerable without scrolling.
3. **Map only when it helps** (OFD onward); before that, a warm illustration, never an empty map.
4. **Proactive, not reactive** — surface delays/issues before the customer asks.
5. **Trust via transparency** — bill, payment state, refund status always one tap away.
6. **Self-serve recovery** — cancellation, "where's my order", missing-item → resolved in-app.
7. **Hindi-first, warm copy** — the app already speaks Hinglish ("Darwaza khula rakhein!").

---

## 1. Page layout (overall)

**UX rationale.** Single-column vertical scroll with a **phase-adaptive hero pinned at top**;
everything else is supporting detail in descending importance. The page *re-skins itself by
phase* (confirmed → packing → on-the-way → delivered/cancelled) so it always leads with the
one thing that matters now. Reduce cognitive load: ≤ 5 cards, generous spacing, the brand
orange for "live", muted greys for done.

**Mobile layout.**
```
┌─────────────────────────────┐
│ ‹ back   Order #A1B2   ? help│  sticky top bar
├─────────────────────────────┤
│        HERO (phase-adaptive) │  ETA / illustration / map
├─────────────────────────────┤
│  ETA card  (range→countdown) │
│  Rider card (picked_up+)     │
│  Order timeline (stepper)    │
│  Delivery details + bill     │
│  Support / Cancel actions    │
│  [Refund / Delay banners]    │  conditional
└─────────────────────────────┘
```
**Required backend data.** `GET /orders/:id` (status, eta, rider, items, delivery snapshot,
paymentMethod, statusHistory) + sockets (`order:status|eta|location`). All shipped.
**Priority:** **MVP** (the current screen already follows this skeleton; V2 refines).

## 2. Hero section (phase-adaptive)

**UX rationale.** The emotional anchor. It must instantly convey *state + time*. Blinkit's
genius is the hero never makes you think. Bringly hero by phase:
- `confirmed/preparing/ready` → warm **illustration** (packing) + status line + **ETA range**.
- `picked_up/out_for_delivery` → **live map** peek + **countdown** ("Arriving in ~9 min").
- near drop (geofence) → **"Arriving now"** pulse.
- `delivered` → success check + **Rate** CTA.
- `cancelled` → calm state + **refund status**.

**Mobile layout.**
```
 pre-OFD:                       OFD:                         delivered:
 ┌───────────────┐              ┌───────────────┐            ┌───────────────┐
 │   🧺  (illus)  │              │ [ live map  ] │            │   ✅ Delivered │
 │ Packing your   │              │ Arriving ~9min│            │ Rate your order│
 │ order · ~15–20m│              │ 🛵 on the way │            │   ★★★★★        │
 └───────────────┘              └───────────────┘            └───────────────┘
```
**Required backend data.** `status`, `eta` (shipped); map needs `order:location` (shipped).
"Arriving now" geofence = **Phase 2** (rider→drop distance milestone).
**Priority:** **MVP** (illustration + range + countdown + delivered/cancelled);
**Phase 2** ("Arriving now" pulse, route preview in hero).

## 3. ETA card

**UX rationale.** The trust contract. Show a **range before pickup** (honest about
uncertainty), tighten to a **countdown** at OFD, and degrade gracefully. Be honest when the
estimate is coarse (`source: 'fallback'`). Never show a confidently-wrong number — the ETA
review explicitly flagged the stale/clamped case.

**Mobile layout.**
```
┌─────────────────────────────┐
│ ⏱  Arriving in 15–20 min     │   (range; spreadSeconds → ± band)
│    by ~9:42 PM               │   absolute time as secondary
│    ░░░░░▓▓▓▓▓ packing        │   thin phase progress
└─────────────────────────────┘
OFD →  "Arriving in ~9 min"  (single countdown, ticks locally)
fallback →  "Arriving in ~20–30 min"  (wider, softer)
late →  "Taking a little longer — ~5 min"  (Phase 2 server-driven)
```
**Required backend data.** `eta {secondsRemaining, spreadSeconds, serverNow, source}` +
`order:eta` push + poll (all shipped; client counts down locally from `secondsRemaining`/
`serverNow` — clock-skew safe). **Delay/"running late"** = **Phase 2** (server late detection).
**Priority:** **MVP** (range, countdown, fallback-aware); **Phase 2** (late state, "by HH:MM"
calibrated, "arriving" geofence).

## 4. Rider card

**UX rationale.** Once the rider has your order, make them human and reachable in one tap. Show
**name + photo + vehicle + rating**, a **call** button (masked), and (later) chat. Gate to the
active-delivery window — both for relevance and the PII discipline already enforced server-side.

**Mobile layout.**
```
┌─────────────────────────────┐
│ (R)  Sunil Yadav      ☆ 4.8 │
│      🛵 RJ-13 · Bike         │
│                    [ 📞 Call ]│
└─────────────────────────────┘
```
**Required backend data.** `rider {name, phone}` (shipped, gated to picked_up/OFD + customer).
**Photo/vehicle/rating** = **Phase 2** (`RiderProfile.photoUrl`, `vehicleNumber` exists,
`ratingAvg` new). **Number masking** (proxy call instead of raw `tel:`) = **Phase 2** —
strongly recommended before scale (raw personal numbers today).
**Priority:** **MVP** (name + call, current); **Phase 2** (photo, vehicle, rating, masking, chat).

## 5. Live map

**UX rationale.** Shown **only from pickup** (matches `showRider`). Home pin + moving rider
pin. The premium feel comes from a **route line** and **smooth marker interpolation** (no
8-s teleport) — the difference between "GPS jitter" and "Uber-grade". Degrade to "location
updating…" when GPS is stale (the review's Android-background reality).

**Mobile layout.** 260 px map card: 🏠 drop pin + 🛵 rider pin, auto-fit; ETA badge bottom-center;
"Re-center" affordance. Phase 2: dotted route polyline + animated marker.

**Required backend data.** `order:location` (8 s) + `getRiderLocation` last-known fallback
(shipped). **Route polyline** + **geofence milestones** ("reached shop", "arriving") = **Phase 2**.
**Marker interpolation** is client-only (Phase 2). Per ETA-review: **no provider calls / no DB
writes on the ping path** — preserve.
**Priority:** **MVP** (two pins + auto-fit + stale handling, current); **Phase 2** (route,
interpolation, geofence, re-center).

## 6. Order timeline (stepper)

**UX rationale.** The legible 5-phase story with timestamps — the "is it moving?" reassurance.
Collapsed by default (hero carries the headline), expandable. Cancelled gets a distinct branch.

**Mobile layout.**
```
● Confirmed        9:21 PM
● Packing          9:23 PM
◐ Picked up        9:31 PM   ← current (orange)
○ On the way        —
○ Delivered         —
```
**Required backend data.** `statusHistory` (status, changedAt, role) — shipped; per-phase
timestamps now on the order (`preparingAt/readyAt/outForDeliveryAt`). Map 9 DB states → 5
display phases.
**Priority:** **MVP**.

## 7. Shop information

**UX rationale.** Bringly is a **single unified storefront** (per the shipped "hide per-shop
store link" decision) — so shop info is **informational, not navigable**: "Packed by Chirawa
Store" with hours/"open now", **no** tap-through to a store page (which previously read as "a
different store"). For multi-shop, list each fulfilling shop (see §12).

**Mobile layout.**
```
🏪 Chirawa Store · Open · packing your order
```
(a quiet row, not a CTA).
**Required backend data.** `order.shop {name, …}` (available). No new data.
**Priority:** **MVP** (informational row); the non-navigable decision is already shipped.

## 8. Support actions

**UX rationale.** Cut support load with **order-scoped self-serve**. MVP keeps the one-tap
**call rider** (gated) + **WhatsApp help** (pre-filled with order id, current). Phase 2 is the
real win: a **structured help sheet** ("Item missing", "Didn't arrive", "Wrong item",
"Quality") with **auto-resolution** (missing item under ₹X → instant wallet credit) and human
escalation — the q-commerce standard.

**Mobile layout.**
```
┌─────────────────────────────┐
│  Need help with this order? │
│  [ 📞 Call rider ]  [ 💬 Help ]│
└─────────────────────────────┘
Phase 2 → tapping Help opens issue-type sheet (canned + chat)
```
**Required backend data.** MVP: none new (tel/WhatsApp). **Phase 2:** `SupportTicket`/
`SupportMessage` models + issue-type endpoints + auto-credit rules; **number masking** for the call.
**Priority:** **MVP** (call + WhatsApp); **Phase 2** (structured tickets, auto-resolution, masked call).

## 9. Cancellation flow

**UX rationale.** **State-gated, with the consequence shown *before* the tap.** Show "Cancel"
only while cancellable (`pending_payment/paid/confirmed`); the confirm sheet captures a reason
**and states the refund outcome up front** ("Full refund to UPI in ~3–5 days" / "No charge —
COD"). Past the gate, the button becomes "Need help?" → support (don't dead-end).

**Mobile layout.**
```
[ Cancel order ]            (only when cancellable)
  → sheet: "Why are you cancelling?"  ○ reasons…
           "₹150 will be refunded to UPI in 3–5 days"
           [ Keep order ]  [ Cancel & refund ]
```
**Required backend data.** `DELETE /orders/:id` (state-gated, auto-refund) — shipped; cancellable
state derivable from `status`. Refund-consequence copy from `paymentMethod` + total.
**Priority:** **MVP** (mostly built — V2 adds the up-front consequence + post-gate support route).

## 10. Refund visibility

**UX rationale.** A refund must be a **visible, trackable object**, not a silent reversal —
the single biggest trust lever post-cancellation/missing-item. q-commerce expectation: **instant
wallet** option + clear "to original method in N days". The live **item-unavailable** event
already exists — surface it inline ("Atta was out of stock — ₹85 refunded").

**Mobile layout.**
```
┌─────────────────────────────┐
│ 💸 Refund of ₹150           │
│    To UPI · expected 3–5 days│
│    ▸ initiated  ○ processed │   (timeline = Phase 2)
└─────────────────────────────┘
inline (item-unavailable): "Aashirvaad Atta out of stock — ₹85 refunded"
```
**Required backend data.** MVP (read-only): derive from `Payment.refundedPaise` /
`OrderItem.refundedPaise` + `order:item-unavailable` socket (shipped) → "₹X refunded to
<method>, ~N days". **Phase 2:** a first-class **`Refund`** model (states initiated→processing→
completed, destination, ETA) + a refunds/wallet history + instant-to-wallet.
**Priority:** **MVP** (read-only "₹X refunded" + inline item-unavailable); **Phase 2** (refund
timeline, wallet history, instant credit).

## 11. Delayed order UX

**UX rationale.** Lateness handled *proactively* is a trust-builder; handled silently is churn.
When `now > promise + grace`: soften the ETA ("Taking a little longer"), **apologize**, and
(policy) offer a small credit — Uber/DoorDash standard. Never let the countdown sit at a
confidently-wrong number (the ETA review's clamp warning).

**Mobile layout.**
```
┌─────────────────────────────┐
│ 🐢 Running a little late      │
│ New estimate: ~5 min · sorry!│
│ [ Track ]      [ Get help ]  │
└─────────────────────────────┘
```
**Required backend data.** **Server late-detection** (ETA delay-sweep) + a "late" flag on the
ETA payload + proactive FCM — **all Phase 2/3** (not built; ETA Phase 1 explicitly excludes it).
MVP-light: the client can show a gentle "taking longer" once its local countdown passes 0
(no server), but **no credits** without backend.
**Priority:** **Phase 2** (server delay state + push + credit). MVP-light client banner optional.

## 12. Multi-shop UX

**UX rationale.** A multi-shop cart splits into per-shop child orders under one `OrderGroup`.
The customer should see **one order with per-shop progress** and a **single group ETA = the
slowest live child**, plus **partial-delivery** clarity ("2 of 3 arrived; last ~9:50"). The ETA
review (M1) flagged that naive `max` over independent children is wrong when batched to one
rider — so group ETA is genuinely Phase 2.

**Mobile layout.**
```
┌─────────────────────────────┐
│ Arriving by ~9:50 (3 shops)  │   group ETA = slowest child
│ ● Chirawa Store   delivered  │
│ ◐ Sharma Kirana   on the way │
│ ○ Verma Dairy     packing    │
└─────────────────────────────┘
```
**Required backend data.** `getOrderGroup` returns money + rolled-up status today (shipped) —
**no per-child eta/rider**. **Phase 2:** extend `getOrderGroup` with per-child `eta`/`status`,
a **group ETA** (slowest child; batched single-rider → ordered-stop legs), and a partial-delivery
summary.
**Priority:** **MVP** (per-shop **status** list in the group view); **Phase 2** (group ETA +
per-child ETA + partial-delivery UX).

## 13. Empty states

**UX rationale.** Empty ≠ broken. Each absence gets a warm, actionable message.
- **No active order** → "Nothing cooking 🍳 — start an order" + browse CTA.
- **Rider not yet assigned** (pre-pickup) → illustration + "Packing — rider assigned soon"
  (never an empty map).
- **ETA calculating** → "Calculating your ETA…" (brief), not a blank.
- **Location unavailable** → muted map + "Live location will appear once the rider is on the way".

**Mobile layout.** Centered illustration + one line + (optional) one CTA per state.
**Required backend data.** Graceful nulls already returned (`eta`/`rider`/location omitted when
not ready) — shipped. No new data.
**Priority:** **MVP**.

## 14. Error states

**UX rationale.** This is where Bringly already felt pain ("Network request failed"). Errors
must be **recoverable, never dead-ends**, and must not lose the live connection silently.
- **Order fetch failed** → full-card "Couldn't load — Retry".
- **Network offline** → top inline banner "You're offline — reconnecting…" (auto-retry; keep last data).
- **Socket dropped** → silent reconnect + **lean on the 15 s poll** (already the source of truth);
  show "Updating…" not an error.
- **Action failed** (cancel) → toast + safe retry, order state unchanged.
- **Payment pending** (prepaid not captured) → "Complete payment" CTA, ETA suppressed until paid.

**Mobile layout.**
```
[ ⚠ You're offline — reconnecting… ]      (top banner, auto-dismiss)
┌─────────────────────────────┐
│   Couldn't load this order   │
│        [ Retry ]             │
└─────────────────────────────┘
```
**Required backend data.** Robust `GET` + idempotent retries (shipped); poll fallback carries
ETA if the socket drops (shipped). No new data; this is client resilience.
**Priority:** **MVP** (this is table-stakes given the prior network pain).

---

## Phasing summary

| Section | MVP (on shipped backend) | Phase 2 (new backend) |
|---|---|---|
| 1 Layout | phase-adaptive scroll | — |
| 2 Hero | illustration + range + countdown + delivered/cancelled | "Arriving now" geofence, route preview |
| 3 ETA card | range→countdown, fallback-aware | "running late", calibrated "by HH:MM" |
| 4 Rider card | name + call (gated) | photo, vehicle, rating, **masking**, chat |
| 5 Live map | two pins, auto-fit, stale handling | route polyline, marker interpolation, geofence |
| 6 Timeline | 5-phase stepper + timestamps | — |
| 7 Shop info | informational row (non-navigable) | — |
| 8 Support | call + WhatsApp | structured tickets, auto-credit, masked call |
| 9 Cancellation | state-gated + consequence up-front | post-gate support routing |
| 10 Refund | read-only "₹X refunded" + item-unavailable | **Refund model** + timeline + instant-to-wallet |
| 11 Delay | (client-light banner only) | **server delay engine** + push + credit |
| 12 Multi-shop | per-shop status list | **group ETA** + per-child ETA + partial delivery |
| 13 Empty states | all | — |
| 14 Error states | all (resilience) | — |

## Backend gaps Phase 2 needs (net new)
- **Number masking** proxy (rider↔customer).
- **`RiderProfile.photoUrl` + `ratingAvg`** for the rider card.
- **Route + geofence** (rider→shop/→drop milestones) for map + "arriving".
- **Server delay detection** (ETA delay-sweep) + a `late` flag + proactive push (ETA Phase 3).
- **`Refund`** model (state/destination/ETA) + refunds history; instant-to-wallet.
- **`getOrderGroup`** extended with per-child + group ETA (slowest child / ordered-stop legs).
- **`SupportTicket`/`SupportMessage`** + issue types + auto-resolution credit rules.

## Open product questions
1. **ETA display:** lead with a **range** or a single **"by HH:MM"** promise? (Recommend
   range pre-pickup → countdown at OFD.)
2. **Refund default:** original method vs **instant wallet credit** (delight vs the hidden
   growth-loop/wallet decision).
3. **Late SLA + credits:** grace window and whether breach auto-credits (policy).
4. **Rider reveal:** keep hidden until pickup (current) or surface "rider assigned" earlier?
5. **Masking provider/cost** for the call proxy.
6. **Multi-shop:** is a single group ETA an MVP expectation, or is per-shop status acceptable
   for v1 (recommended) with group ETA in Phase 2?

---
*No code written or files modified by this spec. It assumes the shipped BUG-1/BUG-2/ETA-Phase-1
foundation and sequences the rest as MVP (current backend) vs Phase 2 (new backend).*
