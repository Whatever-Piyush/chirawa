# Seller Sprint 5 — Recovery Orders: FOUNDATION Architecture Specification

**Date:** 2026-07-16 · **Author:** Principal Product Architect · **Status:** AUTHORITATIVE — ratifies the as-built Phase A foundation.
**Nature of this document:** The Recovery Foundation **already exists in code** as *Sprint 5 Phase A* (`apps/api/src/modules/recovery/`, migration `20260707000000_seller_sprint5_phaseA_recovery`). That code repeatedly cites an "Architecture §10–§12, §14, §17, §21, §22" specification **that was never persisted to the repo** (previously flagged MISSING FROM SOURCE ARTIFACT). This document **is** that specification: it documents and formalizes the implemented foundation exactly as built, reconciles it against the Sprint 5 business objective, and resolves the code's `§NN` citations. It does **not** redesign the foundation.
**Verification (this session, working tree `eng/p0-hardening`):** the 4 tables + 2 enums, the state machine (`recovery.constants.ts`), the service (`recovery.service.ts`, one uncommitted type-annotation diff), the 6 admin routes, and all FK/back-relations were read line-by-line. Confirmed: **zero recovery tests**, **zero worker/scheduler wiring** (no timeout sweep), module referenced only by its own files + `app.ts` + Prisma back-relations.

**Section-anchor map (resolves the code's citations):** §10 ⇒ this doc §9 (Internal Services) · §11 ⇒ §6 (Data Model) + §7 (Numbering) + the fulfillment vocabulary in §6.5 · §12 ⇒ §8 (State Machine) · §14 ⇒ §9 `askedPartnerShopIds` (partner de-dup) · §17 ⇒ §6.4 (audit events) · §21 ⇒ §11 (Transaction Boundaries) · §22 ⇒ §8.4 (parent-order-cancelled-mid-recovery). Builders may treat those anchors as satisfied by this document.

---

## 1. Executive Summary

When a seller cannot fulfill an item, Bringly's current behaviour is to **refund that line immediately** (rider-at-pickup path: `orders.service.riderReportItemUnavailable`). The Recovery Orders feature replaces "refund first" with "**recover first, refund only if recovery is exhausted**": the platform tries to source the missing line(s) from another curated partner shop, and the customer keeps seeing **one order** throughout — never a second order number.

The full feature is large (seller intake, partner selection, timed offers, order repair, settlement, customer messaging). **This foundation delivers only the durable spine that everything else stands on**: a per-order **Recovery Need** with a race-safe number, the lines it claims, the sequential **Offers** dispatched to partner shops, a guarded **state machine**, and an **immutable audit log** — each written atomically. It deliberately ships **no** orchestration: no automatic trigger, no partner-picking, no timeout enforcement, no reservations, no settlement, no notifications, and it **never mutates the order or its items**. Those are later Sprint 5 phases (S5.1+).

The foundation is **internal and admin-only** (6 endpoints under `/api/v1/recovery`), reuses the existing Order / OrderItem / Shop entities by reference (four small new tables, all additive), and mirrors the proven `order-status.ts` state-machine pattern rather than inventing a new one. It is built for Chirawa's scale (a curated marketplace, ~5 trusted partners per category), not a generic marketplace — so it optimizes for correctness and auditability over throughput.

**Status of the foundation code:** implemented, typecheck-green, **untested** (no unit/integration tests exist yet — see §16). This spec's job is to freeze the design and define the Definition of Done so a Reviewer/Builder can close the test gap and later phases can build on a ratified base.

## 2. Sprint Goal

Deliver the **durable recovery ledger and state machine** that later Sprint 5 phases orchestrate:

> Given a parent order with one or more unavailable lines, an operator (later: the system) can **open a Recovery Need** with a unique, stable recovery number; **record sequential offers** to partner shops with a decision window; **resolve** each offer's outcome write-once; and **drive the Need through a guarded lifecycle** to a terminal state — with **every step recorded as an immutable audit event**, every write **atomic**, and **no impact on the customer-facing order** (the customer continues to see exactly one order).

Success = the primitives exist, are correct under concurrency, are fully auditable, and are covered by tests — with a clean, documented seam for S5.1+ to add automatic intake, partner selection, timeout enforcement, order repair, and settlement **without reopening the foundation**.

## 3. Scope (this foundation, as built)

1. **Four additive tables + two enums** (migration `20260707000000_seller_sprint5_phaseA_recovery`) — see §6.
2. **Recovery numbering** — `<parentOrderId prefix>-<sequence>`, unique per parent order — see §7.
3. **Recovery Need state machine** — 10 states, guarded transitions, 3 terminal states — see §8.
4. **Recovery service primitives** (`recovery.service.ts`): `openNeed`, `transitionNeed`, `recordOffer`, `setOfferOutcome`, `getNeed`, `listNeeds`, `askedPartnerShopIds` — see §9.
5. **Six admin-only internal endpoints** under `/api/v1/recovery` — see §10.
6. **Immutable audit event log** — 7 event types emitted across the primitives — see §6.4.
7. **The fulfillment-status vocabulary** (`recovering`, `recovered_elsewhere`) *defined* for later intake — see §6.5. **Defined only; not applied to any order item in this phase.**

## 4. Out of Scope (explicitly deferred — do NOT build in the foundation)

Each item below is intentionally absent; the code comments name them. They are later Sprint 5 phases and must not leak into the foundation:

- **Automatic trigger / seller intake (S5.6):** nothing auto-creates a Need when a seller reports an item unavailable. Today `openNeed` is reachable only via the admin API. The existing rider-at-pickup refund flow (`riderReportItemUnavailable`) is **untouched**.
- **Partner selection / planner (S5.4):** the foundation *records* an offer to a `partnerShopId` chosen elsewhere; it does **not** decide *which* partner to ask, does not encode "trust", category matching, ranking, or distance. It provides `askedPartnerShopIds` for de-dup only.
- **Timeout enforcement / scheduler:** the offer window (`expiresAt`, and the need's `deadlineAt`) is *recorded intent*, **not enforced**. No sweep flips a pending offer to `timed_out`. The `timed_out` outcome must be supplied externally (admin today; a scheduled job later). There is **no worker/BullMQ wiring**.
- **Partner/seller/customer-facing endpoints & notifications:** no partner accept/reject screen, no push/SMS, no customer status surface. The partner "Accept? Reject?" UX and the "45-second" countdown are later phases.
- **Order repair / materialization (S5.6+):** the foundation **never mutates** `orders`, `order_items`, inventory, or holds/reservations. "Original Order #39 is repaired" is **not** implemented here — the customer's single-order view is *preserved by construction* (no second order is ever created), but the actual re-sourcing of the line into #39 is a later phase.
- **Reservations / stock holds, settlement / payout attribution, refund execution:** no tables, no logic. `exhausted → refunded` is a state transition only; it triggers **no** money movement in the foundation.
- **Human order numbering:** orders are UUID-only today; the recovery *display base* is a provisional UUID prefix (§7). A real order-number scheme is a future swap of one function.

## 5. Business Rules

**Rules the foundation enforces today:**
1. A Recovery Need belongs to exactly one **parent order** and claims **≥1 line** (`order_items` of that order); opening with zero lines is rejected.
2. Every Need gets a **unique recovery number** per parent order, assigned once at creation and never changed (§7).
3. A Need advances **only** through legal transitions (§8); illegal jumps are rejected (409) before any write.
4. **At most one live (pending) offer per Need at a time** — strictly sequential dispatch (DB-enforced partial unique index). A partner may be asked at most once per Need (de-dup via offers).
5. An offer outcome is **write-once**: `pending → accepted | rejected | timed_out`. A second resolution is rejected (409) — so a late timeout can **never** override an acceptance (**single-winner**).
6. `accepted` commits the Need toward fulfilment; `rejected`/`timed_out` return the Need to `searching` to try the next partner.
7. **Every** mutation emits an **immutable audit event** stamped with the actor (or system) and is written **atomically** with the state change (§11).
8. The **customer always sees one order**: recovery is internal metadata referencing the parent order; the foundation creates **no** customer-facing entity and mutates **no** order.

**Rules reconciled from the Sprint 5 business brief (divergences flagged — decisions, not defects):**
- **"45-second timeout"** → the foundation stores a **parameterized** offer window (`windowSeconds`, 1–3600). 45 s is a *value a future dispatcher supplies*, **not** a foundation constant. **Decision:** keep it parameterized; do not hardcode 45.
- **"#39 → #39-1 → #39-2"** → real orders are UUIDs; there is no human "#39". The **sequence suffix** (1, 2, …) is the authoritative, DB-guaranteed part; the base is a UUID prefix today (§7). The illustrative "#39" is a future human-number swap.
- **"trusted partner seller per category" (~5/category)** → **no trust/partner-eligibility data model exists in the foundation.** An offer can reference any `Shop`. Trust, category eligibility, and ranking are the **S5.4 planner's** concern. → **MISSING FROM SOURCE ARTIFACT at the data-model level; deliberately deferred.** Do not add a trust table to the foundation.
- **"Server automatically creates Recovery Order"** → the foundation exposes the *primitive* (`openNeed`); the *automatic* creation on seller intake is **S5.6**.
- **"Jain Mart receives Accept? Reject?"** → the foundation records the **outcome** (`setOfferOutcome`); partner notification, the partner-facing accept/reject action, and the countdown are later phases.

## 6. Recovery Data Model

**Reuse-first.** The foundation adds **no** columns to `orders`/`order_items`/`shops` and duplicates **no** order data. It references existing entities by FK:
- `RecoveryNeed.parentOrderId` → `orders(id)` `ON DELETE RESTRICT`
- `RecoveryNeedLine.orderItemId` → `order_items(id)` `ON DELETE RESTRICT`
- `RecoveryOffer.partnerShopId` → `shops(id)` `ON DELETE RESTRICT`
Back-relations added (relation metadata only, non-breaking): `OrderItem.recoveryLines`, `Shop.recoveryOffers`, `Order.` (implicit via `RecoveryNeed.parentOrder`).

**Four new tables — each justified; none speculative:**

### 6.1 `recovery_needs` — *why:* the unit of recovery + its number + its lifecycle state
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `parent_order_id` | UUID FK→orders RESTRICT | the one order this recovers for |
| `sequence` | Int | 1-based recovery suffix per parent order |
| `number` | VarChar(40) | display string `<base>-<sequence>`, fixed at creation |
| `state` | `RecoveryNeedState` | default `open` |
| `deadline_at` | Timestamp? | the current offer's `expiresAt`; null unless `state=offered` |
| `created_at`/`updated_at` | Timestamp | |
Indexes: **UNIQUE(`parent_order_id`,`sequence`)** (numbering guard), (`parent_order_id`), (`state`).

### 6.2 `recovery_need_lines` — *why:* which order lines this Need is recovering (N per Need)
`id` PK · `need_id` FK→needs CASCADE · `order_item_id` FK→order_items RESTRICT · `quantity` Int. Index (`need_id`). A Need can claim several lines; a line is referenced (not moved) — the order is untouched.

### 6.3 `recovery_offers` — *why:* the sequential partner-dispatch ledger with the "one live offer" guarantee
`id` PK · `need_id` FK→needs CASCADE · `partner_shop_id` FK→shops RESTRICT · `offered_at` · `expires_at` · `outcome` (`RecoveryOfferOutcome` default `pending`) · `decided_at?`. Indexes: (`need_id`,`offered_at`), and the **partial unique index** `recovery_offers_one_pending_per_need ON (need_id) WHERE outcome='pending'` — authored in raw SQL because Prisma cannot express a filtered index; it enforces at most one live offer per Need at the DB layer.

### 6.4 `recovery_events` — *why:* immutable, append-only audit of every recovery action (§17)
`id` PK · `need_id` FK→needs CASCADE · `offer_id?` FK→offers SET NULL · `type` VarChar(40) · `actor_id?` UUID · `actor_role?` VarChar(20) · `metadata?` JSONB · `created_at`. Index (`need_id`,`created_at`). **Event vocabulary (7):** `line_claimed`, `need_opened`, `state_changed`, `offer_sent`, `offer_accepted`, `offer_rejected`, `offer_timed_out`. Later phases add hold/materialization/route/attribution/reconciliation/refund events — **not defined here**. Events are never updated or deleted.

### 6.5 Enums & the fulfillment vocabulary
- `RecoveryNeedState`: `open, searching, offered, accepted, ready, picked_up, fulfilled, exhausted, refunded, cancelled`.
- `RecoveryOfferOutcome`: `pending, accepted, rejected, timed_out`.
- **Fulfillment-status vocabulary (`recovery.constants.ts` `FulfillmentStatus`)**: extends the existing `OrderItem.fulfillmentStatus` values (`fulfilled`, `unavailable_refunded`) with **`recovering`** and **`recovered_elsewhere`**. **Defined in Phase A so the domain vocabulary exists; NOT applied to any order item here** (the intake that sets these is S5.6). No migration changes `order_items` for this.

## 7. Recovery Numbering

**Format:** `number = "<displayBase(parentOrderId)>-<sequence>"`, e.g. an order whose UUID begins `a1b2c3d4…` yields `a1b2c3d4-1`, then `a1b2c3d4-2`. `displayBase` = the first 8 hex chars of the parent order UUID (there is no human order number yet; swapping `displayBase` is the entire future upgrade path).

**`sequence`** is a **1-based counter per parent order**, monotonic and never reused — even a `cancelled` Need keeps its sequence, so numbers are stable for audit and never recycled.

**Uniqueness guarantee (two layers):**
1. **DB truth:** `@@unique([parentOrderId, sequence])`. Two Needs on the same order can never share a suffix.
2. **Service assignment:** `sequence = count(needs for this order) + 1`, computed outside the transaction, then inserted. Because the count is racy, the unique index is the real guard: on a `P2002` collision the service **re-counts and retries** (budget `MAX_SEQUENCE_RETRIES = 5`). Distinct parent orders never contend (different key space).

**Guarantee statement:** *For any parent order, the set of recovery numbers is `{base-1, base-2, …, base-n}` with no gaps from successful creations, no duplicates, and no reuse — enforced by the DB and tolerant of concurrent creation up to 5 simultaneous collisions on the same order* (far beyond Chirawa's realistic concurrency; Needs are opened sequentially by the orchestrator).

## 8. Recovery State Machine

Mirrors the proven `order-status.ts` pattern (transition table + guard + atomic write + audit) — **one** justified new state machine, not a new *pattern*.

### 8.1 States (10)
`open` (created, lines claimed) · `searching` (looking for a partner) · `offered` (a live offer is out) · `accepted` (a partner took it) · `ready` (partner prepared it) · `picked_up` (rider has it) · `fulfilled` (delivered — success terminal) · `exhausted` (no partner could fulfill) · `refunded` (customer refunded after exhaustion — terminal) · `cancelled` (parent order cancelled mid-recovery — terminal).

### 8.2 Transitions (`NEED_TRANSITIONS`)
```
open      → searching | cancelled
searching → offered | exhausted | cancelled
offered   → accepted | searching | exhausted | cancelled
accepted  → ready | cancelled
ready     → picked_up | cancelled
picked_up → fulfilled | cancelled
exhausted → refunded
fulfilled → ∅   refunded → ∅   cancelled → ∅
```
- **Retry loop:** `offered → searching` (on reject/timeout) → `offered` (next partner). This is the "ask the next of ~5 partners" cycle.
- **Give-up path:** `searching|offered → exhausted → refunded` (tried everyone → refund the customer). Refund *execution* is a later phase; this is the state record.
- **Success path:** `accepted → ready → picked_up → fulfilled`.

### 8.3 Terminal states & illegal transitions
- **Terminal (no outgoing):** `fulfilled`, `refunded`, `cancelled`.
- **Illegal** = any pair not in the table (e.g. `open → accepted`, `searching → ready`, `fulfilled → *`, `exhausted → cancelled`). `canTransitionNeed` gates every write; `transitionNeed`/`recordOffer`/`setOfferOutcome` throw **409 ConflictError** before touching the row.

### 8.4 Entry-path constraints & offer coupling (important)
- **`offered` and `accepted` are reachable ONLY via the offer endpoints** — the raw `transitionNeed` schema deliberately excludes them (they must carry an offer + deadline to be consistent). `recordOffer` performs `searching → offered`; `setOfferOutcome` performs the coupled move: `accepted`⇒`offered → accepted`, `rejected`/`timed_out`⇒`offered → searching`.
- **`deadlineAt`** is set to the offer's `expiresAt` on `offered`, and cleared on outcome.
- **§22 (parent order cancelled mid-recovery):** `cancelled` is reachable from **every** non-terminal state, so a Need is always closable when its parent order dies. (The *trigger* that calls this on order cancellation is a later phase; the transition exists now.)

## 9. Internal Services

One module, one factory `createRecoveryService(prisma)`; all business logic here (routes only parse+delegate). Each mutating call runs in a single `prisma.$transaction`.

| Primitive | Responsibility | Emits |
|---|---|---|
| `openNeed(input, actor)` | Validate ≥1 line; assign race-safe `sequence`/`number` (count+P2002 retry); create Need (`open`) + lines. **Does not touch the order/items.** | `line_claimed`×N, `need_opened` |
| `transitionNeed(needId, to, actor)` | Guarded operator/orchestrator transition (`searching, ready, picked_up, fulfilled, exhausted, refunded, cancelled`); 409 on illegal. | `state_changed` |
| `recordOffer(needId, {partnerShopId, windowSeconds}, actor)` | Require `searching`; create pending offer with TTL; set `deadlineAt`; `searching→offered`. Partial-unique ⇒ 409 on a second live offer. | `offer_sent`, `state_changed` |
| `setOfferOutcome(offerId, outcome, actor)` | Write-once (409 if already decided); drive coupled Need transition; clear `deadlineAt`. Single-winner. | `offer_accepted`/`offer_rejected`/`offer_timed_out`, `state_changed` |
| `getNeed(needId)` | Read Need + lines + offers + events (audit view). | — |
| `listNeeds({parentOrderId?, state?})` | Filtered list (needs + lines + offers), newest first. | — |
| `askedPartnerShopIds(needId)` | Distinct partner ids already offered — **the seam the S5.4 planner uses to never re-ask a partner (§14).** | — |

## 10. Internal APIs

All under `/api/v1/recovery`, all behind `authenticate + requireRole('admin')`. Thin handlers; Zod-validated; UUIDs validated. **No seller/rider/customer/partner surface exists in Phase A.**

| Method + Path | Body / Query | Action |
|---|---|---|
| `POST /needs` | `{ parentOrderId, lines:[{orderItemId, quantity≥1}]≥1 }` | openNeed → 201 |
| `GET /needs` | `?parentOrderId?&state?` | listNeeds |
| `GET /needs/:id` | — | getNeed (lines+offers+events) |
| `POST /needs/:id/transition` | `{ to ∈ searching\|ready\|picked_up\|fulfilled\|exhausted\|refunded\|cancelled }` | transitionNeed |
| `POST /needs/:id/offers` | `{ partnerShopId, windowSeconds 1..3600 }` | recordOffer → 201 |
| `POST /offers/:id/outcome` | `{ outcome ∈ accepted\|rejected\|timed_out }` | setOfferOutcome |

Note the schema deliberately **excludes `open`/`offered`/`accepted`** from the raw transition endpoint (§8.4). Errors use the shared family: `ValidationError` (400), `NotFoundError` (404), `ConflictError` (409).

## 11. Transaction Boundaries (§21)

- **Every mutation is one `prisma.$transaction`.** The state/row change and **all** its audit events commit together or not at all — there is no window where a Need advanced but its event is missing (or vice-versa).
- `openNeed`: Need + all lines + all `line_claimed` events + `need_opened` in one txn (retried as a whole on numbering collision).
- `recordOffer`: offer insert + Need update (`offered`, `deadlineAt`) + `offer_sent` + `state_changed` in one txn.
- `setOfferOutcome`: offer update (outcome, `decidedAt`) + Need update (next state, clear `deadlineAt`) + outcome event + `state_changed` in one txn.
- `transitionNeed`: Need update + `state_changed` in one txn.
- **Boundary with the rest of the system:** the foundation's transactions touch **only** recovery tables. It never opens a transaction that also writes `orders`/`order_items`/`payments`/inventory — so it cannot deadlock against or corrupt the order pipeline. Cross-domain atomicity (repair + recovery in one txn) is a later-phase concern, to be designed when intake/materialization lands.

## 12. Failure Handling

| Failure | Handling |
|---|---|
| Numbering race (concurrent needs, same order) | `P2002` on the unique index → re-count + retry, budget 5; exhaustion propagates the error (never a duplicate/silent wrong number). |
| Second live offer on a Need | Partial-unique `P2002` → **409** "An offer is already outstanding for this need". |
| Double-resolving an offer (e.g. a late timeout after acceptance) | Write-once check → **409** "Offer already <outcome>". **Single-winner guaranteed.** |
| Illegal state transition | `canTransitionNeed` → **409** before any write. |
| Missing Need/offer | **404**. |
| Empty `lines` on open | **400** ValidationError. |
| Referenced order/line/shop deleted | FK `RESTRICT` blocks deletion of a referenced order/line/shop while a Need/line/offer references it — the audit trail can never dangle. (`recovery_events.offer_id` is `SET NULL` so deleting an offer keeps its events.) |
| **Offer window expiry** | **NOT handled in the foundation.** `expiresAt`/`deadlineAt` are recorded but nothing flips a stale pending offer to `timed_out`. A later scheduled sweep (query `state=offered AND deadlineAt < now`) or the admin must drive it. **This is the single most important "recorded-but-not-enforced" gap — see §Risks.** |
| Partner never responds | Same as above — no automatic timeout in the foundation. |

## 13. Concurrency Strategy

- **Numbering:** DB unique index is truth; optimistic count-then-insert with bounded retry. No locks held.
- **Sequential dispatch:** the partial unique index makes "one live offer per Need" a DB invariant — two concurrent `recordOffer` calls cannot both create a pending offer; the loser gets a 409.
- **Single-winner outcome:** `outcome != 'pending'` write-once check inside the txn; the second writer sees the committed outcome and 409s. Combined with the coupled-transition guard, an accepted offer cannot be un-accepted by a racing timeout.
- **State guards run inside the transaction** that performs the write, so a check-then-act race collapses to a single serialized transition (Postgres row-level locking on the Need update).
- **Scale reality:** Chirawa, ~5 partners/category, Needs opened sequentially by one orchestrator — real concurrency is low; the guarantees above are correctness insurance, not throughput engineering.

## 14. Security

- **Admin-only.** All six endpoints require a verified JWT with `role=admin`. There is no seller/rider/customer/partner access in Phase A (those actors' scoped endpoints and ownership checks arrive with their phases).
- **Actor stamping:** every event records `actor_id` + `actor_role` (or null for future system actions) — a complete, immutable who-did-what trail.
- **No PII in recovery tables:** they store only ids (order, order-item, shop, actor) + quantities + timestamps + small metadata; no names, addresses, phones, or money. Customer PII stays in `orders` (unchanged).
- **Referential integrity:** FK `RESTRICT` on order/line/shop prevents orphaned or forged references; append-only events are never mutated.
- **No secrets, no new env, no external calls** in the foundation.

## 15. Performance

- **Indexes cover every access path:** needs by `parent_order_id` and by `state`; lines by `need_id`; offers by `(need_id, offered_at)` + the partial-unique; events by `(need_id, created_at)`.
- **`getNeed`/`listNeeds`** fetch bounded sets (one order's needs; a Need's lines/offers/events — all small). No N+1: relations are `include`d in single queries.
- **Writes** are a handful of inserts/updates per call inside one txn — negligible at Chirawa volume. The numbering `count` is index-backed and cheap.
- **No background load** (no sweep, no queue) in the foundation. Future timeout enforcement should be a single indexed query (`state='offered' AND deadline_at < now`) on a low cadence — the `state` and `deadline_at` columns already support it.

## 16. Testing Requirements

**Current state: ZERO recovery tests exist** (`apps/api/src/modules/recovery/__tests__/` absent; repo-wide grep confirms none). The module is presently exercised only by `tsc`. This is the foundation's largest quality gap and a **DoD blocker**. Required coverage:

**Unit (pure) — `recovery.constants.ts`:**
1. `canTransitionNeed`: every legal edge allowed; a representative illegal set rejected (`open→accepted`, `searching→ready`, `fulfilled→*`, `exhausted→cancelled`, terminal→anything).
2. `OFFER_OUTCOME_TO_NEED_STATE` / `OFFER_OUTCOME_EVENT` correctness.
3. Terminal-state set is exactly `{fulfilled, refunded, cancelled}`.

**Service (with a test Prisma / transaction mock) — `recovery.service.ts`:**
4. `openNeed`: creates Need `open` + lines; emits `line_claimed`×N + `need_opened`; rejects empty lines; **numbering** — sequential suffixes, and P2002→retry yields the next free suffix (simulate one collision); does **not** write to orders/items.
5. `recordOffer`: requires `searching`; sets `offered` + `deadlineAt`=`expiresAt`; emits `offer_sent`+`state_changed`; **second live offer ⇒ 409** (partial-unique path).
6. `setOfferOutcome`: write-once (**second resolution ⇒ 409**); `accepted`⇒Need `accepted`; `rejected`/`timed_out`⇒Need `searching` + `deadlineAt` cleared; **single-winner** (a `timed_out` after `accepted` cannot flip it).
7. `transitionNeed`: legal moves ok + `state_changed`; illegal ⇒ 409; `cancelled` reachable from each non-terminal (§22).
8. `askedPartnerShopIds`: distinct partner ids across multiple offers.
9. **Atomicity:** an induced failure mid-primitive rolls back both the row change and its events (no partial state).

**Integration (real Postgres, e.g. in the smoke/CI DB):**
10. The full happy path via the admin API: open → transition `searching` → offer → outcome `rejected` → offer(next partner) → outcome `accepted` → `ready` → `picked_up` → `fulfilled`, asserting the event log and that `orders`/`order_items` are byte-for-byte unchanged.
11. The give-up path: `searching → exhausted → refunded`.
12. FK `RESTRICT` behaviour (cannot delete a referenced order/line/shop).

**Regression:** the existing suite (per memory, 564/564) must stay green — the foundation touches no existing module logic.

## 17. Definition of Done

The Recovery **Foundation** is done when:
1. The 4 tables + 2 enums + partial-unique index are present via the additive migration; `prisma validate` clean; **no existing table altered** (verified).
2. The state machine, service primitives, and 6 admin endpoints behave exactly as §8–§10; typecheck green across workspaces.
3. **The §16 test suite exists and passes** (unit + service + the two integration paths), and the pre-existing suite stays green. *(This is currently unmet — no recovery tests exist.)*
4. Every mutating primitive is proven atomic (row + events commit together) and the three concurrency guarantees (numbering, one-pending-per-need, single-winner outcome) are test-pinned.
5. The audit log emits all 7 event types on the right transitions, actor-stamped, append-only.
6. This spec is committed (resolving the code's `Architecture §NN` citations) and the deferred list (§4) is agreed by the founder as the S5.1+ backlog — explicitly including that **the customer-facing repair and the offer-timeout enforcement are NOT in the foundation**.
7. Reviewer sign-off that the foundation is a clean seam: S5.1+ can add intake, planner, timeout sweep, materialization, and settlement **without schema rework** of these four tables (additive only).

---
---

# ARCHITECT → REVIEWER HANDOFF PACKAGE

*Self-contained. Assumes the Reviewer has never seen Bringly or this feature.*

## Project Context
**Bringly** (repo `chirawa`, `~/Batman/chirawa`, branch `eng/p0-hardening`) is a production-grade hyperlocal commerce platform for **Chirawa, Rajasthan** (~80k people, 3 km radius): a Fastify 4 + Prisma 5 (PostgreSQL 15) + Redis 7 + BullMQ + Socket.io **modular-monolith API** and three Expo SDK 54 apps (customer/seller/rider), sharing `packages/{types,api-client,i18n}` (Hindi+English mandatory). The marketplace is launch-hardened; a Food Module and Seller Sprints 0–4 are complete. **House rules:** integer paise; **one CAS/guarded enforcement point per invariant**; fail-closed in production; **additive, guarded migrations**; evidence over assertion; Conventional Commits; never touch `.env`; **push to `main` auto-deploys** (merges are deliberate). Baseline: `docs/PROJECT_BASELINE.md`. Order lifecycle (`order-status.ts`): `pending_payment→paid→confirmed→preparing→ready_for_pickup→picked_up→out_for_delivery→delivered` (+`cancelled`), enforced by a single guarded, CAS, audited transition function — the pattern the recovery state machine mirrors.

## Business Model
Curated single-town marketplace: local shops list products; Bringly delivers; **0% commission**, COD + (gated) UPI. Because it is curated, there are only **~5 trusted partner shops per category** — the premise the whole recovery design rests on (recover from a peer instead of refunding).

## Sprint Context
**Seller Sprint 5 — Recovery Orders.** Objective: when a seller can't fulfil an item, **don't refund immediately — recover the missing line(s) from a trusted partner shop, and keep the customer on ONE order.** Illustratively: Order #39 (Milk/Butter/Bread) → Gupta Kirana lacks Butter → a recovery is created for Butter ×1 → offered to a partner (e.g. Jain Mart) with Accept/Reject and a short window → on accept, the original order is repaired and the customer never sees a second order. **This handoff covers only the FOUNDATION** — the durable ledger + state machine — **which already exists in code as Phase A**; the Reviewer's job is to review/ratify it and close its test gap, not to review the full feature.

## Objectives (foundation)
Provide correct, atomic, fully-audited primitives — **Need** (numbered, stateful), **Lines**, sequential **Offers**, guarded **state machine**, immutable **events** — that later phases orchestrate, with a clean additive seam and no impact on the customer order.

## Scope
The 4 tables + 2 enums (migration `20260707000000_seller_sprint5_phaseA_recovery`), `recovery.constants.ts` (state machine + events + fulfillment vocab), `recovery.service.ts` (7 primitives), `recovery.schema.ts` (Zod), `recovery.routes.ts` (6 admin endpoints), `app.ts` registration at `/api/v1/recovery`, and the Prisma back-relations on `OrderItem`/`Shop`/`Order`. Numbering, state machine, audit, sequential dispatch, single-winner outcome. **Plus the required-but-missing test suite (§16).**

## Out of Scope
Automatic trigger/seller intake (S5.6), partner selection/trust/ranking (S5.4), **offer-timeout enforcement/scheduler** (no worker wiring today), partner/seller/customer endpoints & notifications, **order repair/materialization** (no order/item mutation — the customer's single-order view is preserved by *not creating a second order*, but re-sourcing the line into #39 is later), reservations/holds, settlement/refund execution, human order numbers. The existing rider-at-pickup refund flow (`orders.service.riderReportItemUnavailable`) is untouched.

## Business Rules
One parent order + ≥1 line per Need; unique immutable recovery number per order; guarded transitions only; **≤1 live offer per Need** (DB partial-unique); **write-once offer outcome / single-winner**; accepted⇒commit, reject/timeout⇒back to searching; every step is an immutable, atomic audit event; **customer always sees one order**. Reconciliations: "45 s"⇒parameterized `windowSeconds`; "#39-1"⇒UUID-prefix+sequence; "trusted partner/category"⇒**not in the data model, deferred to the planner (MISSING FROM SOURCE ARTIFACT)**; "auto-create"/"partner accept-reject/notify/timeout"⇒later phases.

## Design Decisions
1. **Ratify, don't redesign** — Phase A exists; this spec formalizes it and resolves the code's `Architecture §NN` citations (map in the spec header).
2. **Reuse over new** — reference `orders`/`order_items`/`shops` by FK; add only 4 small tables; **mirror `order-status.ts`** (guard+CAS+audit) rather than invent a new pattern → the one new state machine is justified by a genuinely distinct lifecycle.
3. **Foundation = ledger, not orchestrator** — no queues/timeouts/planner/notifications/order-mutation; all deferred and named in code.
4. **DB-enforced invariants** — unique(order,sequence); partial-unique one-pending-per-need; write-once outcome; FK RESTRICT — correctness lives in the database, not just the service.
5. **Admin-only internal surface** — other actors get scoped endpoints with their phases.
6. **Parameterized, config-first** — window is per-offer, not a hardcoded 45.

## Data Model Summary
`recovery_needs`(parent_order_id→orders RESTRICT, sequence, number, state, deadline_at; **UNIQUE(parent_order_id,sequence)**, idx state) · `recovery_need_lines`(need_id CASCADE, order_item_id→order_items RESTRICT, quantity) · `recovery_offers`(need_id CASCADE, partner_shop_id→shops RESTRICT, expires_at, outcome, decided_at; **partial-unique one-pending-per-need**) · `recovery_events`(need_id CASCADE, offer_id SET NULL, type, actor_id/role, metadata JSONB — append-only). Enums `RecoveryNeedState`(10), `RecoveryOfferOutcome`(4). No column added to any existing table; `OrderItem.fulfillmentStatus` gains vocabulary (`recovering`, `recovered_elsewhere`) **defined but unused in Phase A**.

## APIs
6 admin-only endpoints under `/api/v1/recovery`: `POST /needs`, `GET /needs`, `GET /needs/:id`, `POST /needs/:id/transition`, `POST /needs/:id/offers`, `POST /offers/:id/outcome`. Zod-validated; the transition endpoint excludes `open`/`offered`/`accepted` (offer-driven states go through the offer endpoints).

## State Machines
`RecoveryNeedState`: `open→{searching,cancelled}`, `searching→{offered,exhausted,cancelled}`, `offered→{accepted,searching,exhausted,cancelled}`, `accepted→{ready,cancelled}`, `ready→{picked_up,cancelled}`, `picked_up→{fulfilled,cancelled}`, `exhausted→{refunded}`; terminal `{fulfilled,refunded,cancelled}`. `cancelled` from any non-terminal (§22). Offer coupling: `recordOffer` does `searching→offered`; `setOfferOutcome` does `offered→accepted` (accept) or `offered→searching` (reject/timeout). Retry loop offered⇄searching; give-up searching/offered→exhausted→refunded.

## Transaction Rules
Every mutating primitive = one `prisma.$transaction` where the row change **and** its audit event(s) commit atomically. Transactions touch **only** recovery tables (no cross-writes to orders/payments) — no deadlock surface against the order pipeline. `openNeed` retries the whole txn on a numbering collision.

## Constraints
Chirawa scale / curated (~5 partners/category); additive-only migration; reuse existing entities; minimize new tables/APIs/services/state machines; no over-engineering; admin-only; no PII/money in recovery tables; no external calls/secrets/env.

## Dependencies
Existing `orders`, `order_items`, `shops`, `SellerProfile`; `authenticate`/`requireRole`; shared errors (`ValidationError`/`NotFoundError`/`ConflictError`); Prisma 5 (raw-SQL partial index — Prisma can't express it, so it lives in the migration and the service tolerates the P2002); `app.ts` registration. **No** BullMQ/worker/Redis/notification/payment dependency in the foundation.

## Files Expected To Change
For the foundation itself: **already present** — `apps/api/prisma/migrations/20260707000000_seller_sprint5_phaseA_recovery/`, `apps/api/prisma/schema.prisma` (Recovery models + back-relations), `apps/api/src/modules/recovery/{constants,schema,routes,service}.ts`, `apps/api/src/app.ts` (registration). **To satisfy DoD (net-new, additive):** `apps/api/src/modules/recovery/__tests__/*` (the §16 suite); this spec `docs/RECOVERY_FOUNDATION_SPEC.md`. A Builder should need to touch **nothing else** — anything requiring an `orders`/`order_items`/`shops` mutation is out of the foundation and returns to the Architect.

## Edge Cases
Concurrent needs same order (numbering P2002→retry); second live offer (409); double-resolved offer / late-timeout-after-accept (409, single-winner); illegal transition (409); empty lines (400); parent order cancelled mid-recovery (`cancelled` from any non-terminal — trigger is later); referenced order/line/shop deletion (FK RESTRICT); **offer window expiry with no partner response (NOT enforced — recorded only)**; multi-line need; sequence never reused after cancel.

## Risks
1. **Offer timeout is recorded, not enforced** — without the later sweep, a `pending` offer can sit past `expiresAt` forever unless an admin resolves it. Highest-priority follow-up; the schema already supports the query (`state='offered' AND deadline_at<now`). *(Ties directly to the brief's "45-second timeout" — clarify with the founder that the foundation does not yet time out.)*
2. **Zero tests today** — correctness of the concurrency guarantees is unverified by CI; DoD-blocking.
3. **"Trusted partner per category" is undefined at the data layer** — the planner phase must introduce eligibility/trust; the foundation deliberately doesn't, so don't assume it exists.
4. **Customer "one order" is preserved but "repair" is unbuilt** — stakeholders may read the foundation as delivering the visible feature; it delivers the ledger only.
5. **Provisional numbering** — UUID-prefix base is not a human number; if a human order-number scheme lands, swap `displayBase` (numbers already assigned stay valid).
6. **`recovery.service.ts` is uncommitted** in the working tree (one type-annotation diff); ensure it's committed with the spec + tests.

## Review Checklist
1. Confirm the migration is **additive-only** (no ALTER on existing tables) and matches the Prisma models; partial-unique index present and correct.
2. Walk the **state machine** vs `NEED_TRANSITIONS`: legal set complete, terminals correct, `cancelled` from every non-terminal, offer-driven states unreachable via the raw transition endpoint.
3. Verify the **three concurrency guarantees** by reading `openNeed` (P2002 retry), `recordOffer` (one-pending partial-unique 409), `setOfferOutcome` (write-once + coupled guard = single-winner).
4. Confirm **atomicity**: each primitive's row change + events are in one `$transaction`; no order/item writes anywhere.
5. Confirm **admin-only** guard on all 6 routes; actor stamped on every event; no PII/money in recovery tables.
6. Confirm the numbering **uniqueness** argument (DB unique index is truth; count+retry is convenience) and that sequences are never reused.
7. **Test gap**: require the §16 suite before DoD; decide which integration paths are merge-blocking.
8. Confirm the **deferred list (§4)** is complete and the code's "not in Phase A" comments match reality (no hidden orchestration): specifically **no timeout sweep**, **no order mutation**, **no partner selection**.
9. Resolve the **open decisions**: 45 s default owner, human-number timing, where "trusted partner/category" will live (planner phase), and whether an offer-timeout sweep should ship *with* the foundation given risk #1.
10. Verify the pre-existing API suite still passes and the module is registered (`/api/v1/recovery`).

## Builder Constraints
1. **Do not redesign the foundation** and **do not extend scope** into orchestration — no queues, no timeout sweep, no partner selection, no order/item/inventory mutation, no notifications. Those are separate, later-phase tickets.
2. **Additive only** — no ALTER of `orders`/`order_items`/`shops`/existing enums; any new recovery need stays in the four recovery tables (or a new additive table with Architect sign-off).
3. **Every `RecoveryNeed.state` write goes through the guarded service** (`transitionNeed`/`recordOffer`/`setOfferOutcome`); never update `state` directly. All business numbers/windows stay **parameterized** (no hardcoded 45).
4. **Land the §16 tests** (unit + service + integration) and keep the existing suite green; this is the primary DoD item.
5. Commit the uncommitted `recovery.service.ts` **with** this spec and the tests; Conventional Commits; one concern per commit; never stage `.env`. Remember `main` auto-deploys — merge deliberately.
6. Follow `apps/api/CLAUDE.md` (consult Context7 for Prisma 5 / Fastify 4 before backend changes); keep the raw-SQL partial-unique index in the migration (Prisma can't express it) and keep the service's P2002 tolerance.
7. Preserve the code's `Architecture §NN` citations by keeping them resolvable against this document (update the section-anchor map if you renumber).
