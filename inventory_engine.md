# Bringly Inventory Engine — Engineering Design Document

**Status:** Proposed · **Author:** Principal review of `customer-app-validation` branch · **Scope:** marketplace inventory for a single-town, multi-seller, unified-storefront quick-commerce system.

**Reality check on your framing first.** Your prompt says "millions of inventory updates, thousands of concurrent orders." Chirawa at maturity is ~500 orders/day, ~20 sellers, maybe 10–40k inventory-relevant events/day. Design **correctness** like a big system (invariants, idempotency, append-only events, reconciliation) and **capacity** like a small one (single Postgres, no Kafka, no sharding, no Redis-as-truth). Every place below where big-co practice diverges from what you should build, I say so explicitly. Over-building capacity now is a complexity tax paid with zero users.

**Second reality check.** ~70% of this engine already exists in your repo: nullable `stockQty` (tracked vs untracked), atomic oversell-protected decrement, `stockStatus`, the resolver, seller accept screen, auto-accept timer, `riderReportItemUnavailable` + line-level refunds, `stock_update_log`, master-catalog aggregation, "request this item", BullMQ, `AppConfig`. This document is mostly a **belief layer + policy layer** on top of machinery you've built, plus two structural fixes (reservation split, auto-accept gating). It is not a rewrite.

---

## 0. Decisions Summary

| # | Decision | One-line why |
|---|---|---|
| D1 | Inventory is a **belief state**, never truth | Offline sales are invisible; truth exists only at verification instants |
| D2 | Bias conservative: under-promise availability | Cost of wrong-in-stock ≫ cost of wrong-out-of-stock |
| D3 | Numeric counts for the head (~50 SKUs/shop); binary for the tail | Zipf: head = most volume AND most drift; tail drifts slowly |
| D4 | Split `stockQty` into `expected_qty` + `reserved_qty` | Current decrement-at-placement conflates belief with commitment |
| D5 | Reserve at order placement, physically bag at `preparing`, **commit decrement at pickup** | Pickup is the rider-witnessed physical event |
| D6 | Every order is a verification: accept-screen chips + rider pickup are the sensors | Converts "sync all day" (impossible) into "verify ordered SKUs at order time" (free) |
| D7 | Lazy decay computed at read time; DB writes only on events | No cron mutating rows with guesses; stored value = last known + provenance |
| D8 | Postgres single-statement CAS for concurrency; **no Redis locks** | Contention math: hottest SKU ~50 orders/day; PG handles 1000× that |
| D9 | Redis caches **derived availability only**, short TTL; PG is sole truth | Redis flush must lose nothing |
| D10 | Resolver = scored greedy set-cover, ≤2 shops/group, confidence-weighted | Optimal-enough at S≤20, I≤15; explainable via trace log |
| D11 | Auto-accept gated on line confidence | Current 3-min blind auto-accept is an inventory landmine |
| D12 | Partial-fulfill + auto-refund is the default failure mode, not order rejection | Your safety net already exists; lean on it |
| D13 | Nightly reconciliation job checking inventory invariants | Same discipline as your payments reconciliation, applied to stock |
| D14 | Hybrid endgame: micro-dark-shelf for head SKUs, marketplace for tail | Comes earlier than you think — see Part 17 |

---

## PART 1 — Inventory Philosophy

### 1.1 The core admission

For a non-POS Tier-3 kirana, **exact inventory is unknowable between verification events.** The seller sells 30 Maggi to walk-ins and your database learns nothing. No architecture, no lock, no cache fixes this — the information physically does not enter your system. Anyone selling you "real-time marketplace inventory sync" for un-instrumented shops is selling fiction. Amazon, with two decades and API mandates, still eats phantom-inventory cancellations on merchant-fulfilled orders (Part 16).

So the engine's job is not to *know* stock. It is to:

1. **Bound** the customer-visible error (safety buffers, conservative display),
2. **Sense** cheaply and constantly (every order accept and every rider pickup is a free audit of exactly the SKUs that matter),
3. **Recover** gracefully when wrong (partial fulfillment, auto-refund, substitution, auto-hide),
4. **Learn** (each miss updates velocity and confidence, so the same mistake shrinks over time).

This is dead reckoning, the same way a ship navigates between GPS fixes: you have a last-known position (`last_verified_at`, `last_verified_qty`), a drift rate (offline sales velocity), and periodic fixes (verifications). Between fixes you don't pretend to know the position — you carry an error bar and act on the pessimistic edge of it.

### 1.2 The five quantities

Per (seller, product) — or (seller, variant) where variants exist:

| Quantity | Stored? | Meaning |
|---|---|---|
| `expected_qty` | Yes (nullable) | Point estimate of shelf stock as of last event. `NULL` = untracked/binary item |
| `reserved_qty` | Yes | Units committed to in-flight online orders (held reservations) |
| `drift_estimate` | Derived | `velocity_per_day × days_since_verification` — expected invisible offline consumption |
| `effective_qty` | Derived | `max(0, expected − reserved − ⌈k·drift⌉)` — what we're willing to promise |
| `confidence` | Derived from stored base | `P(a promise on this item succeeds)`; decays with time, scaled by velocity |

Never store derived values. Never display `expected_qty` to customers — display and reserve against `effective_qty` only.

### 1.3 The asymmetry that drives everything

Showing **out-of-stock when actually in stock**: one lost sale, invisible, recoverable ("request this item" captures the demand — you built that).
Showing **in-stock when actually out**: failed order, refund, angry customer in a town where everyone talks, a wasted rider leg, and a burn on the exact trust a "one store" brand runs on.

Therefore every threshold in this document is tuned pessimistic. `k` in the buffer is ≥1. Confidence gates hide items *before* they're proven out. This will cost you a few % of theoretical GMV and it is the correct trade — Part 16 shows the industry converged on the same answer.

### 1.4 Three-layer defense (mental model for every flow below)

```
LAYER 1: PREVENT   effective_qty buffer + confidence-gated visibility
                   (don't promise what you probably don't have)
LAYER 2: DETECT    seller accept-screen chips + rider pickup confirmation
                   (verify ordered SKUs at the moment of truth, ~0 extra effort)
LAYER 3: RECOVER   partial fulfill → line refund → substitute → auto-hide → re-verify nudge
                   (already 80% built: riderReportItemUnavailable + fulfillmentStatus)
```

---

## PART 2 — Data Model

### 2.1 Mapping to what exists

You already have `products.stockQty` (nullable), `products.stockStatus`, `stock_update_log`, `order_items.fulfillmentStatus/refundedPaise`. The delta:

- **New table `inventory_state`** (1:1 product, or extend `products` — see 2.5) carrying the belief fields. Keeping it separate avoids widening your hottest catalog table and keeps catalog reads (feed/search cache) decoupled from inventory write churn.
- **`inventory_events`** replaces and supersedes `stock_update_log` (migrate, keep old rows as `event_type='legacy'`).
- **`reservations`** — new.
- **`stock_adjustments` — deliberately NOT built.** You asked for it; I'm merging it into `inventory_events` with `event_type ∈ {seller_count, admin_adjust}`. One append-only log, one query surface, one place the nightly reconciler reads. A separate adjustments table is a second source of truth waiting to disagree with the first.

### 2.2 Schema (Prisma-flavored, integer quantities, UUID PKs, snake_case @map — your conventions)

```prisma
model InventoryState {
  productId          String    @id @db.Uuid          // 1:1 Product
  variantId          String?   @db.Uuid              // null = base product row
  expectedQty        Int?                            // NULL = untracked (binary mode)
  reservedQty        Int       @default(0)           // invariant: == Σ reservations WHERE status='held'
  stockStatus        StockStatus                     // keep existing enum as the binary layer
  velocityClass      Int       @default(2)           // 0=dead 1=slow 2=medium 3=fast 4=ultra
  offlineVelocityPd  Decimal?  @db.Decimal(8,2)      // EWMA units/day incl. implied offline; null = use class default
  confidenceBase     Decimal   @db.Decimal(4,3) @default(0.800) // set at last event; decayed at READ time
  lastVerifiedAt     DateTime?
  lastVerifiedSource String?   // seller_count|seller_bucket|seller_toggle|rider_pickup|rider_miss|restock|admin
  lastVerifiedQty    Int?
  updatedAt          DateTime  @updatedAt
  @@index([stockStatus])
  @@map("inventory_state")
}

model InventoryEvent {                                // APPEND-ONLY. Never UPDATE/DELETE.
  id             String   @id @default(uuid()) @db.Uuid
  productId      String   @db.Uuid
  variantId      String?  @db.Uuid
  shopId         String   @db.Uuid                    // denormalized for per-seller queries
  eventType      String   // seller_count | seller_bucket | seller_toggle_out | seller_toggle_in
                          // | restock | order_reserved | reservation_released | reservation_expired
                          // | pickup_committed | rider_reported_missing | order_cancel_restock
                          // | admin_adjust | anomaly_negative_floor | legacy
  qtyDelta       Int?     // signed; null for pure-status events
  qtyAfter       Int?     // expected_qty after applying (belief snapshot)
  reservedAfter  Int?
  confidenceAfter Decimal? @db.Decimal(4,3)
  actorType      String   // seller | rider | customer | system | admin
  actorId        String?  @db.Uuid                    // User.id — NOT profile id (see handbook §24)
  orderId        String?  @db.Uuid
  orderItemId    String?  @db.Uuid
  reason         String?
  createdAt      DateTime @default(now())
  @@index([productId, createdAt(sort: Desc)])
  @@index([shopId, createdAt(sort: Desc)])
  @@index([eventType, createdAt])
  @@unique([orderItemId, eventType])                  // idempotency: retry-safe per line per type
  @@map("inventory_events")
}

model Reservation {
  id           String    @id @default(uuid()) @db.Uuid
  orderId      String    @db.Uuid
  orderItemId  String    @db.Uuid @unique             // idempotency: one reservation per line
  productId    String    @db.Uuid
  variantId    String?   @db.Uuid
  qty          Int
  status       String    // held | committed | released | expired
  expiresAt    DateTime?                              // set for pending_payment orders only
  createdAt    DateTime  @default(now())
  resolvedAt   DateTime?
  @@index([productId, status])                        // fast Σ held per product
  @@index([status, expiresAt])                        // expiry sweeper
  @@map("reservations")
}
```

**Column rationale, the non-obvious ones:**

- `expectedQty NULL` = binary mode. ~80% of a kirana's tail lives here. The reservation CAS (Part 6) skips the numeric check and gates on `stockStatus='available'` instead. This is your existing nullable `stockQty` semantic, preserved deliberately.
- `reservedQty` as a denormalized counter **plus** reservation rows: counter for the hot-path CAS (one UPDATE, no aggregate), rows for auditability and expiry. The nightly reconciler asserts they agree (Part 15).
- `confidenceBase` stored, `confidence(t)` computed — D7. A cron that decays confidence in the DB is write churn encoding a guess; a read-time function is free, always current, and the stored value keeps honest provenance ("what we believed at the last event").
- `qtyAfter/reservedAfter/confidenceAfter` on events = state snapshots, so you can replay/debug any product's history without reconstructing from deltas. Cheap at your volume, priceless at 2 a.m.
- `@@unique([orderItemId, eventType])` and `orderItemId @unique` on reservations: **idempotency at the schema level.** A retried worker job or double-tapped rider button cannot double-decrement. This mirrors your payment-webhook `eventId` unique — same discipline, applied to stock.
- `actorId` is `User.id`, consistent with `order_status_history`. Your #1 footgun (User.id vs profile id) gets a comment in the schema.

### 2.3 What changes in existing tables

- `products.stockQty` → migrate values into `inventory_state.expectedQty`, then deprecate the column (keep it readable for one release, dual-write, drop). `stockStatus` stays on `inventory_state` (move) — one home for availability.
- `order_items`: add `verificationFlag String?` (`accept_confirmed | auto_accepted_unverified | rider_verify_requested`) — feeds Part 4/11.
- `shops`: add `reliabilityScore Decimal @default(0.800)` (Part 7) and `avgRiderWaitMin Decimal?` (Part 11).

### 2.4 ER sketch

```
products 1──1 inventory_state          order_items 1──1 reservations
   │                 │                       │
   └───< inventory_events >──── orders ──────┘
                (append-only spine; reconciler reads only this + state)
```

### 2.5 Build note

If a separate `inventory_state` table feels heavy for MVP, adding the columns to `products` is acceptable at your scale — the *semantics* (expected vs reserved, event log, read-time decay) are the non-negotiable part, not the table boundary. I'd still take the separate table: your catalog Redis cache invalidation currently keys off product mutations, and you don't want every reservation bump invalidating feed caches.

---

## PART 3 — Seller Inventory Lifecycle

### 3.1 Onboarding: kill the "1000 products" goal

A Tier-3 kirana carries 800–2,000 SKUs. **Do not onboard them all.** The tail adds catalog noise, moderation load, and drift surface while contributing single-digit GMV. Target: **300–500 SKUs, of which ~50 are count-tracked.**

**Ops-assisted shelf walk (the only method that works for non-technical sellers):**

1. You (or an ops hire) walk the shop with the seller app, shelf by shelf. Barcode scan → your existing `GET /catalog/master/:barcode` + "I stock this" upsert. 3–5 seconds/SKU.
2. Per scan, one question, three big buttons: **बहुत है / थोड़ा है / खत्म** (lots/some/out). Buckets map to `expectedQty` defaults by category (e.g., lots=24, some=8 for FMCG snacks; lots=12, some=4 for oil tins) with `confidenceBase=0.85`, `source=seller_bucket`. **Never ask a shopkeeper to count** during onboarding — counting 1000 items is why POS adoption fails.
3. Exact counts only for the **head list**: a pre-printed ~50-SKU sheet per shop category (Maggi variants, milk, bread, eggs, Parle-G, cold drinks, atta, oil, sugar...). These get real counts, `confidenceBase=0.95`, `velocityClass` seeded from category priors.
4. Non-barcode items (loose atta, sweets by kg, bakery): your existing CSV import / quick-add with photo. Sweet shops (Chirawa Special — your margin engine) get extra care: their items are made-in-batches, so model as binary + daily morning confirmation, not counts.

Realistic budget: **2–4 hours per shop, one ops person + the seller.** At 5–20 sellers this is a week of founder time. It is also your relationship-building; don't outsource it yet.

### 3.2 Daily / weekly / monthly cadence

| Cadence | What | Effort | Mechanism |
|---|---|---|---|
| **Daily (open)** | Morning card: ≤8 SKUs the system most doubts (Part 4.4 selection) → है / कम है / नहीं है per item | ≤60 s | Push at shop-open time (you gate hours 9–8 already); BullMQ daily job |
| **Daily (passive)** | Accept-screen chips on flagged lines; out-toggle when a walk-in takes the last of something | ~0 marginal | Existing accept flow + one-tap toggle |
| **Weekly** | Restock day: "माल आया?" prompt on the shop's learned restock weekday → scanned or tapped items reset to bucket/count, `source=restock` | 5–10 min | Learn weekday from `restock` event history; default Tuesday until learned |
| **Monthly (first 3 months)** | Ops-assisted spot audit of the head 50 → recalibrates velocity EWMA against reality | 30 min/shop | Founder visit; drops to quarterly once EWMA stabilizes |

**Design law: the seller never does bookkeeping.** Bucket taps, binary toggles, few at a time, at moments they're already holding the phone. Anything resembling a stock register gets ignored within a week — and an ignored system is worse than no system, because it feeds you stale confidence.

---

## PART 4 — Offline Sales Drift: Detection & Recovery

### 4.1 The signal ladder (cheapest first)

```
S1  Rider pickup miss        cost ₹0   truth-grade    (BUILT: riderReportItemUnavailable)
S2  Seller accept-screen chip cost ~0  near-truth     (NEW: chips on flagged lines only)
S3  Lazy decay model          no signal, pure prior    (NEW: read-time math)
S4  Anomaly detection         pattern over S1/S2       (NEW-later: velocity way off → force verify)
S5  Scheduled verification    costs seller attention   (NEW: morning card, targeted, ≤8 items)
```

Nothing here requires the seller to report offline sales — the constraint you set, honored.

### 4.2 The decay math (S3)

At read time (resolver, catalog availability, accept-screen flagging):

```
hours    = now − last_verified_at                    (in hours)
vel      = offlineVelocityPd ?? class_default[velocityClass]   (units/day)
drift    = vel × hours / 24
effective_qty = max(0, expected − reserved − ⌈k × drift⌉)      k default 1.0
confidence(t) = confidenceBase × exp(−hours / τ[velocityClass])

τ defaults (hours):  ultra=8   fast=24   medium=72   slow=336   dead=∞(binary only)
class defaults vel:  ultra=15/d fast=6/d medium=1.5/d slow=0.2/d
```

Worked example — your Maggi scenario: seller verifies 50 at 9:00, class=fast (τ=24, vel=6/d... actually Maggi in a kirana is ultra: τ=8, vel=15/d). By 18:00 (9h): drift=15×9/24≈5.6 → effective=50−reserved−6. Confidence=0.95×e^(−9/8)=0.31 → **below θ_flag** → new orders for it get an accept-screen chip; below θ_hide it would be hidden. So the "offline customers bought 30" day ends with the system *already distrusting* the 50 long before a rider gets burned. The buffer won't have subtracted 30 — dead reckoning can't know the true rate on a spike day — but the confidence gate has shifted the check to the seller's thumb (S2), which does know.

Two knobs, two jobs: **effective_qty answers "how many can we promise"**, **confidence answers "should we promise unverified, or verify first."** Both derive from the same (hours, velocity); resist merging them — you'll want to tune them separately.

### 4.3 Event effects on belief (the update table)

| Event | expected_qty | confidenceBase | Notes |
|---|---|---|---|
| `seller_count` | := counted | 0.95 | Head-list audits |
| `seller_bucket` | := bucket default | 0.85 | Onboarding, restock taps |
| `seller_toggle_out` | := 0 | 0.95 | "नहीं है" — trust it fully |
| `seller_toggle_in` | := bucket default | 0.80 | No count given |
| `restock` | := entered/bucket | 0.90 | Resets the drift clock |
| `pickup_committed` (qty q) | −= q | +0.05, cap at prior base | **Weak** reinforcement: success only proves ≥q existed |
| `rider_reported_missing` | := rider-observed (usually 0) | := 0.15 | Also: retro-bump velocity EWMA (4.5); auto-hide from aggregation |
| `order_cancel_restock` | += q | unchanged | Goods never left shelf |
| `accept-chip "only n"` (S2) | := n + this order's q | 0.90 | Seller just looked at the shelf |
| `anomaly_negative_floor` | := 0 | := 0.20 | Commit would go negative → floor, log, queue verify |

Every row above = one `inventory_events` insert + one `inventory_state` update, **same transaction, always through one function** `applyInventoryEvent(tx, evt)` — your `transitionOrderStatus` discipline, cloned. No service ever writes `expectedQty` directly.

### 4.4 Targeted verification (S5) — never audit the catalog

Daily BullMQ job per shop, scored selection:

```
priority(item) = order_frequency_7d × (1 − confidence(now)) × value_weight
pick top N=8 → morning card
```

This is literally *expected cost of being wrong*. A slow-moving shampoo with confidence 0.3 scores near zero (nobody orders it); Maggi at confidence 0.5 tops the list. The seller's 60 seconds go exactly where drift hurts. Escalation: if a shop ignores 3 consecutive cards **and** has a rider miss, auto-hide its low-confidence tracked items and tell them why: *"आपकी 12 items छुपा दी गई हैं — verify करें"* — visibility is the incentive lever you have at 0% commission.

### 4.5 Learning the velocity (closes the loop)

On every verification event with a numeric count:

```
implied_consumption = last_verified_qty + Σrestocks − Σonline_committed − new_count   (over interval)
implied_offline_rate = max(0, implied_consumption − online) / interval_days
offlineVelocityPd = 0.7 × old + 0.3 × implied_offline_rate        (EWMA)
```

A rider miss on an item believed at 15 implies ≥15 offline units moved since verification → big EWMA bump → faster decay next time → earlier flagging. **The system gets less wrong about each SKU every time it's wrong.** MVP skips the EWMA (category defaults only); add at ~100 orders/day when you have signal.

### 4.6 Should we ask the seller before accepting an order?

As a separate blocking step: **no** — it murders the quick-commerce promise and doubles seller taps. Embedded in the accept screen they already use: **yes, for flagged lines only** (confidence in [θ_hide, θ_flag) or requested qty > effective−margin). One chip per flagged line: *"Maggi ×5 — है?"* → [है] [सिर्फ __] [नहीं]. Accept without touching chips = implicit confirmation of unflagged lines. Normal order stays 1 tap.

### 4.7 The auto-accept landmine (D11) — this is a design flaw in the current system

Today: seller ignores for 3 min → auto-accept → dispatch → rider may drive to a shelf that's been empty since noon. Auto-accept converts *"seller unresponsive"* into *"Bringly promised unverified stock"* — the worst failure class, at scale, silently.

Fix, minimal:

```
on 3-min timeout:
  if all lines confidence ≥ θ_auto (0.65):     auto-accept as today
  else:
    auto-accept BUT mark flagged lines verificationFlag='rider_verify_requested'
    rider app shows ⚠ on those lines: "confirm on shelf before bagging others"
    + bump seller.missedAcceptances weighting in reliabilityScore
```

And track **auto-accepted-order miss-rate** as a first-class metric — it's your canary for both seller disengagement and drift-model miscalibration.

### 4.8 Recovery flows (S1 fires)

Rider reports Maggi missing at pickup:

1. Existing flow runs: line → `unavailable_refunded`, prepaid refund / COD recompute, substitute suggestion socket. Keep all of it.
2. **New:** same transaction emits `rider_reported_missing` event → expected:=0, confidence:=0.15, `stockStatus=out_of_stock` → item drops out of aggregation *unless another seller covers it* (master-catalog aggregation gives you this for free — the customer-facing "Maggi" stays alive if Seller B has it).
3. Seller push: *"Maggi खत्म दिखा — वापस आए तो एक tap में on करें"* + item lands on tomorrow's morning card.
4. Velocity EWMA retro-bump (4.5).

One rider miss thus: refunds the customer, corrects the belief, hides the lie, nudges the seller, and recalibrates the model. That's the whole engine in one flow.

---

## PART 5 — Online Order: Customer Wants 5, Seller Has 2

Three detection points, three flows. Governing rule: **re-splitting to another seller is allowed only before rider assignment; after that, partial-only.** (Re-splitting mid-batch would strand riders and wreck ETAs for the other orders in the batch.)

### 5.1 Detected at placement (belief already says 2)

The resolver never promises 5 from this seller. Options in order:

1. Another seller's effective_qty covers the full 5 → route the line there (whole line, one seller).
2. No single seller covers 5 → **cap the cart at the best single seller's effective qty** ("सिर्फ 2 बचे हैं") — MVP does **not** split one line across two shops. Splitting a single line doubles the failure surface for one item and adds a pickup stop; allow it post-MVP only when line value ≥ ₹200 and no single seller covers.
3. Nobody has it → line unavailable → "request this item" capture (built).

### 5.2 Detected at accept (seller taps "सिर्फ 2")

```
seller chip: only 2
  ├─ residual 3 → re-run resolver on residual
  │     ├─ another seller covers, order not yet rider-assigned, added shops ≤ MAX_SHOPS
  │     │     → create sibling child Order in the same OrderGroup (your per-shop
  │     │       order model handles this NATIVELY — this is why OrderGroup exists)
  │     │       customer push: "बाकी 3 दूसरी दुकान से आ रहे हैं" (no shop name — unified store)
  │     └─ else → partial: this order carries 2; residual 3 → unavailable_refunded
  │              prepaid: auto line refund │ COD: recomputed total
  │              push: "5 में से 2 available — बाकी का refund हो गया" + substitute one-tap
  └─ belief update: expected := 2 + committed, confidence := 0.90 (4.3)
```

### 5.3 Detected at pickup (rider sees 2)

Too late to re-split. Rider taps "only 2" → partial-commit 2 (`pickup_committed` qty 2) + `rider_reported_missing` residual 3 → existing refund path → belief update per 4.3. Customer gets the item-unavailable socket + push they already get.

### 5.4 Why not reject the whole order?

Rejection punishes the customer for your data problem and throws away the 2 units of real GMV. Default is always partial + instant refund + substitute offer. The one exception: if the missing line is ≥80% of order value (the ₹450 ghee tin in a ₹500 order), push the customer a 2-minute choice "partial या cancel?" defaulting to partial. **MVP: skip even this** — always partial; the customer can cancel the remainder themselves pre-`preparing` (path exists). Fewer states, fewer timers.

---

## PART 6 — Reservation Engine

### 6.1 Where things happen, and why exactly there

```
CHECKOUT ──► RESERVE (soft hold)      POST /orders txn: reserved_qty += n via CAS
                │                     online: expiresAt = now+15m │ COD: no expiry
PAYMENT ────►  (hold persists)        webhook/verify/reconcile → order paid (existing)
SELLER ACCEPT ► (hold persists)       accept ≠ physical movement; no qty change
PREPARING ───► PHYSICAL RESERVE       seller BAGS the order — the only real-world
                                      defense against a walk-in buying "your" units
PICKUP ─────► COMMIT (hard decrement) expected −= n, reserved −= n, event, same txn
                                      rider-witnessed physical departure from shelf
DELIVERED ───► (nothing for inventory) goods left the store at pickup, not at doorstep
CANCEL/REJECT/EXPIRE ► RELEASE        reserved −= n, event order_cancel_restock/expired
```

**Why commit at pickup, not placement (current code) or delivery:**
- Placement-decrement makes `stockQty` mean "shelf minus promises" — a hybrid number that poisons the drift math and forces every cancel path to remember to re-increment (audit item A-1, §13.4).
- Delivery-decrement is 15–25 min after the goods physically left the shelf — during which the belief overstates stock.
- Pickup is the moment with a **witness and a button**: the rider's pickup confirmation is already a required step in your state machine. Commit rides on it for free.

**The honest gap:** between RESERVE and PREPARING, a walk-in can still buy the reserved units — no software stops a hand reaching a shelf. The *bagging* step at `preparing` is the real reservation. Make it an explicit seller instruction ("accept का मतलब: सामान अलग रख दो"), and note the exposure window is minutes, bounded by your 3-min accept timer. Irreducible; acceptable.

### 6.2 The reservation CAS (the whole concurrency story in one statement)

```sql
UPDATE inventory_state
SET reserved_qty = reserved_qty + :n, updated_at = now()
WHERE product_id = :pid
  AND ( (expected_qty IS NOT NULL AND expected_qty - reserved_qty >= :n)   -- tracked
        OR (expected_qty IS NULL AND stock_status = 'available') );        -- binary
-- rowcount 1 → INSERT reservation(held) + inventory_event(order_reserved), same txn
-- rowcount 0 → line unfulfillable by this seller → resolver retries next candidate
```

Note the CAS checks raw `expected − reserved`, not buffered `effective_qty` — the buffer/confidence gates run in the **resolver** (don't route here), the CAS is the last-line arithmetic guard (don't oversell online-vs-online). Two gates, two jobs.

### 6.3 Reservation state machine

```
        ┌────────── payment never lands (expiresAt passed) ──► EXPIRED ─┐
HELD ───┼────────── pickup confirmed ─────────────────────►  COMMITTED  │ release:
        └────────── cancel / seller reject / line unavailable ► RELEASED ┘ reserved_qty −= n
```

Terminal: COMMITTED, RELEASED, EXPIRED. Expiry sweeper = 60s BullMQ repeatable job: `SELECT ... WHERE status='held' AND expires_at < now()` → release each in its own txn (idempotent: `WHERE status='held'` guard on the UPDATE). Wire into your existing cleanup-jobs family. **This also fixes the current risk that a stale `pending_payment` order strands decremented stock — audit item A-2.**

### 6.4 Oversell, precisely

- **Online vs online:** solved, fully, by 6.2. No lock objects, no Redis, no serializable isolation.
- **Online vs offline:** *unsolvable by locking* — the offline sale never touches your system. Only Layer-1 buffers shrink its probability and Layer-3 recovery bounds its cost. Any design claiming otherwise for non-POS sellers is lying to you.
- **Untracked items:** reservation rows still written (audit trail + expiry symmetry) but no counter math; oversell protection is `stockStatus` + seller toggle speed. Accepted looseness for the slow tail.

---

## PART 7 — Order Resolution Engine

### 7.1 Problem shape

Given order lines `[(master_id, qty)]` and candidate sellers each with per-line `effective_qty` and `confidence`, choose an assignment minimizing shops used while maximizing fulfillment probability and respecting geography. Formally weighted set cover → NP-hard in general, **trivially small here**: I ≤ ~15 lines, S ≤ 20 sellers, candidates per line ≤ ~5. At this size, correctness of the *scoring* matters; algorithmic cleverness does not.

### 7.2 Algorithm: scored greedy, ≤2 shops, exact fallback available

```
function resolve(lines, town_sellers, dropoff):
    residual = lines
    chosen   = []                                   # [(seller, {line: take_qty})]
    C = { s ∈ town_sellers : s.isOpen ∧ covers ≥1 line with
          confidence(s,line) ≥ θ_route ∧ effective_qty(s,line) > 0 }

    while residual ≠ ∅ and |chosen| < MAX_SHOPS:    # MAX_SHOPS = 2 (config), 3 hard cap
        best = argmax_{s ∈ C \ chosen} score(s, residual, chosen)
        if coverage_value(best, residual) == 0: break
        take = { l: min(l.qty, effective_qty(best, l)) for coverable l }
        # MVP: only take lines FULLY covered (no line-splitting, §5.1);
        #      full-cover lines preferred, partial line = cap-at-cart-time instead
        chosen.append((best, take)); residual −= take
    return chosen, residual                          # residual → unavailable lines

score(s, R, chosen) =
      w1 · Σ_{l∈R covered} value_paise(l) / total_value(R)      # paise-weighted coverage
    + w2 · min_{l covered} confidence(s, l)                     # weakest-link fulfillment prob
    + w3 · s.reliabilityScore                                   # historical miss/accept behavior
    − w4 · marginal_route_km(s | chosen, dropoff) / 3.0         # extra pickup distance, town-normalized
    − w5 · prep_penalty(s)                                      # prepTimeMinutes vs town median
defaults: w = (0.40, 0.25, 0.15, 0.12, 0.08)                    # AppConfig, tune live
```

**Complexity:** O(MAX_SHOPS × S × I) ≈ 2×20×15 = 600 score ops. Microseconds. **Exactness check:** with MAX_SHOPS=2 you can brute-force all C(20,2)+20 = 210 seller subsets and score exactly; greedy vs exact will differ ~never at this density, but the exact enumerator is 30 lines of code — ship greedy, keep the enumerator in tests as the oracle.

### 7.3 Why not the alternatives you listed

- **Pure greedy-by-coverage (current "fewest shops"):** right instinct, but coverage-only will happily route to the seller whose "coverage" is a 9-hour-stale belief. Confidence in the score is the entire point of this document reaching the resolver.
- **Graph/flow formulations:** min-cost-flow is the "correct" heavy tool for line-splitting across sellers; you're explicitly not splitting lines at MVP, so it buys nothing.
- **ML scoring:** DoorDash-style learned availability is where this converges (Part 16) — after you have thousands of (promise, outcome) pairs. Not before.

### 7.4 Two production details generic designs miss

1. **`resolver_trace`** — persist the scored candidate table as JSONB on the order (or an event). When an order fails, the first question is "why did we pick Seller A?" — answer it from data, not vibes. Costs ~1KB/order.
2. **Fairness as tie-break only.** At |score gap| < ε, prefer the seller with the oldest `last_assigned_at`. A 5-seller marketplace where one shop starves loses that shop, and seller supply is your scarcest asset. But **never** route to lower confidence for fairness — fill-rate outranks feelings. Also: apply a *stricter* θ_route for Chirawa Special sellers — a failed sweet-shop order burns your only commission margin.

---

## PART 8 — Redis

### 8.1 Should inventory live in Redis? **As cache, yes. As truth, no.**

At your ceiling (~500 orders/day, a few-thousand SKUs, feed QPS in the low tens) Postgres serves every read raw without noticing. Redis's role is what it already is in your stack — read-side cache for feed/search — extended to carry availability:

```
KEY    inv:avail:{productId}            (or folded into existing catalog cache objects)
VALUE  { s: "available"|"out", cap: <min(effective_qty, per_order_cap)>, cAt: ts }
TTL    90s                              # short: decay-derived values go stale by definition
```

- **Write path never touches Redis.** Reservation CAS, commits, events — Postgres only. This is the line that keeps you out of the two-sources-of-truth swamp.
- **Invalidation:** `applyInventoryEvent` DELs the key post-commit (best-effort). You already have the Redis pub/sub bridge for cross-process invalidation — reuse it; a lost invalidation costs ≤90s of staleness on a *cached availability hint*, and the reservation CAS catches the lie at order time anyway. Lossy bridge + short TTL + hard CAS = correct layering.
- **Failure recovery:** Redis down → cache misses fall through to PG (your read paths already degrade this way). Redis flushed → nothing lost, cache re-warms. If Redis being down could ever lose an inventory fact, the design is wrong.

### 8.2 The big-co contrast, named explicitly

Blinkit/Zepto-class systems run Redis-first inventory (reserve in Redis, async-persist to store) because they take **thousands of reservations/second per city** and PG row contention becomes real. That architecture drags in reconciliation daemons, Lua CAS scripts, and Redis-failover-consistency machinery. You would be importing their problems without their traffic. Revisit at ~10k orders/day/town — i.e., not Chirawa.

---

## PART 9 — Race Conditions & Locking

### 9.1 Two customers, last 3 Maggi, same second

Both orders run 6.2's single-statement conditional UPDATE inside their order transactions. Postgres row-locks the `inventory_state` row for the statement's duration; second writer waits ~µs, re-evaluates the WHERE against the *new* reserved_qty, gets rowcount 0, resolver moves to the next seller or caps the line. **No SELECT FOR UPDATE, no advisory locks, no Redis, no SERIALIZABLE.** The check and the mutation are one atomic statement — there is no gap to race in.

### 9.2 The one deadlock you must design away

Order 1 reserves products [A, B]; Order 2 reserves [B, A]; each holds one row-lock, waits for the other → PG kills one txn. Classic. Fix is one line: **sort lines by `product_id` before reserving.** (Your codebase already has this exact discipline for status CAS; extend the habit.) Retry-once on `40P01` deadlock_detected as belt-and-braces.

### 9.3 Why each alternative loses here

| Approach | Verdict | Why |
|---|---|---|
| Single-statement CAS (chosen) | ✅ | Atomic, contention-correct, zero infra, matches your existing CAS culture |
| `SELECT … FOR UPDATE` then update | Works, worse | Two round-trips, holds locks across app logic, invites the 9.2 deadlock with more surface |
| Optimistic version-column retry | Works, worse | Retry loops under contention; CAS *is* the optimistic check without the loop |
| Redis Redlock / SETNX | ❌ | Adds clock-skew and lock-expiry-mid-txn failure modes to solve contention PG already handles; a Redis blip then blocks *ordering* |
| SERIALIZABLE isolation | ❌ | Retry-storm tax on every order txn to protect one row a CAS protects for free |

**Contention math, so this is a decision and not a vibe:** hottest SKU ≈ 50 orders/day ≈ one reservation every ~11 min ≈ 0.002 writes/sec on that row. PG row-update throughput on a hot row is ~thousands/sec. You have six orders of magnitude of headroom. Revisit never (for one town).

### 9.4 Idempotency (races' quieter sibling)

Every mutation that can be retried is keyed: reservation `orderItemId @unique`; events `(orderItemId, eventType) @unique`; commit/release UPDATEs guarded by `WHERE status='held'`. A network-retried pickup confirmation, a redelivered BullMQ job, a double-tapped rider button — all collapse to no-ops. Same pattern as your webhook `eventId` — inventory just joins the club.

---

## PART 10 — Seller Experience

Design target: **45-year-old shopkeeper, ₹8k Android, mid-conversation with a walk-in, low patience, high pride.** Hindi-first (you already are). Tap budget is the spec:

| Moment | Screen | Taps |
|---|---|---|
| Normal order | Existing full-screen alarm → big item list → **ACCEPT** | **1** |
| Order w/ 2 flagged lines | Same + 2 inline chips: "Maggi ×5 — है?" [है][सिर्फ __][नहीं] | 3 |
| Walk-in bought the last packet | Product row / order screen → नहीं है toggle | 1 |
| Morning card (≤8 items) | है / कम है / नहीं है per row | ≤8, ≤60s |
| Restock day (weekly) | "माल आया?" → tap items or scan → bucket | 5–10 min, 1×/wk |

Rules that keep it alive past week two:

1. **The out-toggle is the single most important control in the app.** A seller who can't say "नहीं है" in one tap from wherever they are will instead reject orders or let riders fail. Put it on the order alarm, the product list, and the miss-notification.
2. **Chips only on flagged lines** (θ-gated). If every order interrogates them, they'll blind-tap है on everything and your S2 signal turns to noise. Scarcity of questions = honesty of answers.
3. **Notification budget:** order alarm (loud — exists), morning card (silent badge), restock prompt (1/wk), and the visibility-escalation warning (4.4) only when items actually get hidden. Nothing else. Every extra ping trains them to ignore the one that matters.
4. **Show them the why.** Weekly line in their sales summary: *"इस हफ्ते 2 order fail हुए — stock नहीं था. Stock सही रखने वाली दुकानों को ज़्यादा orders मिलते हैं."* At 0% commission, resolver traffic is your only carrot; say it out loud.
5. Never show them confidence scores or drift math. They see three states of the world: है / कम / नहीं. The model is your problem.

---

## PART 11 — Rider Flow: Two Sellers, One Customer

### 11.1 Route ordering

At ≤3 stops inside a 3-km town, TSP is a toy: order stops by **expected-ready-time first, then nearest-neighbor** from rider position. Expected-ready = accept_time + shop.prepTimeMinutes (you already store this and feed ETA from it). Practical effect: rider collects from the fast bakery while the kirana bags the big order — no math worth naming.

### 11.2 Wait policy (the part that actually goes wrong)

```
rider arrives, order not ready_for_pickup:
  t0: "मैं पहुँच गया" tap → urgent seller nudge (socket + FCM chirawa_alerts)
  t0+2m: second nudge, auto
  if other stops pending → REORDER: go do the other pickup, return  (app suggests, 1 tap)
  t0+WAIT_CAP (5m, AppConfig):
      → escalate to ops via support_phone flow (a human decides: wait / cancel lines / reassign)
      → log wait; increments shop.avgRiderWaitMin
```

**No auto-cancel timer at your scale.** A timer can't see that the seller is 30 seconds from done; you (ops) can, over one phone call, in a town of 60k. Automate the *detection and paging*, keep the *decision* human until decision volume forces otherwise (~100/day).

### 11.3 Batch interaction

Your batch-gating (can't `start-delivery` until batch complete) needs one relief valve: **ops-triggered partial depart** — release the rider with N−1 orders when one seller is pathological, re-dispatch the straggler. Without it, one slow shop melts the ETA of every order in the batch, and your ETA promise is the product.

### 11.4 Close the loop

`avgRiderWaitMin` and miss counts feed `reliabilityScore` (Part 7) → chronic delayers organically receive fewer multi-shop batches → wait pain self-heals through routing instead of through arguments. Telemetry → score → resolver is the same closed loop as inventory confidence; one pattern, two signals.

---

## PART 12 — Inventory Confidence Model (full spec)

### 12.1 Definition

`confidence(s, p, t)` ≈ P(a promise on product p from seller s, made at time t, is fulfilled without a miss). Not Bayesian-pure — a calibrated heuristic, chosen because it's **explainable at 2 a.m.** and tunable from `AppConfig` without a deploy. Resist upgrading it to a posterior until DoorDash-style (store, item, hour) outcome data exists (Part 16) — thousands of orders, not tens.

### 12.2 The formula (consolidated from 4.2/4.3)

```
confidence(t) = confidenceBase(last event, per table 4.3) × exp(−hours_since_verify / τ[velocityClass])
effective_qty = max(0, expected − reserved − ⌈k · vel · hours/24⌉)
```

### 12.3 Parameters (all AppConfig keys — your key/value ops table)

| Key | Default | Meaning |
|---|---|---|
| `inv.tau.ultra/fast/med/slow` | 8 / 24 / 72 / 336 h | Decay time constants |
| `inv.vel.ultra/fast/med/slow` | 15 / 6 / 1.5 / 0.2 per day | Class default velocities (until EWMA) |
| `inv.k_sigma` | 1.0 | Drift buffer multiplier (raise → fewer misses, less GMV) |
| `inv.theta_hide` | 0.40 | Below → hidden from aggregation, queued for verification |
| `inv.theta_flag` | 0.65 | Below → accept-screen chip + qty cap |
| `inv.theta_route` | 0.50 | Resolver won't route a line below this |
| `inv.theta_auto` | 0.65 | Auto-accept only above this (4.7) |
| `inv.theta_special_route` | 0.65 | Stricter routing floor for Chirawa Special shops |
| `inv.morning_card_n` | 8 | Verification card size |
| `inv.max_shops_per_group` | 2 | Resolver shop cap |
| `inv.reservation_ttl_min` | 15 | Online-payment hold expiry |
| `inv.rider_wait_cap_min` | 5 | Escalation threshold |

### 12.4 State bands (what each band *does*)

```
confidence ≥ .65   NORMAL   shown, routable, 1-tap accept, auto-accept eligible
.50 – .65          FLAGGED  shown w/ qty cap, routable, accept-screen chip, no blind auto-accept
.40 – .50          DOUBTED  not routed to (unless sole seller: chip mandatory), still visible
< .40 or eff=0     HIDDEN   out of aggregation (unless peer seller covers), on morning card
```

### 12.5 Calibration loop (post-MVP)

Monthly: bucket all promises by predicted confidence, compare to realized fulfillment rate. If the 0.7-bucket fulfills at 0.9, your τ values are too paranoid (losing GMV); at 0.5, too generous (burning riders). Adjust τ/k in AppConfig. This one chart is the entire "is the model right" question.

---

## PART 13 — Launch Version (MVP cut)

You're pre-launch; realistic day-1 volume is 20–50 orders/day with 5 sellers you personally know. The MVP question is: *what breaks trust at that volume?* Answer: rider misses and stale in-stock lies. Everything else waits.

### 13.1 Build NOW (pre-launch, ~1–2 weeks of work on top of existing code)

| Item | Size | Why now |
|---|---|---|
| `inventory_state` + `expected/reserved` split + `applyInventoryEvent()` | M | Everything hangs off it; retrofitting under live orders is misery |
| Reservation rows + expiry sweeper (fixes A-2) | S | Stranded-stock leak is live-day-one otherwise |
| Commit-at-pickup (move decrement out of placement) | S | Correct belief semantics; rider button already exists |
| Lazy decay + qty cap in resolver + θ_route gate | M | Layer 1 — the customer-facing lie-preventer |
| Rider-miss → belief update + auto-hide (extend existing flow) | S | Layer 2/3 sensor→actuator; 90% built |
| Accept-screen chips on flagged lines | S–M | The S2 sensor; one component in seller-app |
| Morning card (job + one screen) | M | The only proactive verification you get |
| Auto-accept confidence gate (4.7) | S | Defuses the landmine before real orders hit it |
| Nightly invariant reconciler (15.3) | S | Cheap insurance; you already run scheduled jobs |

### 13.2 HARDCODE now (config later)

τ/vel by class from the 12.3 defaults; velocity = class default only (no EWMA); `reliabilityScore` static 0.8 (you know your 5 sellers personally — you *are* the reliability model); no fairness rotation; no line-splitting; no partial-depart tooling (you're ops, you have a phone).

### 13.3 At ~100 orders/day add

Velocity EWMA (4.5) · reliabilityScore from real miss/wait data · fairness tie-break · calibration chart (12.5) · verification escalation/auto-hide policy (4.4) · seller "why" messaging (10.4) · partial-vs-cancel customer choice (5.4).

### 13.4 Pre-launch audit items on EXISTING code (from this review — do these regardless)

- **A-1:** Verify every cancel/reject path re-increments the placement-time stock decrement today. If any doesn't, you have a slow leak *right now*.
- **A-2:** Verify the stale-`pending_payment` cleanup releases decremented stock. (Superseded by 13.1's reservation work, but check the current behavior before migration.)
- **A-3:** Confirm `stock-this` bucket defaults don't write `confidence`-equivalent optimism anywhere the resolver trusts blindly.

### 13.5 At ~1000 orders/day (multi-town by then)

Redis availability cache w/ pub-sub invalidation (Part 8) · resolver becomes zone-scoped · inventory module peel-off candidate per ADR-001 · read replica for feed · ML availability scoring · **and the Part 17.4 hybrid conversation stops being optional.**

---

## PART 14 — Scaling Plan

| Stage | What changes | What explicitly does NOT change |
|---|---|---|
| **5 sellers** (launch) | 13.1 set; founder = ops = reliability model; manual everything ambiguous | Single PG, single Hetzner box, no cache for availability |
| **20 sellers** | Verification automation earns its keep (can't hold 20 shops in your head); reliabilityScore + EWMA live; ops dashboard becomes worth building (REST-only admin stops scaling at ~20 humans) | Concurrency design (9.x) untouched — headroom is 1000× |
| **100 sellers** (= multi-town) | Partition by town: zone-scoped resolver, per-town config, per-town head-lists; Redis availability cache; moderation queue needs real tooling (master-catalog review becomes the bottleneck, not inventory); seller-success playbook replaces founder relationships | Postgres stays single-primary — buy the bigger Hetzner box before you shard; add a read replica for feed first |
| **1000 sellers** | Streaming temptation appears (events → Kafka). Resist until BullMQ + partitioned PG measurably fails — at ~50k events/day/town it won't. Per-town **hybrid dark-shelf** (17.4) is now clearly better economics than fighting head-SKU drift; inventory module extraction per ADR-001 if its deploy cadence diverges | Belief-not-truth philosophy — it's *more* true at scale, not less; you just add owned-inventory pools where the math says buy |

The through-line: **capacity problems arrive years after correctness problems.** Every stage's real work is ops tooling and incentive design, not distributed systems.

---

## PART 15 — Failure Catalog

### 15.1 The table

| # | Failure | Cause | Detection | Recovery |
|---|---|---|---|---|
| F1 | Phantom stock (shows in, is out) | Offline sales drift | Decay flags → chip; else rider miss (S1) | 4.8 flow: partial+refund, belief:=0, auto-hide, nudge, EWMA bump |
| F2 | Reverse drift (shows out, is in) | Seller restocked, never tapped | Restock-day prompt; "requests" piling on a hidden item; weekly GMV-lost line in seller summary | One-tap toggle-in; morning card includes recently-hidden movers |
| F3 | Seller accepts, then discovers empty shelf | Blind accept habit | Seller taps नहीं post-accept (allow it!) or rider miss | Same as Part 5.2/5.3; count against reliabilityScore only if chip was shown |
| F4 | Auto-accept on phantom line | 3-min timeout, low confidence | The 4.7 gate prevents; canary metric: auto-accepted miss-rate | Rider-verify flag; seller escalation after repeats |
| F5 | Two customers, last units | Concurrent checkout | — (prevented) | 6.2 CAS; loser's line re-resolves or caps |
| F6 | Duplicate reservation / double decrement | Retry, double-tap, redelivered job | — (prevented) | Schema idempotency (9.4); guarded UPDATEs no-op |
| F7 | Reservation leak (held forever) | Crash between order-create and pay; sweeper down | Nightly reconciler: Σheld vs reserved_qty; held past TTL | Sweeper releases; reconciler force-releases + alerts |
| F8 | Payment success, seller rejects | Legit rejection | Existing flow | Your P0-2 refund ordering (cancel-first) + reservation RELEASE — extend release into every cancel path, tested |
| F9 | Rider delayed / no-show | Rider offline mid-batch | Assignment retry ×10 + SMS escalation (built) | Manual reassign (built); reservations persist (order still live) |
| F10 | Partial pickup | Some lines missing at shelf | Rider per-line buttons | 5.3: commit found, miss rest, refund lines |
| F11 | Customer cancels mid-`preparing` | Changed mind | Existing cancel path | RELEASE + `order_cancel_restock` event. **Policy gap:** made-to-order Chirawa-Special lines should lock cancel post-accept, or you eat the sweets — founder decision, flag it |
| F12 | Wrong item bagged/picked | Human error, similar SKUs | Customer complaint post-delivery | Refund/redeliver via ops; no inventory correction (a unit did leave); repeated pattern → shop coaching |
| F13 | Barcode → wrong master | Bad GTIN data, shared barcodes | Your image-report flow; customer complaints clustering on one master | Moderation re-gate (built); sever product↔master link; belief untouched |
| F14 | Negative commit (expected would go < 0) | Drift bigger than believed | Floor at 0 + `anomaly_negative_floor` event | Confidence:=0.2, morning-card queue, EWMA bump — an anomaly is *information* |
| F15 | Event-bus drop loses an inventory fact | Lossy Redis bridge | — (prevented by design) | **Inventory events are PG-transactional, never bus-carried.** Bus carries cache invalidations only (≤90s TTL bounds the damage) — your two-process rule (§4.4 handbook) applied |
| F16 | Worker down | Process death | Your existing worker-supervision TODO — now also stalls expiry sweeper + morning cards | PM2 restart/alerting; sweeper catch-up is idempotent by design |
| F17 | Redis down | Infra | Health checks | Availability reads fall to PG; ordering unaffected (write path never needed Redis) |
| F18 | Seller games the system (toggles "out" to dodge low-value orders) | Incentive mismatch at 0% commission | Pattern: toggle-out within seconds of order alarm; toggle-in after | Not a software fix — a conversation, then reliabilityScore, then offboarding. Marketplaces are incentive machines wearing software |
| F19 | COD delivered but commit event missing | Crash between pickup txn and confirm | Nightly reconciler invariant (below) | Backfill commit event; investigate txn boundary |

### 15.2 The meta-lesson

You already learned this in payments: **webhooks lie, networks retry, processes die — so you reconcile.** Inventory earns the same nightly reconciliation the money got.

### 15.3 Nightly reconciler (one BullMQ job, ~150 LOC)

```
for each product:      assert reserved_qty == Σ reservations(status='held')
                       assert expected_qty is null or >= 0
for each delivered order item (last 48h, fulfilled):
                       assert ∃ inventory_event(pickup_committed, orderItemId)
for each held reservation: assert order status ∉ {delivered, cancelled} and not past TTL
mismatches → auto-fix the safe ones (recount reserved from rows), event `admin_adjust`,
             admin alert for the rest. Metric: mismatches/night → should trend to zero.
```

---

## PART 16 — How the Industry Actually Handles This

*(Public knowledge + industry-standard inference; exact internals proprietary — assumptions flagged.)*

**Amazon.** Two regimes. **FBA:** warehouse truth — license-plated units, bin-level tracking, putaway/pick scans, daily cycle counts on velocity-ranked bins. Drift = shrinkage/misplacement, attacked with counting labor. **Merchant-fulfilled (MFN):** *your exact problem.* Amazon's answer after 20 years: inventory feeds/APIs, **max-order-quantity buffers**, and above all **incentive enforcement** — pre-fulfillment cancel rate is a suspension-grade metric, so sellers self-buffer. Even so, MFN phantom-inventory cancellations persist. **Lesson: the richest catalog company on earth couldn't sync un-instrumented sellers; it bounded and punished instead.** Your reliabilityScore + visibility lever is the 20-seller version of the same idea.

**Blinkit / Zepto.** They didn't solve marketplace drift — **they exited the problem** by owning dark stores: inward scans at dock, pick-by-scan, cycle counts on fast movers, app availability driven off owned counts. (Assumption: standard WMS practice; their public engineering material is consistent with it.) Fill rates in the ~98%+ band are achievable *because* inventory is truth. **Lesson: the dark store is the escape hatch from this document, not a competing answer to it** — Part 17.4.

**Swiggy Instamart / BigBasket (early eras).** Both ran partner-store/marketplace inventory phases and migrated to owned/dark-store inventory largely because **fill rate is the retention metric** and partner-store drift capped it (industry chatter puts marketplace-era fill in the ~85–92% band vs 98%+ owned — assumption-flagged, directionally solid). **Lesson: the ceiling you should expect from this engine is real; plan the brand around it (17.1).**

**DoorDash / Uber Eats.** Restaurants: nobody counts inventory — binary **86'ing** (out-of-stock toggle) + **tablet-confirm on every order** (the accept step *is* the inventory check) + refund/substitute rails absorbing misses. DoorDash's convenience/grocery arm goes further: **item-availability prediction models** scoring P(in-stock | store, item, time) from historical miss data, used to rank/suppress items. That is *literally the confidence model of Part 12, validated at massive scale* — they published on it. **Lesson: your architecture (toggle + accept-confirm + prediction + recovery rails) is the proven pattern for un-instrumented merchants; you're implementing the known-good answer, not inventing.**

**Meesho.** No inventory belief at all — supplier confirms availability per order inside a days-long SLA. Works because the delivery promise is days. **Lesson (negative): order-time supplier confirmation as a blocking step is incompatible with a 10–30-min promise** — hence 4.6's embed-don't-block rule.

**Synthesis:** every player either (a) **owns** inventory to make it truth, or (b) treats merchant inventory as a **prediction with buffers, order-time confirmation, penalties, and recovery rails.** Nobody in category (b) has real-time truth. You are (b) today with an eventual (a)-for-the-head. That's Part 17.4.

---

## PART 17 — Challenging Your Architecture

You asked for no agreement. Here it is.

### 17.1 The "one store" promise is the hard mode, and you chose it casually

Hiding sellers means **Bringly owns every miss**. On a visible marketplace, "Sharma Grocery didn't have it" is Sharma's failure; in your unified store it is Bringly lying. You've paired **Blinkit-grade UX promises with kirana-grade inventory truth** — the gap between those is exactly the miss rate, and Part 16 says the realistic ceiling for regime-(b) is roughly 90–95% fill, not 98%. Decide *now* that 93% is acceptable and design for it: proactive apology UX, instant visible refunds, substitute-in-one-tap — make recovery a *feature* customers talk about, because in a 60k town the recovery story travels farther than the miss. The alternative — soften the promise ("30–45 min", "usually available") — costs positioning. Pick deliberately; don't let the miss rate pick for you.

### 17.2 Auto-accept was designed for seller latency and became an inventory policy by accident

Covered in 4.7, repeated here because it's the sharpest flaw in the current system: the 3-minute blind auto-accept is the one place your architecture *manufactures* unverified promises at scale, silently, and attributes the resulting failures to "inventory" instead of to the policy. Gate it on confidence. Measure it forever.

### 17.3 Your margin engine and your inventory engine are the same machine — you've been treating them as two

Your stated profit plan: goods margin + Chirawa Special commission; delivery fees structurally never cover riders. Every failed Special order therefore burns your *only* margin source **and** the flagship brand promise simultaneously. Consequences you haven't drawn: stricter θ for Special sellers (12.3), daily morning confirmation mandatory for made-in-batch items (3.1), cancel-lock post-accept for made-to-order lines (F11), and Special fill-rate as a founder-reviewed weekly number. Inventory confidence is not infra hygiene here — it is the P&L.

### 17.4 Warehouse-first isn't inevitable. Warehouse-*for-the-head* is — and earlier and cheaper than you think

Zipf says your top ~100 SKUs will be ~60–70% of units (assumption; every grocery dataset agrees within noise). Those are precisely the ultra/fast-velocity items where drift is worst, verification fatigue concentrates, and misses cluster. At ~300–500 orders/day, run the math on a **200–400 sq-ft micro-dark-shelf** — Chirawa rent, one stocker — or cheaper still, a **captive consignment corner inside your anchor kirana**: Bringly-purchased stock, physically fenced, counted by you, picked only for online orders. Either flips the majority of order-units into truth-inventory while the marketplace long tail keeps the assortment story. That hybrid (owned head + marketplace tail) is where Part 16's category-(b) players drifted, without exception. **Trigger conditions, so this is a tripwire and not a mood:** town fill-rate <93% driven by head SKUs for 4 consecutive weeks, or morning-card completion <50% across sellers. When either fires, buy shelves, don't tune τ.

### 17.5 Current `stockQty` semantics quietly poison everything downstream

Decrement-at-placement (today) makes the stored number "shelf minus promises" — neither belief nor commitment. The confidence model, the decay math, and the EWMA all assume `expected_qty` means *believed shelf stock*; feed them the hybrid number and the whole belief layer computes garbage with dignity. D4/D5 are therefore not refactors-when-convenient; they're the foundation pour. Do them first (13.1) and run audits A-1/A-2 before migration, because if cancels don't re-increment today you're *already* leaking.

### 17.6 Smaller but real

- **MAX_SHOPS was implicit; make it law.** Every extra pickup ≈ +4–7 min and +1 failure surface. 2 default, 3 hard, in config, enforced in resolver — or the ETA promise erodes one "just add a third shop" at a time.
- **Master-catalog moderation is your next bottleneck, not inventory.** At 100 sellers, needs_review queues and barcode collisions swamp a REST-only admin. Budget ops tooling in the 20→100 jump (Part 14).
- **The prompt's own framing was the biggest flaw I found.** "Millions of updates, thousands of concurrent orders" — designing for that today buys Kafka, Redis-truth, and sharding complexity that a 60k-person town will never exercise, paid for in the only currency you can't raise more of: solo-founder time. Big-system *correctness*, small-system *capacity*. This entire document is that sentence, applied.

---

## Appendix A — API deltas (on top of existing surface)

```
PATCH /catalog/products/:id/verify        seller   {state: 'have'|'low'|'out', qty?}  → bucket/count event
GET   /sellers/me/morning-card            seller   today's ≤N verification items
POST  /orders/:id/accept                  seller   EXTEND body: {lineOverrides?: [{orderItemId, availableQty}]}
POST  /delivery/orders/:id/pickup         rider    EXTEND body: {lines: [{orderItemId, found: n}]}  → commit/miss per line
GET   /admin/inventory/health             admin    reconciler results, confidence histogram, auto-accept miss-rate, fill-rate
```

## Appendix B — Metrics that matter (weekly founder review)

`fill_rate` (order-weighted and Special-only) · `rider_miss_rate` by seller · `auto_accepted_miss_rate` (the 17.2 canary) · `morning_card_completion` · `confidence_calibration` (12.5, monthly) · `reconciler_mismatches` (→0) · `avg_shops_per_group` (→ ≤1.3).

---

*End of EDD. Build order: D4/D5 foundation → Layer 1 gates → S2 chips → morning card → reconciler. Everything else is tuning.*