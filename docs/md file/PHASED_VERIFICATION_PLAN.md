# PHASED_VERIFICATION_PLAN.md

> Execution plan to move all 52 features from **Code Verified Only → Runtime Verified**
> (baseline in `FEATURE_VERIFICATION_MATRIX.md`). Phases are by priority; within each phase,
> features are **sorted by production risk** (Critical → High → Medium → Low).
> This plan schedules verification only — no fixes, no new features, no security review.

- **Phase 1 — all P0** (money/data critical): 19 features
- **Phase 2 — all P1** (core operations): 24 features
- **Phase 3 — all P2** (secondary): 9 features

Estimate legend: `S` ≤0.5d · `M` ≈1d · `L` ≈2d · `XL` ≈3+d (one engineer).

---

## 0. Global Prerequisites (set up once, before Phase 1)

These are verification *harness* prerequisites, not code changes.

| # | Prerequisite | Unblocks |
|---|---|---|
| 0.1 | Seed DB (`prisma/seed.ts` + seeds: shops, zones, riders, FeeRule v1, search aliases) + a few test customers; resolve the seeded-seller `+91` vs 10-digit login note | All flows |
| 0.2 | Run **multi-process**: ≥2 API instances + 1 worker (PM2) — required to observe Socket.IO Redis adapter + event-bus bridge + queue workers | E2, E3, E4, E6, B3, A11 |
| 0.3 | **Razorpay test keys + RazorpayX sandbox + webhook tunnel** (e.g. ngrok) | A10, A13, E3, E4, C6, D7 |
| 0.4 | FCM service account (or accept dev console-log mode); SMS dev console + OTP bypass `123456` | A16, B8, E5, all auth |
| 0.5 | Short time-controls via env: `SELLER_ACCEPT_MS`, `BATCH_WINDOW_MS`, `ASSIGN_RETRY_MS`, `ASSIGN_MAX_ATTEMPTS` | B3, E2 |
| 0.6 | R2 creds (optional — placeholder works but won't host); Mappls creds (optional — on-device geocoder fallback) | D5, E7, A3 |
| 0.7 | Devices/emulators for the 3 Expo apps (UI, barcode scanner, GPS, maps, push) | All app-UI bindings |
| 0.8 | **Fixture shortcut:** use **D7 admin manual assign** (a P0 feature) to push an order to a specific rider without depending on Phase-2 batching (E2). | C4, C5, C6 in Phase 1 |

**Cross-phase dependency note.** A strict risk sort alone would schedule (e.g.) settlement
before login, which is physically impossible. Each phase below therefore lists features
**risk-sorted** (as requested) *and* gives a **dependency-aware execution sequence**. The auth
trio (A1/B1/C1) and the order state machine (E1) are functional prerequisites and are exercised
first as fixtures even though risk-ranked below the Critical money movers.

---

## Phase 1 — P0 (money / data critical) · 19 features

**Objective:** prove every money/identity/order-of-record path at runtime, including ledger
correctness, idempotency, and the key concurrency/recovery cases. Confirm dead/partial P0 items
(E8 inert, E13 unenforced, E4 seller-notify TODO) and document their actual runtime state.

### 1A. Risk-sorted feature list

| Order | Feature | Risk | Effort | Notes |
|---|---|---|---|---|
| 1 | E1 Order State Machine | Critical | S | Unit-level; underpins all transitions |
| 2 | E11 Fee / Pricing Engine | Critical | S | Pure function + active fee-rule version |
| 3 | A9 Checkout & Order Creation | Critical | L | Multi-shop split, stock decrement, promo |
| 4 | A10 Payment (Razorpay) | Critical | L | Signature + multi-shop single payment |
| 5 | E3 Payment Webhook + Reconciliation | Critical | L | Idempotency + dropped-webhook safety net |
| 6 | B2 Seller Accept/Reject/Prepare/Ready | Critical | M | Reject→refund + transitions |
| 7 | C5 Delivery Completion + COD | Critical | M | Cash ledger, terminal state |
| 8 | C6 Rider Report Item Unavailable | Critical | M | Line refund / order cancel |
| 9 | A14 Item-Unavailable Live (customer) | Critical | M | Customer side of C6 |
| 10 | A13 Cancel / Refund / Rate / Edit | Critical | M | Prepaid auto-refund |
| 11 | E4 Seller Settlement + Payouts | Critical | L | RazorpayX payout state machine |
| 12 | A1 OTP Login & Signup | High | M | Entry fixture (run first in practice) |
| 13 | B1 Seller OTP+PIN Login | High | S | PIN lock/rotation |
| 14 | C1 Rider OTP+PIN Login | High | S | PIN lock/rotation |
| 15 | B3 Auto-Accept on Timeout | High | M | Race vs manual accept; idempotent jobId |
| 16 | E12 Promotions | High | M | Clamps, caps, FIRSTORDER |
| 17 | D7 Admin Manual Assign + Refund | High | S | Also the C5/C6 fixture (0.8) |
| 18 | E13 COD Float Cap | High (latent) | S | Verify (non-)enforcement |
| 19 | E8 Referral Credit Unlock | Low (inert) | S | Verify no credits granted (dead) |

**Phase 1 effort:** ≈ **19–20 engineer-days** + ≈2–3 days one-time harness (§0).

### 1B. Dependency-aware execution sequence

1. **Fixtures first:** A1 → B1 → C1 (auth), then E1 + E11 (state machine + pricing, fast unit-level).
2. **The "money spine" end-to-end thread** (run as one scripted scenario, exercises ~12 P0 features):
   `login (A1)` → seed cart → `checkout (A9)` → `pay (A10)` → `webhook/reconcile (E3)` →
   `seller accept (B2)` *or* `auto-accept (B3)` → `admin manual assign (D7)` →
   `rider deliver / COD (C5)` → `settlement + payout (E4)`.
3. **Refund branches off the spine:** `customer cancel→refund (A13)`, `rider item-unavailable (C6)` +
   `customer live update (A14)`, `admin refund (D7)`.
4. **Money-correctness checks:** E12 promotions discount math, E11 fee bands, E13 COD cap state.
5. **Confirm-dead:** E8 — verify first delivery grants **no** referral/wallet credit.
6. Then run each feature's **edge / failure / concurrency / permission** cases from the matrix.

### 1C. Exit criteria
- Money spine traced end-to-end at runtime with correct `Transaction`/`Settlement`/`Payment` ledger.
- Idempotency observed: duplicate webhook (E3), re-run settlement/payout (E4), auto-accept jobId dedupe (B3), duplicate "Place Order" (A9).
- Permission cases pass: cross-user/cross-shop/cross-rider actions → 403.
- Recovery proven: dropped webhook → reconcile (E3); transaction rollback on oversell (A9).
- Dead/partial P0 documented: E8 inert, E13 unenforced, E4 seller-notify TODO confirmed.

---

## Phase 2 — P1 (core operations) · 24 features

**Objective:** prove fulfilment, dispatch, catalog/stock, tracking, notifications, and the
cross-process plumbing at runtime. Depends on Phase 1 (orders must be creatable/payable).

### 2A. Risk-sorted feature list

| Order | Feature | Risk | Effort | Notes |
|---|---|---|---|---|
| 1 | E2 Auto-Dispatch Batching | High | L | Zones, ≤3/800m/window, retry→SMS escalate |
| 2 | E6 Cross-Process Event Bus | High | M | Worker→API delivery, multi-instance |
| 3 | A8 Cart (multi-shop) | High | M | Price/qty integrity, YMAL race, fee-band |
| 4 | A3 Address Book + Geocode | High | M | Delivery accuracy, default invariant |
| 5 | B4 Stock Management | High | M | Drives oversell/feed; CSV import |
| 6 | C4 Active Delivery / Batch | High | M | Pickup-order gating, multi-stop |
| 7 | A5 Aggregated Catalog Feed | Medium | M | Grouping, cache single-flight |
| 8 | A6 Search + Autocomplete | Medium | M | Trigram + Hinglish aliases |
| 9 | A11 Order Tracking (live) | Medium | M | Socket + map + poll fallback |
| 10 | A16 Push Notifications (customer) | Medium | M | FCM token lifecycle |
| 11 | B5 Barcode Scan / Stock-This + Offline | Medium | M | Scanner + offline replay |
| 12 | C2 Availability + Live Location | Medium | M | GPS push, TTL, candidate pool |
| 13 | D4 Catalog Moderation / Coverage / Metrics | Medium | M | Approve/takedown/reports |
| 14 | D5 Image Upload & Management | Medium | M | R2 + pipeline |
| 15 | E5 Notifications Fan-out | Medium | M | Event→channel routing |
| 16 | A7 Product Detail + Variants | Medium | S | Variant price |
| 17 | A12 Server ETA | Medium | S | Milestone recompute |
| 18 | B7 Sales & Settlement Reporting | Medium | S | Read-only money display |
| 19 | B8 Seller Push | Medium | S | Alarm channel |
| 20 | C3 Assignment Alert | Medium | S | Socket + FCM |
| 21 | D6 Bulk Product Import (JSON) | Medium | S | Idempotent ≤500 |
| 22 | D2 Dispatch Live-Ops Snapshot | Low | S | Read-only admin |
| 23 | E7 Catalog Enrichment (OFF) | Low | S | Gated on dump |
| 24 | E9 Maintenance Cleanup Jobs | Low | S | Nightly purges |

**Phase 2 effort:** ≈ **20–21 engineer-days**.

### 2B. Dependency-aware execution sequence
1. **Plumbing first:** E6 (event bus, multi-process) + E2 (batching) — these make orders move and
   prove that the Phase-1 manual-assign fixture (D7) can be replaced by real auto-dispatch.
2. **Customer shopping surface:** A3 → A8 → A5/A6/A7 → A11/A12 (tracking/ETA observed end-to-end).
3. **Seller/rider operations:** B4/B5 (stock) → C2/C3/C4 (rider live ops).
4. **Notifications + catalog ops:** A16/B8/C3/E5 (push) → D4/D5/D6 (catalog/image/import).
5. **Background:** D2 snapshot, E7 enrichment (with a small OFF dump), E9 cleanup.

### 2C. Exit criteria
- Auto-dispatch observed: order confirmed → batched → assigned to best rider; no-rider → retry → SMS escalate.
- Cross-process events observed: a worker-emitted event reaches an API socket + FCM on a *different* instance.
- Cart integrity under the rapid add/qty race (YMAL) holds; fee-band refresh fires.
- Tracking shows live status/location/ETA with poll fallback when socket drops.
- Catalog/stock CRUD + CSV/JSON import + moderation observed; cache invalidation visible to customer.

---

## Phase 3 — P2 (secondary) · 9 features

**Objective:** verify secondary surfaces and **confirm the hidden/partial features behave as
documented** (not accidentally active). All Phase-3 items are Low risk.

### 3A. Risk-sorted feature list (all Low)

| Order | Feature | Risk | Effort | Notes |
|---|---|---|---|---|
| 1 | A17 Referral/Loyalty/Wallet UI (hidden) | Low | S | Confirm hidden by `growthLoops:false`; `GET /users/me/loyalty` works |
| 2 | E10 Audit Log (partial) | Low | S | Confirm whether any path writes rows |
| 3 | C7 Earnings (partial) | Low | S | Confirm data source backing the screen |
| 4 | D1 Search-Alias Management | Low | S | Create/merge + cache invalidation |
| 5 | D3 Demand Dashboard | Low | S | Ranked request demand |
| 6 | A15 Request Item + Restock Notify | Low | S | Capture + single FCM on restock |
| 7 | B6 Report Wrong Image | Low | S | Re-gate master to needs_review |
| 8 | A4 Home Feed | Low | S | Rails render; cache behaviour |
| 9 | A2 Profile & Language | Low | S | Profile edit + language persistence |

**Phase 3 effort:** ≈ **4–5 engineer-days**.

### 3B. Execution sequence
1. **Confirm-inert/partial first:** A17 (hidden), E10 (audit writers), C7 (earnings source) —
   establish that documented dead/partial states are the *actual* runtime states.
2. Then the functional secondaries: D1, D3, A15, B6, A4, A2.

### 3C. Exit criteria
- Hidden growth-loop UI confirmed not reachable with `growthLoops:false`.
- Audit-log and COD-cap (from Phase 1) partial states documented as observed.
- Remaining secondary features show happy-path behaviour.

---

## Roll-up

| Phase | Scope | Features | Risk mix | Est. effort |
|---|---|---|---|---|
| 1 | P0 | 19 | 11 Critical · 7 High · 1 Low | ~19–20 d (+2–3 d harness) |
| 2 | P1 | 24 | 6 High · 15 Medium · 3 Low | ~20–21 d |
| 3 | P2 | 9 | 9 Low | ~4–5 d |
| **Total** | | **52** | | **~44–46 engineer-days** (+ harness) |

**Sequencing summary (by production risk, dependency-respecting):**
Auth + state machine + pricing fixtures → Phase 1 money spine (checkout→pay→fulfil→settle→refund)
→ Phase 2 dispatch/plumbing then shopping/ops/catalog → Phase 3 secondary + confirm-inert.

No fixes, feature recommendations, or security review are included — verification scheduling only.
