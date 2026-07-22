# Tracking V2 — MVP Implementation Plan

**Design only — no code.** Sources: `TRACKING_V2_SPEC.md`, `TRACKING_V2_UI_AUDIT.md`.
Scope = the **MVP-feasible** fixes on the already-shipped backend (BUG-1/2, ETA Phase 1, live
`order:eta`). Almost all changes are in the **customer app**; two items need a **small,
additive backend serialization change** (refund block; optional rider vehicle). No schema, no
migration. Phase-2 items (masking, route polyline, server delay engine, group ETA, structured
support, rider photo/rating) are **out of scope here**.

**Client-test reality (stated up front, honestly):** the customer app has **no RN
component/socket UI test harness** today. So client logic is unit-tested **only where a pure
helper can be extracted** (countdown, phase mapping, error/refund derivation); otherwise the
gate is the **runtime/backend-signal proof + manual in-app check**. Backend additions get
real service tests (like the `eta`/`rider-access` suites). On-device render is verified by
construction + the live socket-wire proof (same standard used for ETA P3).

Priorities: **P0** (Error state, Refund card, Item-unavailable) → **P1** (ETA hero, Map gating,
Rider card, Timeline). Each item: **Files · Backend deps · UI changes · Socket changes · Risk ·
Test plan · Runtime verification.**

---

# P0

## P0.1 — Error state (fix the blank screen)
*Audit #7 (🔴 Critical): `fetchOrder` swallows errors (`:448`); `if (!order) return null`
(`:618`) → white screen on load failure.*

- **Files:** `apps/customer-app/src/screens/orders/OrderTrackingScreen.tsx` (add `loadError`
  state; split first-load vs poll handling in `fetchOrder`; replace the `return null` guard
  with an error card + Retry; optional offline/socket-drop banner); `@chirawa/i18n`
  (`tracking.loadError`, `common.retry`, `tracking.reconnecting`).
- **Backend deps:** **none** — `GET /orders/:id` already returns errors (404/403/network).
- **UI changes:** an **error card** (icon + message + **Retry**) shown when the first load
  fails and `order` is null; a slim top **"You're offline — reconnecting…"** banner driven by
  socket `disconnect`/`connect_error` (data still flows via the 15 s poll).
- **Socket changes:** add `socket.on('connect_error' | 'disconnect', …)` → set a `socketStale`
  flag for the banner (no functional change; cleanup on unmount).
- **Risk:** Low. Edge: Retry must reset `loading`/`loadError`; don't show the error card while
  stale data exists (poll failure → keep last good order).
- **Test plan:** extract `deriveLoadState(order, loading, loadError)` as a pure helper →
  unit-test (loading → loader; null+error → error card; order present → content; poll failure
  with order present → keep content). Backend: confirm `GET` returns a clean error for a
  missing/forbidden order.
- **Runtime verification:** point the app/socket at a **non-existent order id** → `GET` returns
  404 (verify via curl) → screen shows the **error card + Retry**, not blank; tapping Retry
  re-issues `getOrder`. Offline: kill the socket → banner appears, poll keeps data fresh.
  (UI render confirmed in-app; the 404 contract verified by curl.)

## P0.2 — Refund card
*Audit #9 (🟠 High): no refund status post-cancel; only a static note inside the cancel sheet.*

- **Files:** `apps/api/src/modules/orders/orders.service.ts` (`getOrder` — add `refundedPaise`
  to the `payments` select, derive a `refund` block); `packages/types/src/dto/order.dto.ts`
  (additive `refund?`); `OrderTrackingScreen.tsx` (refund card); `@chirawa/i18n`.
- **Backend deps:** **small additive serialization** — `getOrder` returns
  `refund?: { amountPaise, destination: 'original'|'wallet', status: 'processing'|'completed',
  etaText }` derived from `sum(Payment.refundedPaise)` (+ `OrderItem.refundedPaise`). No schema
  change. (A real refund **state machine** + timeline is Phase 2 — here `status`/`etaText` are
  derived approximations, e.g. "to UPI · ~3–5 days".)
- **UI changes:** a **refund card** ("💸 ₹X refunded to UPI · expected ~3–5 days") shown when
  `refund.amountPaise > 0` (cancellation or out-of-stock line). For COD, phrase as
  "₹X adjusted from cash due".
- **Socket changes:** none for the card itself; it refreshes via the existing poll and the
  P0.3 item-unavailable refetch.
- **Risk:** Low-Med. Edge: prepaid refunds depend on Razorpay (dev may not actually refund);
  partial vs full; COD wording; the `etaText` is a placeholder (flag as MVP read-only).
- **Test plan:** backend service test — `getOrder` returns the `refund` block when
  `refundedPaise > 0` (full and line-level), omits it when 0. Client: pure
  `refundView(order)` helper unit-tested.
- **Runtime verification:** controlled DB seed — set `payments.refunded_paise > 0` (or use the
  item-unavailable flow) on a seeded order → `GET /orders/:id` returns the `refund` block with
  the right amount/method (verify via curl) → refund card renders in-app. Clean up.

## P0.3 — Item-unavailable handling
*Audit #9 (🟡 Med-High): server emits `order:item-unavailable` but the client has no listener.*

- **Files:** `OrderTrackingScreen.tsx` (add the listener + a banner/toast + order refetch +
  optional substitute CTA); `@chirawa/i18n`.
- **Backend deps:** **none** — `order:item-unavailable` is already emitted
  (`realtime.plugin.ts`) with `{ orderId, productName, refundedPaise, cancelled, suggestion? }`.
- **UI changes:** an inline **banner/alert** "‘Aashirvaad Atta’ out of stock — ₹85 refunded"
  (+ "Order cancelled & fully refunded" when `cancelled`), an optional **"Add substitute"**
  CTA when `suggestion` is present, and a **refetch** so items + the P0.2 refund card update.
- **Socket changes:** add `socket.on('order:item-unavailable', …)` (filter by `orderId`,
  idempotent, refetch); add `socket.off('order:item-unavailable')` to cleanup.
- **Risk:** Low. Edge: dedupe repeated events; ensure refetch reconciles the bill/refund.
- **Test plan:** pure handler/reducer (payload → banner copy + refetch trigger) unit-tested if
  extracted.
- **Runtime verification:** a Node `socket.io-client` subscribed as the customer (the proven
  P3 pattern) + trigger `POST /delivery/orders/:orderId/items/:itemId/unavailable` (rider) →
  assert `order:item-unavailable` is received with the expected payload (wire proven). UI
  banner verified in-app.

---

# P1

## P1.1 — ETA hero
*Audit #1/#2 (🟠 High): ETA buried in the header; duplicate header-range vs map-badge-point.*

- **Files:** `OrderTrackingScreen.tsx` (new **EtaHero** card at top; simplify the gradient
  header to phase-only; extract a `useCountdown` from `order.eta`);
  `components/tracking/TrackingMap.tsx` (drop/mirror the numeric badge so there's **one** ETA
  source); `@chirawa/i18n`.
- **Backend deps:** **none** — `eta {secondsRemaining, spreadSeconds, serverNow, source}` +
  `order:eta` already shipped.
- **UI changes:** ETA **hero card**: **range** pre-pickup ("Arriving in 15–20 min · by ~9:42"),
  **local countdown** at OFD (ticks down from `secondsRemaining`, reconciled on each
  `order:eta`/poll using `serverNow` — clock-skew safe), **softer copy** when
  `source === 'fallback'`, **"Calculating ETA…"** when `eta` is absent.
- **Socket changes:** none new (the `order:eta` handler from P3 already updates `order.eta`;
  the hero reads it).
- **Risk:** Low-Med. Edge: countdown must not go negative (→ "Arriving"/late, ties to Spec §11);
  reconcile on push to avoid drift; remove the now-duplicate header/badge ETA cleanly.
- **Test plan:** pure `formatEta(eta, now)` + `useCountdown` reducer unit-tested (range vs
  countdown vs calculating vs fallback; reconcile on new `serverNow`; clamp at 0).
- **Runtime verification:** drive an order through phases (existing ETA harness) → `order:eta`
  pushes update the hero within ~1 s (P3 wire proven); confirm range pre-pickup → countdown at
  OFD in-app.

## P1.2 — Map gating
*Audit #5 (🟠 High): map shown from `confirmed` → empty "location unavailable" map pre-pickup.*

- **Files:** `OrderTrackingScreen.tsx` (`showMapNow` condition `:668`; add a pre-pickup
  illustration block).
- **Backend deps:** **none**.
- **UI changes:** render the **map only** for `picked_up`/`out_for_delivery` (align with
  `showRider`); pre-pickup show a **packing illustration** (the hero carries the ETA). Removes
  the empty-map-with-"location-unavailable" state.
- **Socket changes:** none.
- **Risk:** Low.
- **Test plan:** pure `shouldShowMap(status, coords)` helper unit-tested (true only for
  picked_up/OFD with coords; false otherwise).
- **Runtime verification:** at `preparing` → no map (illustration); at `out_for_delivery` →
  live map. Status-gating logic verified by the helper; visual confirmed in-app.

## P1.3 — Rider card improvements
*Audit #1/#4: rider card is initial + name + "delivery partner" + icon-only call.*

- **Files:** `OrderTrackingScreen.tsx` (card layout: larger labeled **"Call"** CTA, clearer
  hierarchy, status line); *optional small backend:* `orders.service.ts` (`getOrder` rider
  select + `vehicleNumber`) + `order.dto.ts` (`rider.vehicle?`); `@chirawa/i18n`.
- **Backend deps:** **none for layout**; **optional additive** — add `vehicleNumber`
  (`RiderProfile.vehicleNumber` exists) to the gated rider block. **Photo, rating, masking are
  Phase 2** (need `photoUrl`/`ratingAvg`/a proxy — not in MVP).
- **UI changes:** labeled **Call** button (bigger tap target), optional **vehicle** line
  ("🛵 RJ-13 · Bike"), keep the gated reveal (picked_up/OFD) and the live status message.
- **Socket changes:** none.
- **Risk:** Low. Edge: vehicle gated same as the rider block (privacy parity with BUG-2).
- **Test plan:** backend — `getOrder` rider block includes `vehicle` when present, still gated/
  omitted otherwise (extend `orders.rider-access.test.ts`). Client: layout (manual).
- **Runtime verification:** assigned order at OFD → `GET` rider block includes name/phone(+vehicle)
  (curl); call button dials in-app.

## P1.4 — Timeline redesign
*Audit #2/#3: stepper exists but should be the 5-phase timeline with timestamps + cancelled branch.*

- **Files:** `OrderTrackingScreen.tsx` / the `ProgressStepper` component (map 9 DB states → 5
  display phases; render timestamps; collapsible; cancelled branch); `@chirawa/i18n`.
- **Backend deps:** **none** — `statusHistory` is in `GET`, and the order now carries
  `confirmedAt/preparingAt/readyAt/pickedUpAt/outForDeliveryAt/deliveredAt` (raw passthrough).
- **UI changes:** 5-phase stepper (Confirmed · Packing · Picked up · On the way · Delivered)
  with **per-phase timestamps**, collapsed by default (hero carries the headline), a distinct
  **cancelled** branch with the refund link.
- **Socket changes:** none.
- **Risk:** Low. Edge: timestamp source (prefer the order's phase columns; fall back to
  `statusHistory`); collapse/expand state.
- **Test plan:** pure `buildTimeline(order, statusHistory)` helper unit-tested (phase mapping,
  timestamps, cancelled branch).
- **Runtime verification:** walk an order through transitions → timeline shows the right phase +
  timestamps at each (data verified via `GET`; visual in-app).

---

## Sequencing & dependencies
- **P0.1 (error state)** is independent and highest value — ship first.
- **P0.2 (refund card)** depends on the small `refund`-block backend add; **P0.3
  (item-unavailable)** feeds the refund card (refetch) — do P0.2 then P0.3, or together.
- **P1.1 (ETA hero)** builds on the P3 `order:eta` handler (shipped); **P1.2 (map gating)** is
  trivial and pairs with the hero (hero owns the ETA, so the map badge can drop). **P1.3/P1.4**
  are independent.
- Recommended order: **P0.1 → P0.2 → P0.3 → P1.1 + P1.2 (together) → P1.4 → P1.3.**

## Backend additions (the only non-client work, both additive/no-migration)
1. `GET /orders/:id` **`refund`** block (P0.2) — derive from `Payment.refundedPaise`.
2. `GET /orders/:id` **`rider.vehicle`** (P1.3, optional) — add `vehicleNumber` to the gated rider lookup.
Everything else is customer-app only and uses already-shipped data/sockets.

## After implementation (per item / batch)
`pnpm --filter @chirawa/api typecheck` (backend adds) + `pnpm --filter @chirawa/customer-app
exec tsc --noEmit` (client) → `vitest run src/modules/orders` (backend) + any extracted client
helper tests → the runtime proofs above → a per-item implementation report. **Phase 2 not
started.**

## Open questions
1. **Refund `etaText`/`status`:** acceptable as a derived placeholder for MVP, or wait for the
   Phase-2 `Refund` model? (Recommend: ship the read-only derived block now.)
2. **Rider vehicle:** include in MVP (small backend add) or defer with photo/rating to Phase 2?
3. **Offline banner source:** socket `disconnect` only, or also a NetInfo listener?
4. **ETA late state (countdown < 0):** client-light "taking longer" now, or wait for the
   Phase-2 server delay engine before showing anything?
