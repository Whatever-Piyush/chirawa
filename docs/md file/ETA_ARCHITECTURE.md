# ETA Architecture — Bringly

**Status:** Design only — no code. Context: BUG-1 (rider identity) and BUG-2 (gated
rider details) are complete; this designs the production-grade fix for BUG-3 (no
server-side ETA). Goal: **one authoritative, server-computed ETA** that is accurate from
order placement through delivery, pushed live, and degrades gracefully.

---

## 1. Where Bringly is today (the problem)

There is **no server ETA**. Three independent, inconsistent, mostly-fake values exist:
- Tracking header: literal `~20 min` pre-OFD / "arriving soon" at OFD
  (`OrderTrackingScreen.tsx:656`).
- Map badge: `straight-line-km ÷ 20 km/h`, only once the rider has a GPS fix
  (`TrackingMap.tsx`).
- Push notification: hardcoded `'30 minute'` (`notifications.plugin.ts:70`).

Meanwhile the platform already computes and stores the **road** distance
(`Order.distanceKm`, `distanceSource='google_maps'`) and ignores it for ETA. This design
makes the server the single source of truth and reuses that infrastructure.

---

## 2. Competitor research & comparison

Two cohorts: **q-commerce** (Blinkit, Zepto, Swiggy Instamart — dark store, ~10-min
promise) and **marketplace** (Uber Eats, DoorDash — 3-sided, restaurant + courier).
Bringly is q-commerce-shaped (one town, fast grocery) but 3-sided like the marketplaces
(independent seller + gig rider), so it borrows from both. *(Internal mechanisms are
inferred where not public; behaviour is externally observable.)*

| Dimension | Blinkit / Zepto / Instamart (q-commerce) | Uber Eats / DoorDash (marketplace) |
|---|---|---|
| **1. At placement** | Headline **countdown** from t=0 ("Arriving in 9 min"); prep+travel model | **Range** from t=0 ("15–25 min"); prep(restaurant)+travel(courier) |
| **2. During prep** | Countdown holds/ticks; "packing" | "Restaurant is preparing"; range may tighten |
| **3. After assignment** | Usually **hidden** until OFD | Surfaced ("Dasher assigned / heading to store"); ETA includes courier→store leg |
| **4. After pickup** | Live map + tightening ETA | Specific time/short countdown; route-based |
| **5. Live updates** | Few-second refresh; smooth marker | Continuous; route + traffic re-eval; smooth interpolation |
| **6. Delay handling** | Conservative padding; occasional credit | Proactive "running late" messaging + credits; lateness SLAs |
| **7. Traffic/weather** | Surge padding in rain/peak (inferred) | Traffic-aware routing engine + weather/peak multipliers |
| **8. Multi-shop** | Single store → N/A (one basket) | Multi-restaurant rare; per-order ETAs |
| **9. Reassignment** | Invisible reshuffle | Visible "new Dasher", ETA recomputed from new position |
| **10. Customer UI** | Countdown hero + map; minimal states | Range→time, stepper, map, "arriving", "late", credits |

**Takeaways that shape Bringly's design:**
1. **ETA must exist from t=0** (placement), as a **range**, tightening to a **countdown/time**
   after pickup. Never "unavailable until GPS."
2. The credible model everywhere is **`ETA = prep_time + travel_time`**, recomputed at each
   phase and **persisted as a promise**.
3. Travel time uses **road distance + speed (+ traffic)**, never straight-line.
4. Because two independent parties create uncertainty (seller prep, gig rider), surface the
   **assignment + pickup milestones** and recompute the ETA at each (marketplace pattern) —
   exactly Bringly's situation.
5. **Proactive delay handling** (detect late, message, optionally credit) is table stakes.

---

## 3. The Bringly ETA model

**Core:** `estimatedDeliveryAt = now + prep_remaining + travel_remaining`, recomputed at
every phase transition and (post-pickup) on rider movement, persisted on the order, and
pushed live. Displayed as a **±band (range)** until pickup, a **countdown/clock time**
after.

Mapped onto Bringly's existing `OrderStatus` ladder (`orders.service.ts:77` state machine):

| Phase (DB status) | prep_remaining | travel_remaining | Display |
|---|---|---|---|
| `paid` / `confirmed` (placement) | full `prepTime(shop)` | `Order.distanceKm` ÷ speed (shop→customer) | **Range** ("15–20 min") |
| `preparing` | `prepTime − elapsed` (from `preparingAt`) | shop→customer | Range, tightening |
| `ready_for_pickup` + assigned | `0` (or `max(0, prep−elapsed)`) | `max(prep_rem, rider→shop) + shop→customer` | Range, tightening |
| `picked_up` / `out_for_delivery` | `0` | `rider→customer` from **live** location | **Countdown / "by 9:42"** |
| near customer (geofence) | — | — | **"Arriving"** |
| `delivered` / `cancelled` | — | — | terminal (no ETA) |

`prepTime` = a per-shop estimate (new `Shop.prepTimeMinutes`; v3 learned). `speed` = an
effective town speed with multipliers (§8). All legs measured with **road distance**
(§8), not straight-line.

---

## 4. What we build on (existing Bringly infra — reuse, don't rebuild)

- **Order state machine + history** (`orders.service.ts` `ORDER_TRANSITIONS`,
  `OrderStatusHistory`): the recompute triggers and prep-elapsed measurement.
- **`Order.distanceKm`** (road, `google_maps`): the placement-time shop→customer leg — already
  there, currently unused for ETA.
- **`pricing/distance.service.ts`**: **cached (Redis 7-day) Google Distance Matrix with
  haversine fallback** returning `{ metres, source }`. Reuse for *any* leg (rider→shop,
  shop→customer, rider→customer) and extend with `duration_in_traffic` for traffic-aware
  travel time (§8).
- **`shared/utils/geo.ts`** (`haversineMeters`, `pointInPolygon`, `polygonCentroid`) and
  **Mappls** geocoding (`geo.service.ts`): cheap local distance + zone math for the ping
  path (avoid a provider call every 8s).
- **Rider location system**: `rider:location` socket every ~8s → `RiderLocation` row +
  Redis last-known (`rider:{userId}:location`, 30s TTL) + broadcast `order:location`
  (`realtime.plugin.ts`); HTTP fallback `getRiderLocationForOrder`. This is the live input
  for post-pickup ETA.
- **Sockets**: Socket.IO v4 + Redis adapter, `order:{id}` room, event-bus→socket bridge
  (cross-process). Add one event: **`order:eta`** (mirrors `order:status`).
- **Dispatch / batching**: `assignOrder` (zone + load-balance), `Batch` (≤3 stops; can't OFD
  until all picked up), `getActiveDelivery` (ordered stops) — the multi-stop leg chain (§ multi-shop).
- **`OrderGroup`** (`getOrderGroup`): multi-shop unification — extend to aggregate child ETAs.
- **`AppConfig`** (key/value table, currently unused): ETA tunables (speed, weather, grace).
- **BullMQ workers** (`dispatch.plugin`, `seller-timeout.plugin`): host the delay-sweep job.
- **`Shop.estimatedDeliveryMinutes`** (static 30, shown on shop cards): the *marketing*
  estimate — superseded on the order by the computed `estimatedDeliveryAt`.

---

## 5. The ten areas — competitor pattern → Bringly design

**1. ETA at placement.** *(Both cohorts: prep+travel from t=0; q-commerce as countdown,
marketplace as range.)* Bringly: at `paid`/`confirmed`, `estimatedDeliveryAt = now +
prepTime(shop) + distanceKm/effectiveSpeed`, persisted; show a **range** (±`etaSpread`).
`distanceKm` already exists; on the flat-fee path where it's `0`/`'flat'`
(`orders.service.ts:288`), fall back to a Distance-Matrix call (cached) or shop→customer
haversine×road-factor.

**2. ETA during preparation.** *(Prep clock visible; tighten as prep proceeds.)* Bringly:
on `confirmed→preparing→ready_for_pickup`, recompute `prep_remaining = prepTime − (now −
preparingAt)`. Requires new `preparingAt`/`readyAt` timestamps (§6).

**3. ETA after rider assignment.** *(Marketplace surfaces courier→store leg.)* Bringly: on
`assignOrder`/batch assign, the travel has two legs: `max(prep_remaining, rider→shop) +
shop→customer`. `rider→shop` from the rider's last-known location (Redis/`RiderLocation`).
For batches, chain the ordered stops from `getActiveDelivery`.

**4. ETA after pickup.** *(Live, route-based, most accurate.)* Bringly: at
`picked_up`/`out_for_delivery`, `travel_remaining = rider→customer` from the **live**
location stream; this is the authoritative phase.

**5. Live ETA updates.** *(Continuous refresh + smooth movement.)* Bringly: recompute on
each `rider:location` ping **server-side**, **debounced** — only emit `order:eta` when the
predicted arrival shifts > ~60s (avoid spamming the 8s stream). Reuse the order room +
event bus. Client interpolates the countdown locally between pushes.

**6. Delay handling.** *(Detect late → message → maybe credit.)* Bringly: a BullMQ
**delay-sweep** (e.g., every 60–120s over in-flight orders) flags `now >
estimatedDeliveryAt + graceMinutes` → push a softened ETA + a proactive FCM ("Thoda late
ho raha hai…") and surface a **"running late"** UI state. Lateness logged for ops; credits
are a policy decision (out of scope here, hook provided).

**7. Traffic/weather.** *(Marketplace: traffic-aware routing + multipliers.)* Bringly
(town-scale, traffic is minor): `effectiveSpeed = townSpeed × weatherMultiplier ×
timeOfDayFactor`, all from `AppConfig`. v3: switch the active-leg travel time to
**`duration_in_traffic`** (Google Distance Matrix `departure_time=now`) or a Mappls route
ETA. Weather can be a manual ops toggle (`AppConfig: eta.weatherMultiplier=1.3` during
rain) before any weather API.

**8. Multi-shop orders.** *(Rare for competitors; per-order ETAs.)* Bringly splits a
multi-shop cart into per-shop child orders under one `OrderGroup`. **Group ETA = `max`
(latest) of the child `estimatedDeliveryAt`** (the customer is "done" when the slowest
arrives). Each child computes independently. If one rider delivers several children in a
batch, model the **chained stops** (`rider→shopA→…→dropA→dropB`) from `getActiveDelivery`'s
ordered list. Extend `getOrderGroup` to return the group ETA + per-child ETAs.

**9. Reassignment.** *(Marketplace recomputes from the new courier.)* Bringly: when the
rider changes (reject/timeout/offline, or batch reshuffle, or `releaseOrderAssignment`),
**reset the pickup leg** and recompute from the new rider's position; push `order:eta`;
optionally a "new rider, updated arrival" message. (Couples cleanly to BUG-1 Phase 2 if an
accept/reject window is added.)

**10. Customer-facing ETA UI.** Range pre-OFD ("Arriving in 15–20 min" / "by 9:40"),
**countdown** post-pickup, **"Arriving"** at a geofence (~300 m or < 2 min), **"running
late"** state, and **"location updating…"** when the GPS fix is stale (reuse
`LOCATION_STALE_MS`). This **replaces** the three fake values in §1.

---

## 6. Data model additions (design; no migration here)

**`Order`**
- `estimatedDeliveryAt DateTime?` — the promise (the ETA hero).
- `etaSpreadSeconds Int?` — half-width of the displayed range (pre-pickup).
- `etaComputedAt DateTime?`, `etaSource String?` (`'prep_road' | 'live_route' | 'fallback'`).
- `preparingAt DateTime?`, `readyAt DateTime?`, `outForDeliveryAt DateTime?` — first-class
  phase timestamps (today only `confirmedAt/pickedUpAt/deliveredAt/cancelledAt` exist;
  the rest live only in `OrderStatusHistory`). Needed for prep-elapsed + SLA + accuracy.

**`Shop`**
- `prepTimeMinutes Int @default(…)` — per-shop average packing time, distinct from the
  marketing `estimatedDeliveryMinutes`. v3: learned per shop × hour-of-day.

**`AppConfig`** (existing key/value table)
- `eta.townSpeedKmph`, `eta.roadFactor`, `eta.weatherMultiplier`, `eta.timeOfDayFactor`,
  `eta.graceMinutes`, `eta.prepDefaultMinutes`, `eta.spreadSeconds`.

**Accuracy (optional, v3)** — either a small `EtaSnapshot` table (orderId, predictedAt,
phase, predictedDeliveryAt) or derive predicted-vs-actual from `estimatedDeliveryAt` +
`deliveredAt`/`OrderStatusHistory` for an MAE dashboard.

---

## 7. Compute & event flow

- **`eta.service.ts`** (new): pure helpers (`travelMinutes(distanceKm, speed)`,
  `computeEta(phase, prep, legs, multipliers)`) + an orchestrator
  `computeAndPersist(orderId)` that loads the order, picks the phase formula, writes
  `estimatedDeliveryAt`, and emits `ORDER_ETA_CHANGED`.
- **Triggers:**
  1. **Phase transitions** — call it from `updateOrderStatus` / `riderAdvance` /
     `codCollected` / `markDelivered`.
  2. **Assignment** — from `dispatch.assignOrder` and `batching` (pickup leg appears).
  3. **Rider movement** — from the `rider:location` socket handler (`realtime.plugin.ts`),
     **debounced** (recompute, emit only if arrival shifts > ~60s).
  4. **Delay sweep** — a periodic BullMQ job for late detection.
- **Transport:** new event `ORDER_ETA_CHANGED` → event-bus→socket bridge → `order:eta`
  emitted to `order:{id}` + `user:{customerId}` (same pattern as `order:status`,
  `realtime.plugin.ts:176`). Payload: `{ orderId, estimatedDeliveryAt, etaSpreadSeconds,
  phase, source }`.
- **Best-effort, non-blocking:** ETA computation must **never** block order flow or fail a
  socket event (wrap in try/catch and tolerate, exactly like the BUG-2 rider lookup and
  the existing `rider:location` DB write). A missing ETA degrades the UI to a coarse range,
  not an error.
- **Surface in `GET /orders/:id`**: add `estimatedDeliveryAt`/range to the response so the
  initial paint has an ETA before the first socket tick.

## 8. Routing / distance strategy (cost-aware)

- **Leg distances** via `pricing/distance.service.ts` (cached Distance Matrix + haversine
  fallback). The placement leg is already stored (`Order.distanceKm`).
- **Cost control:** the 8s rider-ping path must **not** call a paid API each tick — use
  local `haversineMeters × roadFactor ÷ effectiveSpeed` for live recompute, and reserve
  provider calls (cached) for **phase transitions** and the initial computation. v3 may add
  `duration_in_traffic` on transitions only.
- **Traffic:** v1 ignores it (3 km town); v2 applies time-of-day/weather multipliers from
  `AppConfig`; v3 uses `duration_in_traffic` (Google) or Mappls route ETA on the active leg.
- **Weather:** ops-toggled `eta.weatherMultiplier` first; a weather API is a later optimization.

## 9. Failure modes & accuracy

- **Stale/absent rider GPS** → fall back to last-known + `ageMs`, widen the band, or use the
  distance/speed model; show "location updating…".
- **Provider/Distance-Matrix down** → haversine fallback (already in `distance.service`),
  `etaSource='fallback'`, wider band.
- **No ETA computed** → coarse range from `Shop.estimatedDeliveryMinutes`; never an error.
- **Accuracy loop (v3):** log predicted vs actual (`deliveredAt`), compute MAE per
  shop/zone/hour, auto-tune `prepTimeMinutes` and `townSpeedKmph`.

## 10. Customer-facing UI (replaces the three fake values)

Header: range pre-OFD → countdown/"by HH:MM" post-pickup → "Arriving" at geofence →
"Delivered". "Running late" state when past promise. Map badge consumes the **server**
ETA (not its own straight-line calc). Push notifications use the real ETA, not `'30
minute'`. Pre-OFD shows the range over an illustration; the live map appears at pickup
(matches the existing `showRider` gate).

---

## 11. Phasing

**MVP — server is the source of truth**
- `Order.estimatedDeliveryAt` computed at placement (prep + `distanceKm`/speed) and
  recomputed on every status transition; persisted; returned in `GET /orders/:id`.
- New phase timestamps, `Shop.prepTimeMinutes`, `AppConfig` tunables.
- `order:eta` socket event; client shows **range → countdown**; **retire** the hardcoded
  `~20 min` / straight-line badge / `'30 minute'` push.
- Delay-sweep (late detection + proactive push).

**Phase 2 — live & robust**
- Recompute on rider pings (active leg from live position, debounced); reassignment
  recompute; multi-shop **group ETA** in `getOrderGroup`; weather/time-of-day multipliers;
  "Arriving" geofence + "running late" UI; batch multi-stop chaining.

**Phase 3 — precision**
- Traffic-aware routing (`duration_in_traffic` / Mappls) on the active leg; learned
  per-shop/hour prep times; accuracy dashboard (predicted vs actual MAE) + auto-tuning.

## 12. Open questions
1. **Traffic provider:** reuse Google Distance Matrix (`duration_in_traffic`) or move ETA to
   Mappls (already used for geocoding)? Cost vs consistency.
2. **Display:** default to a **range** or a single **"by HH:MM"** promise pre-pickup?
3. **Late SLA + credits:** what grace, and do we auto-credit on breach (policy)?
4. **Group ETA semantics:** slowest-child (recommended) vs per-child shown separately.
5. **Who sees the ETA:** customer only, or also rider/seller? (Mirror BUG-2's gating
   discipline — likely customer + rider + admin.)
6. **Ping-path cost:** confirm the local distance/speed model (no paid call per 8s tick) is
   accurate enough for the town before considering per-ping routing.
