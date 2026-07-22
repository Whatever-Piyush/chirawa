# ETA Phase 1 — Principal Engineer Review

**Premise:** assume there's a bug. There is — a verified one (#6). The implementation is
clean and tested, but in **production it never produces a real per-order ETA**; every order
falls through to the generic fallback range. Plus a half-wired socket push and a
notification ordering bug. Details below, by the ten areas, each with **Severity · Impact ·
Evidence · Mitigation**. No code changed.

Severity: 🔴 Critical · 🟠 High · 🟡 Medium · ⚪ Low.

---

## 🔴/🟠 Headline bug (area 6) — `distanceKm` is 0 for every real order ⇒ ETA is always the fallback

**Severity:** 🟠 High (the feature ships but delivers none of its intended accuracy).
**Evidence:**
- `placeOrder` hardcodes the create: `distanceKm: 0, distanceSource: 'flat'`
  (`orders.service.ts:288`). Every order created through checkout stores `distanceKm = 0`.
- DB confirms: of 54 orders, **51 are `flat`/0.000**, 1 `google_maps`/**0.000**; only 2
  (`haversine_fallback`, `cache`) carry a real 2.833.
- `computeEta` treats `distanceKm <= 0 || null` as **unknown** → `etaSource='fallback'`,
  `FALLBACK_TRAVEL_MIN=12`, spread ±10 min (`eta.service.ts`).

**Impact:** In production, **no order exercises the `prep_road` path** — they all show the
generic ±10-min fallback regardless of how near/far the customer is. The Phase-1 premise
("reuse `Order.distanceKm`") is satisfied in code but the column is 0, so the ETA carries no
per-order signal. The green runtime demo only showed `prep_road` because the harness
**manually seeded `distanceKm = 2.0`** — it did not reflect a real order. This is the bug the
review was meant to surface.

**Mitigation:** either (a) populate `Order.distanceKm` with the real road distance at
placement (the cached `pricing/distance.service` already computes it — the flat *fee* model
zeroed it, but the ETA needs the real distance), or (b) have `eta.service` compute the
shop→customer distance itself (allowed at a transition — placement), or (c) explicitly accept
"fallback-only ETA" for Phase 1 and **document it** so the wide range isn't mistaken for a
calibrated estimate. Today it's silently (c) while claiming (a).

**Secondary:** `distanceKm > 0` also misclassifies a *legitimate* 0/near-0 distance
(customer in the same building, or a Distance-Matrix 0 like the `google_maps`/0.000 row) as
"unknown." Use "distance known" vs "distance > 0" distinctly.

---

## 1. Wrong status transitions — ⚪ Low (no new bug)
- The new timestamps (`preparingAt`/`readyAt` in `updateOrderStatus`, `outForDeliveryAt` in
  `riderAdvance`) are stamped on the correct transitions (runtime-confirmed).
- `computeAndPersistEta` does **not** alter transitions; `assertTransition` is untouched.
- ⚪ Note: `assignOrder` recompute (`dispatch.service.ts:133`) fires on assignment, which is
  **not a status change** — it re-persists + re-emits an *identical* ETA (runtime: assign →
  814s unchanged). Harmless but a redundant write + socket event.

## 2. ETA recomputation race conditions — 🟡 Medium
**Evidence:** `computeAndPersistEta` is a **read-modify-write outside the status
transaction**: `findUnique` → `computeEta` → `order.update`, with no ordering/version guard.
**Impact:** assignment (async BullMQ worker / admin) can run concurrently with a seller/rider
transition. If a stale recompute's `findUnique` reads an earlier phase and its `update` lands
**after** a fresher one, it overwrites with a regressed ETA (e.g., a `ready` ±300 value
clobbering a `picked_up` ±120 value), and emits that stale ETA on `order:eta`. It self-heals
on the next transition, but the customer can briefly see a worse/wrong ETA.
**Mitigation:** compute inside the status transaction, or guard the update
(`where: { id, status }` / monotonic `etaComputedAt`), or serialize per-order. At minimum,
document the last-writer-wins window.

## 3. Migration rollback issues — 🟡 Medium
- **Additive & forward-only.** Prisma generated **no down-migration**; rollback = a *manual*
  `DROP COLUMN … / DROP INDEX`. The report's "rollback = drop columns" has no automated path.
- **Expand/contract hazard:** if the **DB** is rolled back (columns dropped) while the **new
  code** still runs, `getOrder`'s `findUnique` (no `select` — returns all scalars) will query
  `estimated_delivery_at` and **throw → 500 on order detail** (the best-effort try/catch only
  guards `computeAndPersistEta`, not `getOrder`/`etaResponse`). Roll back **code-first**, or
  code+DB together.
- `shops.prep_time_minutes NOT NULL DEFAULT 8` is fine at 10 shops (PG adds NOT NULL+DEFAULT
  without a rewrite); note it for a larger table.

## 4. Socket event correctness — 🟡 Medium (push is half-wired)
**Evidence:** the server emits `order:eta`, but the **client never subscribes** — `OrderTrackingScreen`
only registers `order:status` and `order:location` (`:471`, `:476`); there is **no
`order:eta` handler**.
**Impact:** the "pushed via `order:eta`" claim is only half true — the server pushes, the UI
ignores it. ETA reaches the screen **only via the 15 s poll**. Worse, `order:status` updates
status locally **without refetching** (`setOrder({...prev, status})`), so after a transition
the client shows the **new status with a stale ETA for up to 15 s**.
**Also:** the bridge emits to **both** `order:{id}` and `user:{customerId}` (mirroring
`order:status`), so a subscribed customer receives **duplicate** `order:eta` events — the
(absent) client handler would need to be idempotent.
**Mitigation:** add the client `order:eta` listener (Phase 1's stated deliverable), or
refetch on `order:status`; dedupe the dual-room emit.

## 5. Missing edge cases — 🟡 Medium
- **Late orders:** `etaResponse` clamps `secondsRemaining` to `≥ 0`; the header range becomes
  a perpetual "1–X min" once past ETA — a confidently-wrong small ETA with no "running late"
  state (Phase 3) — arguably worse than honest.
- **`placeOrder` awaits ETA serially per child** on the **checkout response path**
  (`for (const o of created) { … await computeAndPersistEta }`): N children ⇒ N sequential
  read+update+emit before the HTTP response returns. Review F4 said compute **async
  post-commit**; this adds latency to checkout. Fire-and-forget instead.
- **Shop operating hours** ignored (review E1): an order placed when the shop is closed gets an
  ETA assuming prep starts now.
- **`etaComputedAt`** is persisted but never read — dead field in Phase 1.

## 6. Orders with `distanceKm = 0` — see **Headline bug** above (🟠 High).

## 7. Orders without rider assignment — ⚪ Low (by design, but optimistic)
- `computeEta` has no rider dependency, so pre-assignment phases compute fine — correct.
- ⚪ But at `ready_for_pickup` with **no rider yet**, the ETA already counts only `travel +
  handover` as if travel starts now; it ignores the **wait-for-a-rider + pickup leg**, so a
  ready-but-unassigned order reads optimistically. Acceptable for Phase 1 (no rider position),
  worth documenting.

## 8. COD orders — 🟡 Medium
- **Prepaid (`pending_payment`) orders get an ETA before payment:** `computeEta` treats
  `pending_payment` as non-terminal and returns a full-prep ETA at placement, so an **unpaid**
  order shows a delivery ETA. Probably shouldn't surface until `paid`.
- **Terminal cleanup:** `codCollected`/`markDelivered` set `delivered` **without** calling
  `computeAndPersistEta`, so the `out_for_delivery` `estimatedDeliveryAt` **persists stale** on
  the delivered row. `getOrder` gates display (terminal → omitted) — fine for the UI — but a
  naive Phase-3 delay-sweep keyed on `(status, estimatedDeliveryAt)` could pick up stale rows
  if it doesn't filter status. Clear ETA on terminal, or ensure the sweep filters.
- COD adds **no** cash-collection time to the handover constant (review E7) — minor.

## 9. Multi-shop side effects — 🟡 Medium
- Each child order computes + persists + **emits its own** `order:eta` to the shared
  `user:{customerId}` room. A customer with an N-shop order receives **N distinct `order:eta`
  events** (different `orderId`s). A group view keyed on one ETA could flicker between children.
- `getOrderGroup` returns **no `eta`** (Phase 3), so the **group** tracking view has no ETA
  while each **child** view does — inconsistent for multi-shop customers.
- All children inherit `distanceKm = 0` ⇒ all show the same fallback ±10 min (compounds the
  headline bug).

## 10. Notification inconsistencies — 🟡 Medium
**Evidence (ordering bug):** in `riderAdvance`, `emitOrderStatusChanged` fires at
`dispatch.service.ts:220` **before** `await computeAndPersistEta` at `:226`. The notification
plugin listens to `ORDER_STATUS_CHANGED` and reads `estimatedDeliveryAt` for the
`out_for_delivery` push — but the **out-for-delivery ETA hasn't been persisted yet** (it's
written *after* the emit). So the push uses the **previous** (`picked_up`) ETA, or null →
`'jaldi'`; cross-process it may be even staler. The minutes in the push won't match the
in-app OFD ETA.
**Also:** push shows a **point** estimate ("X minute") while the app shows a **range**
("lo–hi min") — presentation inconsistency. And the handler now does an extra `findUnique`
per OFD push.
**Mitigation:** compute/persist the ETA **before** emitting the status event (or drive the
push off `ORDER_ETA_CHANGED`); align push vs in-app formatting.

---

## Summary (prioritized)

| # | Finding | Severity |
|---|---|---|
| 6 | `distanceKm = 0` for all real orders ⇒ ETA always the generic fallback | 🟠 High |
| 4 | `order:eta` emitted but **not consumed** by the client; status/ETA inconsistent ≤15 s | 🟡 Medium |
| 10 | OFD push reads ETA **before** it's recomputed (status emit precedes persist) | 🟡 Medium |
| 2 | Recompute is a read-modify-write outside the txn → last-writer-wins stale ETA | 🟡 Medium |
| 3 | No down-migration; DB-rollback-without-code breaks `getOrder` (500) | 🟡 Medium |
| 8 | ETA shown pre-payment; stale ETA left on terminal rows | 🟡 Medium |
| 9 | Per-child `order:eta` to one user room; group view has no ETA | 🟡 Medium |
| 5 | Late-order clamp ("1–X min"); checkout awaits ETA serially; hours ignored | 🟡 Medium |
| 1 / 7 | Redundant recompute on assignment; ready-unassigned ETA optimistic | ⚪ Low |

**Bottom line:** Phase 1 is well-structured and well-tested, and the *plumbing* is correct —
but the **headline bug (#6) means production orders never get a real ETA**, and the
**socket push (#4) and OFD notification (#10) are not actually wired through end-to-end**.
Fix #6 (real distance) and #4 (client listener) before this is meaningfully "done"; the rest
are bounded follow-ups. None corrupts data or blocks order flow (best-effort held).
