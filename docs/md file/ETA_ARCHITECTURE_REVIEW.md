# ETA Architecture — Multi-Lens Review

**Reviewing:** `ETA_ARCHITECTURE.md`.
**Lenses:** Principal Engineer (PE), Staff Backend Engineer (BE), Operations Lead (OPS),
Product Manager (PM).
**Mandate:** challenge wrong assumptions, scalability, cost (Google Distance Matrix),
rider-tracking accuracy, failure modes, multi-shop complexity, edge cases. Every issue
gets **Severity · Impact · Mitigation**. **No implementation.**

Severity scale: 🔴 Critical · 🟠 High · 🟡 Medium · ⚪ Low.

---

## Per-lens verdict (the headline)

- **Principal Engineer:** Architecture is sound and reuses the right primitives, but it
  **over-claims "production-grade"** for what is a town pilot, and it **couples ETA
  recompute into the socket hot path** and the **orders hot row**. The biggest design gap
  is treating travel as the dominant term — in a 3 km town, **prep + dwell/handover time
  dominate**, and those are the least modeled.
- **Staff Backend:** Two concrete scaling traps: **a DB write to the `orders` row per
  recompute**, and **coordinate-keyed distance caching that cannot hit on a moving rider**.
  Also: ETA must survive socket loss (be in `GET /orders/:id`), use **durations not absolute
  timestamps**, and respect the **`riderId` (profile) vs Redis location key (`userId`)**
  id-space split that already bit us in BUG-1.
- **OPS:** The model assumes data we won't reliably have on the ground — **steady GPS** (Android
  background-location kills it), **steady town speed** (market lanes, animals, parking), and
  **predictable seller prep**. Without monitoring + a **cost kill-switch + budget alerts**,
  this is a silent-failure and silent-spend risk.
- **PM:** A wrong ETA erodes trust faster than no ETA. The **static "30 min" fallback** and
  the **"max-of-children" group ETA** will both read as broken to customers; **partial
  multi-shop delivery** and **"arriving" on bad address pins** need UX, not just a number.

What the design got right (so the criticism is calibrated): server-as-source-of-truth,
`prep + travel` recomputed per phase, reusing `distance.service`/`distanceKm`/sockets,
best-effort/non-blocking, and phasing. The issues below are about **realism, cost, and
correctness at the edges**, not the core direction.

---

## 1. Wrong assumptions

**A1 — Travel time treated as the dominant term; dwell/handover ignored.** 🟠 High · PE/OPS
- *Impact:* On a 3 km trip, the variance is **at the ends** — waiting at the shop, parking,
  finding the house, calling the customer, handover. The model has `prep + travel` but **no
  pickup-dwell and no last-50-m/handover term**, so ETAs will be systematically optimistic
  and noisy regardless of routing quality.
- *Mitigation:* Add explicit `pickupDwell` and `handoverTime` constants (AppConfig),
  measured from `pickedUpAt − readyAt` and `deliveredAt − arrival`. Treat travel as one of
  four terms, not the headline.

**A2 — "3 km town, traffic is minor; speed ≈ 18–20 km/h."** 🟠 High · OPS
- *Impact:* Effective two-wheeler speed through a dense Indian town market (narrow lanes,
  livestock, unpaved stretches, railway crossings, parking) is often **10–14 km/h**, not 18–20.
  A too-high constant biases every ETA low → chronic lateness.
- *Mitigation:* Calibrate `townSpeedKmph` from **actual** `deliveredAt − pickedUpAt` vs
  `distanceKm` before launch; keep it in AppConfig and tune from data. Start conservative.

**A3 — Prep starts at confirmation and is a stable per-shop average.** 🟠 High · OPS/PM
- *Impact:* Sellers don't start instantly; there's an **accept window with auto-accept-on-
  timeout** (`sellerAcceptedAt` can lag `confirmedAt`, and `missedAcceptances` exists). A
  single average ignores the accept gap and per-order variance → optimistic ETA exactly when
  the order is stuck unaccepted.
- *Mitigation:* Anchor prep on `sellerAcceptedAt`, not `confirmedAt`; widen the band until
  accepted; learn prep per shop × hour (P3). Surface a wider range pre-accept.

**A4 — `Order.distanceKm` is the right travel distance.** 🟡 Medium-High · PE
- *Impact:* `distanceKm` is the **shop→customer** straight pipeline distance at order time. The
  rider's real path is **rider→shop→customer**, and under **batching** it's a multi-stop route.
  Once batched, `distanceKm` is the wrong number. Also it's `0/'flat'` on the flat-fee path
  (`orders.service.ts:288`).
- *Mitigation:* Use `distanceKm` only for the placement estimate; compute live legs from the
  rider's position; for batches, sum the ordered-stop legs (`getActiveDelivery`). Always have
  a distance fallback for the flat path.

**A5 — Customer drop coordinates are accurate.** 🟡 Medium · OPS/PM
- *Impact:* The app uses manual pins / Plus Codes; town addressing is poor. A drop pin off by
  100–300 m breaks the final leg and the "arriving" geofence (fires early/late or never).
- *Mitigation:* Don't hinge "arriving" purely on geofence distance; combine with rider dwell
  + "rider says arrived." Show address/landmark prominently; let the rider mark "reached."

## 2. Scalability risks

**S1 — A DB write to the `orders` row on every recompute.** 🟠 High · BE
- *Impact:* Persisting `estimatedDeliveryAt` per recompute (esp. if recompute runs on the
  rider-ping path) means frequent writes to a **hot, wide row** → lock contention, WAL churn,
  `updatedAt` thrash, and replica lag at volume.
- *Mitigation:* **Don't persist on every recompute.** Keep the live ETA in **Redis** and
  emit-only; persist to Postgres only on **phase transitions** and a low-frequency checkpoint.
  Treat the DB value as "last milestone ETA," Redis/socket as "live."

**S2 — ETA recompute on the socket hot path.** 🟠 High · PE/BE
- *Impact:* The design recomputes inside the `rider:location` handler (every ~8 s/rider). Even
  debounced for *emits*, the **compute + any I/O runs per ping**; if a provider/DB call ever
  slips in, it stalls the location broadcast for all subscribers of that order.
- *Mitigation:* Make ETA computation strictly async/off the broadcast path (queue or
  fire-and-forget), pure-in-memory from Redis state, with a hard rule: **no network/DB I/O in
  the ping handler**. The location broadcast must never await ETA.

**S3 — Per-ping order/leg reloads from Postgres.** 🟡 Medium · BE
- *Impact:* Re-reading the order (+ shop, + rider) from Postgres each ping to compute ETA is
  O(active-orders × pings) DB load.
- *Mitigation:* Cache the per-order ETA inputs (shop coords, drop coords, prep, phase) in
  Redis at assignment; the ping path reads Redis only.

**S4 — Delay-sweep scan.** 🟡 Medium · BE/OPS
- *Impact:* A BullMQ job scanning all in-flight orders every 60–120 s is fine for a town;
  unbounded `findMany` at scale is not.
- *Mitigation:* Index on `(status, estimatedDeliveryAt)`; query only in-flight + due; cap batch
  size. (Cheap now, mandatory later.)

## 3. Cost risks — Google Distance Matrix

**C1 — Coordinate-keyed cache cannot hit on a moving rider.** 🟠 High · BE/PE
- *Impact:* `distance.service` caches by rounded lat/lng (~11 m). The **rider's origin changes
  every ping**, so live-leg lookups are **near-100% cache misses**. Any provider call tied to
  live position bypasses the cache entirely → cost scales with movement, not with orders.
- *Mitigation:* **Never** call the provider for live legs. Use local
  `haversine × roadFactor ÷ speed` for moving-origin legs; reserve the provider (cached) for
  **fixed** origin/destination pairs (shop→customer at placement, which is already cached).

**C2 — Latent catastrophic cost if provider creeps into the ping path.** 🔴 Critical (if it happens) · PE/OPS
- *Impact:* If a future change (or the P2 "live recompute") wires a Distance Matrix /
  `duration_in_traffic` call into per-ping recompute: ~active-orders × (3600/8) calls/hour.
  At Distance Matrix ~$5/1k elements this is a runaway bill discovered only on the invoice.
- *Mitigation:* Make it an **architectural invariant** (not a recommendation): provider calls
  only from a single, rate-limited module, **forbidden** in socket/ping code, enforced in
  review/lint. Add a global **kill-switch** (`AppConfig: eta.provider=off`) that forces the
  local model.

**C3 — No budget guardrails / shared key.** 🟠 High · OPS
- *Impact:* ETA adds to the *existing* Distance Matrix spend (pricing already calls it at
  order time) on a **shared `GOOGLE_MAPS_API_KEY`** with no per-feature quota or alerting.
  Even the "good" path (~1–2 calls/order on transitions) is ~$300/mo at 1k orders/day **on top
  of** current usage — silent until billing.
- *Mitigation:* GCP quota caps + budget alerts + a daily-spend dashboard; separate key or label
  for ETA vs pricing; the kill-switch from C2; evaluate **Mappls Distance/ETA** (already used
  for geocoding, India-tuned, likely cheaper) for consistency.

**C4 — Provider strategy is split (Mappls geocoding, Google distance).** 🟡 Medium · PE
- *Impact:* Two map vendors = two failure modes, two bills, two accuracy profiles; the doc adds
  ETA to Google while geocoding moved to Mappls.
- *Mitigation:* Decide one routing/ETA provider deliberately; if Mappls covers Distance Matrix
  + traffic for Chirawa, consolidate.

## 4. Rider-tracking accuracy

**R1 — Android background location kills the post-pickup ETA.** 🟠 High · OPS/PE
- *Impact:* The most accurate phase (post-pickup, live-leg ETA) depends on 8 s pings. On real
  rider phones, **backgrounding/battery-saver throttles or stops location**, so pings dry up
  **exactly when the customer is watching**. ETA freezes/goes stale at the worst moment.
- *Mitigation:* Rider app must use a **foreground service + persistent notification** for
  active deliveries; server must **detect ping starvation** and degrade to a distance/speed
  estimate + "location updating…" rather than a frozen clock. Monitor ping-gap rates per rider.

**R2 — No GPS smoothing; raw haversine between noisy pings.** 🟡 Medium · BE/OPS
- *Impact:* Cheap-phone GPS jitter/drift → erratic inter-ping distances → an ETA that jumps
  around → user distrust. Tunnels/dead zones produce teleports.
- *Mitigation:* Smooth (EMA/Kalman) or use the device-reported speed; reject implausible jumps
  (speed > threshold); optionally snap-to-road. Debounce ETA emits (already proposed) helps
  presentation but not the underlying noise.

**R3 — id-space footgun reading the live location.** 🟡 Medium · PE/BE
- *Impact:* `Order.riderId` is the **RiderProfile.id**, but the Redis location key is
  **`rider:{userId}:location`** (User.id). An ETA reader doing `rider:{order.riderId}:location`
  silently gets **nothing** — the identical class of bug as BUG-1, and it would degrade ETA
  invisibly.
- *Mitigation:* Resolve `riderProfileId → userId` once (or store both); add a test asserting the
  ETA path reads the right key. Treat as a known landmine.

**R4 — Stale-but-present location.** 🟡 Medium · OPS
- *Impact:* 30 s Redis TTL + 8 s pings: a 25 s-old fix still "valid" but the rider moved; ETA
  computed on a stale point is wrong-but-confident.
- *Mitigation:* Carry `ageMs` (already available via `getRiderLocationForOrder`) into the ETA;
  widen the band as age grows; stop showing a precise countdown past a freshness threshold.

## 5. Failure modes

**F1 — Static "30 min" fallback is itself misleading.** 🟠 High · PM/OPS
- *Impact:* When compute fails, falling back to `Shop.estimatedDeliveryMinutes` (default 30)
  shows a confident wrong number that contradicts reality → worse than an honest range.
- *Mitigation:* Fallback to a **wide range** ("20–40 min") or "calculating…", never a precise
  single value; flag `etaSource='fallback'` so the UI can soften.

**F2 — ETA must survive socket loss.** 🟠 High · BE
- *Impact:* `order:eta` rides the Redis pub/sub bridge (fire-and-forget). A dropped publish →
  the client holds a stale ETA indefinitely.
- *Mitigation:* **Mandatory:** include `estimatedDeliveryAt` (+ range, + `computedAt`) in
  `GET /orders/:id`; the existing 15 s poll is the reconciliation path. Socket is an
  optimization, not the source.

**F3 — Absolute timestamp + client clock skew.** 🟡 Medium · BE/PM
- *Impact:* A countdown from an absolute `estimatedDeliveryAt` is wrong if the **client clock**
  is skewed (common on cheap devices) → "arriving in -3 min."
- *Mitigation:* Send a **server `now` + duration** (or seconds-remaining) and let the client
  count down from receipt; reconcile on each push/poll.

**F4 — Placement-path latency.** 🟡 Medium · BE
- *Impact:* If ETA is computed synchronously at checkout and the provider is slow (3 s timeout),
  it adds latency to order creation, or there's a no-ETA window.
- *Mitigation:* Compute ETA **async after commit**; the order is created without waiting; the
  first ETA lands via poll/socket within seconds.

**F5 — Delay-detection feedback loop.** 🟡 Medium · OPS
- *Impact:* Late → push a later ETA → that's also breached → push again → notification spam.
- *Mitigation:* Hysteresis: one "running late" transition, then suppress re-alerts unless the
  ETA moves materially; cap notifications per order.

**F6 — Reassignment / rider release mid-flight.** 🟡 Medium · PE
- *Impact:* `releaseOrderAssignment` nulls `riderId`; the ETA service must handle `riderId=null`
  (revert to a pre-assignment estimate), not crash or freeze on the last rider's position.
- *Mitigation:* On rider-change events, reset the pickup leg; if unassigned, fall back to
  prep+placement-distance and a wider band.

## 6. Multi-shop complexity

**M1 — "max of independent children" double-counts shared routes.** 🟠 High · PE/BE
- *Impact:* Children of one `OrderGroup` may be batched to **one rider** who picks up from
  several shops and drops them on one trip. Computing each child as its own
  rider→shop→customer **double-counts legs** and ignores the shared route; `max` of those is
  both wrong and pessimistic. Conversely, children on **different riders** arrive far apart, and
  one late child makes the whole group look late.
- *Mitigation:* If batched to one rider, compute a **single ordered-stop route ETA** per stop
  (this is a small vehicle-routing/TSP-ish problem — acknowledge it, don't hand-wave). If on
  different riders, consider **per-child ETAs** and a partial-arrival UX rather than one number.

**M2 — Group children span different phases.** 🟡 Medium · BE
- *Impact:* `getOrderGroup` rolls up to the least-advanced status; one child may be `preparing`
  while another is `out_for_delivery`, so the per-child ETA formula differs — more state to
  aggregate than the doc implies.
- *Mitigation:* Compute each child with its own phase formula, then aggregate; define the group
  rule explicitly (slowest live child).

**M3 — Partial delivery is unmodeled (product gap).** 🟡 Medium · PM
- *Impact:* Customer may receive shop A's items, then wait for shop B's — a single "max" ETA
  hides that half the order arrived.
- *Mitigation:* Per-shop progress + per-shop ETA in the group view; "2 of 3 delivered, last
  arriving ~9:50."

## 7. Edge cases

| ID | Edge case | Sev | Impact | Mitigation |
|---|---|---|---|---|
| E1 | Order placed when shop **closed / about to close** (operatingHours) | 🟡 | Prep won't start; placement ETA meaningless | Gate ETA on shop open; if pre-open, ETA from next open time or suppress |
| E2 | **Very short** distance (<300 m) | ⚪ | Travel term ~0; model could show "1 min" | Floor the ETA (prep+dwell+handover dominate); never show <X min |
| E3 | Drop is the **2nd/3rd stop** of a batch | 🟠 | "rider→customer" assumes direct travel; ignores prior stops | Use ordered-stop legs; ETA = sum of legs up to *this* stop |
| E4 | **Re-attempt / failed delivery** | 🟡 | Not modeled; ETA stale after a bounce | Define re-attempt → recompute or clear ETA |
| E5 | Rider **idle/break** mid-trip | 🟡 | Live-leg ETA assumes continuous motion → keeps ticking down wrongly | Detect zero-movement; widen band / "delayed" |
| E6 | **Timezone/display** (server UTC vs IST) | ⚪ | "by 21:42" shown in wrong tz | Send duration (F3) or tz-aware formatting |
| E7 | **COD vs prepaid** at handover | ⚪ | COD adds cash-collection time at the door | Small handover constant covers it (A1) |

---

## Prioritized "fix before build" (MVP gating)

1. **C2 + C1 + C3** — make "no provider calls on the live/ping path" an enforced invariant; add
   kill-switch + budget alerts. (Cost is the only *irreversible* risk here.) 🔴/🟠
2. **S1 + S2** — keep live ETA in Redis/emit-only off the socket hot path; persist only on
   transitions. 🟠
3. **F2 + F3** — ETA in `GET /orders/:id`; send duration not absolute time. 🟠
4. **A1 + A2 + A3** — model dwell/handover, calibrate town speed from real data, anchor prep on
   `sellerAcceptedAt`. (These three drive accuracy more than any routing upgrade.) 🟠
5. **R1 + R3** — foreground-service location + ping-starvation degradation; fix the
   profileId↔userId location-key id-space. 🟠/🟡
6. **M1** — pick the multi-shop semantics (single-rider route ETA vs per-child + partial UX)
   before promising a group number. 🟠
7. **F1** — fallback is a wide range, never a confident wrong single value. 🟠

**Bottom line (all four lenses agree):** the core model is right, but **accuracy comes from
dwell/prep/speed realism + reliable rider location, not from a fancier router**, and the
**cost path must be made un-blowupable before any provider call ships**. Treat "production-
grade" as a P2/P3 destination; ship the MVP as an honest, well-bounded estimate.
