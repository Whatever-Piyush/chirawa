# HARNESS_REMEDIATION_PLAN.md

> Plan to make `RUNTIME_VERIFICATION_HARNESS.md` trustworthy enough to serve as a **release
> gate** for the 19 P0 features. Inputs: `RUNTIME_VERIFICATION_HARNESS.md`,
> `HARNESS_GAP_ANALYSIS.md` (25 findings F1–F25).
>
> **Scope guardrails (binding):** this plan changes the **verification system only** — the
> harness document and new harness-only files under `scripts/harness/`. It does **not** modify
> application code (nothing under `apps/api/src`, no Prisma schema, no app `prisma/seed*`), and it
> does **not** execute the P0 tests. "Verification that the fix worked" below means *non-executing
> self-checks of the harness change* (lint / dry-run / guard-logic / mechanics), not running the
> P0 suite against the app.

---

## 1. Finding inventory → three buckets

| Bucket | Definition | Findings | Count |
|---|---|---|---|
| **Blockers** (Phase 0A) | Harness reports green while broken, or corrupts/blocks its own run | F1, F2, F3, F4, F5, F6, F7, F8, F14 | 9 |
| **Coverage gaps** (Phase 0B) | Real P0 paths not actually verified (notif, realtime, settlement, recovery, concurrency, multi-shop, exact-count idempotency, fixtures) | F9, F10, F11, F12, F13, F15, F16, F17, F18, F19, F20, F21, F22 | 13 |
| **Nice-to-have** (Phase 0C) | Hygiene / fragility | F23, F24, F25 | 3 |

**Interim-honesty note:** F10, F11, F18 can *mislead* (a log/empty-fixture that reads like a pass).
Until their 0B work lands, the gate must label the affected blocks **NOT VERIFIED** rather than PASS
(enforced by the final checklist, §6).

---

## 2. Dependency order (do-this-before-that)

```
                         ┌──────────────────────────────────────────────┐
LAYER 1  Run integrity   │ F8 isolation+sandbox env  ─┐                   │
(must exist first)       │ F3 login/rate              ├─ harness can run  │
                         │ F4 token refresh           │  reliably &       │
                         │ F5 hours preflight         │  repeatably       │
                         │ F14 unique ids ────────────┘                   │
                         └───────────────┬──────────────────────────────-┘
                                         ▼
LAYER 2  Fixtures/helpers   F6 fresh per-block orders  ──►  F18 fixture guards
(building blocks)           F10 token fixtures              F22 single-shop cart
                                         ▼
LAYER 3  Mode + negatives   F1 sandbox-gate money paths (needs F8+F6)
(stop the false green)      F2 negative/rejection cases (needs F6, F1-sandbox)
                                         ▼
LAYER 4  Assertion depth    F15 notif-table  F17 exact-count  F19 COD amount
                            F16 queue-state  F20 multi-shop   F24 ETA
                            F11 socket observer
                                         ▼
LAYER 5  Execution patterns F9 concurrency  F12 single-seller settlement  F13 recovery
                                         ▼
LAYER 6  Cleanup/re-run     F7 ordered scoped teardown ──► F21 post-cleanup assertions
                                         ▼
LAYER 7  Observability      F25 error-log correlation   F23 health URLs
```

Phase 0A executes Layers 1–3 (blockers). Phase 0B executes Layers 4–6 + F10 (coverage).
Phase 0C executes Layer 7 + F24 (nice-to-have). Within each phase, follow the arrows.

---

## 3. New harness file layout (verification system only — no app code)

The remediation converts the inline bash in the harness doc into runnable, re-usable scripts so
the gate is repeatable. All new files live under a new `scripts/harness/` directory (sibling to the
repo's existing `scripts/test-*.sh`), and the markdown references them.

| File (new) | Purpose | Findings served |
|---|---|---|
| `scripts/harness/lib.sh` | helpers: `sql`/`redis`, `login` (dev-safe), `auth` (refresh-on-401), `gen_id`, `require_fixture`, `tag_req` | F3, F4, F14, F18, F25 |
| `scripts/harness/00_preflight.sh` | isolation guard, operating-hours guard, OTP rate-key clear, health/ready, sandbox-mode assertion | F5, F8, F3, F23 |
| `scripts/harness/.env.sandbox.example` | reference for sandbox creds (operator fills a local, git-ignored copy) | F1, F8 |
| `scripts/harness/10_fixtures.sh` | accounts+tokens, FCM-token registration, `mk_order`, single-/multi-shop carts, fixture guards | F6, F10, F18, F20, F22 |
| `scripts/harness/socket_listen.mjs` | `socket.io-client` observer (asserts `order:*` receipt) | F11 |
| `scripts/harness/queue_state.mjs` | BullMQ job-state inspector (`getJob`/`getJobCounts`) | F16 |
| `scripts/harness/concurrency.sh` | parallel invocations + invariant assertions | F9, F17 |
| `scripts/harness/recovery.sh` | backdate SQL + reconcile/rollback assertions | F13 |
| `scripts/harness/settlement.sh` | single-seller settle + idempotency assertions | F12 |
| `scripts/harness/99_cleanup.sh` | ordered scoped teardown + post-cleanup assertions | F7, F21 |
| `RUNTIME_VERIFICATION_HARNESS.md` | updated to call the scripts; per-block negative/DB/socket/queue assertions | all |

> `.env.sandbox` (the filled copy) must be git-ignored and never committed — same discipline as the
> repo's existing `.env` rule.

---

## 4. Phase 0A — Trustworthiness (Blockers)

**Objective:** the harness never reports green while a P0 feature is broken, and never corrupts or
blocks its own run. **Required before the P0 gate may run at all.**

### 0A-1 · F8 — Environment isolation + sandbox profile  *(Layer 1, do first)*
- **Files:** `scripts/harness/00_preflight.sh` (new), `scripts/harness/.env.sandbox.example` (new), `RUNTIME_VERIFICATION_HARNESS.md` §B.1.
- **Change:** Preflight aborts unless pointed at a **disposable** DB (require `HARNESS_DB=1` env marker AND `NODE_ENV != production` AND `SELECT count(*) FROM orders` below a small threshold). Add a `.env.sandbox.example` documenting the real-test-key profile. Scope all later DB reads/cleanups to harness-created ids only.
- **Self-check (non-executing of P0):** run `00_preflight.sh` with a faked prod-like marker → confirm it aborts; with the harness marker on an empty DB → confirm it proceeds. Confirm `.env.sandbox.example` lists every var the money blocks read (`grep` cross-check vs §B.1).
- **Effort:** M (≈1d).

### 0A-2 · F3 — OTP rate-limit self-DoS
- **Files:** `scripts/harness/lib.sh` (`login`), `scripts/harness/00_preflight.sh`.
- **Change:** In dev, `login()` calls **verify-otp only** (`123456` bypasses without send-otp). Preflight clears `otp:rate:*` / `otp:lockout:*` keys. In sandbox, distribute logins across distinct phones/IPs and capture tokens once.
- **Self-check:** `shellcheck lib.sh`; dry-run `login` in dev with a stub counting `send-otp` calls = 0; run the preflight DEL against a throwaway `otp:rate:test` key and confirm it's gone (harness mechanics, not a P0 test).
- **Effort:** S (≈0.5d).

### 0A-3 · F4 — Access-token expiry mid-run
- **Files:** `scripts/harness/lib.sh` (`auth`).
- **Change:** Wrap `auth()` with refresh-on-401 using the stored refresh token (mirrors the app client), keeping token-refresh itself exercised; tokens re-minted transparently for long blocks.
- **Self-check:** feed `auth` a deliberately-expired token against a stub returning 401-then-200 and confirm exactly one refresh call and one retry (mock the endpoint; no app feature exercised).
- **Effort:** S (≈0.5d).

### 0A-4 · F5 — Operating-hours time-dependency
- **Files:** `scripts/harness/00_preflight.sh`, `RUNTIME_VERIFICATION_HARNESS.md` §D.
- **Change:** Preflight asserts current IST time ∈ 9 AM–8 PM and aborts with a clear "out-of-window" message otherwise; document the window as a hard precondition.
- **Self-check:** run the guard with an injected in-window and out-of-window time var → confirm proceed vs abort (guard logic only).
- **Effort:** S (≈0.5d).

### 0A-5 · F14 — Hard-coded payment/event ids collide on re-run
- **Files:** `scripts/harness/lib.sh` (`gen_id`), `RUNTIME_VERIFICATION_HARNESS.md` §C-A10/§C-E3.
- **Change:** Generate per-run-unique ids (`gen_id pay`, `gen_id evt`) and thread them through curl bodies and cleanup `LIKE` patterns.
- **Self-check:** loop `gen_id` 100× and confirm all values unique (`sort -u | wc -l` == 100); grep harness to confirm no constant `pay_DEV1`/`evt_TEST1`/`pay_WH1` remain.
- **Effort:** S (≈0.5d).

### 0A-6 · F6 — Shared `$OID` threading → ordering-dependent results
- **Files:** `scripts/harness/10_fixtures.sh` (`mk_order`, status-pin helpers), `RUNTIME_VERIFICATION_HARNESS.md` §C spine blocks.
- **Change:** Add `mk_order <method>` returning a **fresh** order; each block creates and status-pins its own fixture (C-E1 pins an order at exactly `paid` for the illegal attempt; C-C5 asserts `orders.rider_id == $RIDER_PID` before proceeding).
- **Self-check:** grep §C to confirm no block reads an `$OID` it didn't create; review that C-E1 attempts an illegal transition from a pinned `paid` state.
- **Effort:** L (≈2d).

### 0A-7 · F7 — FK-unsafe / incomplete / over-broad cleanup
- **Files:** `scripts/harness/99_cleanup.sh` (new), `RUNTIME_VERIFICATION_HARNESS.md` §E.
- **Change:** Explicit ordered, harness-scoped teardown — `order_status_history → order_items → payments → delivery_assignments → promo_redemptions → transactions(by reference_id) → orders → order_groups → batches`, scoped to harness customer/sellers, **before** deleting users; for `9000000004` delete their orders first; settlement/transaction deletes scoped to harness reference ids (never blanket `period_date`).
- **Self-check:** seed a throwaway DB snapshot with harness-shaped rows, run `99_cleanup.sh`, confirm **zero FK errors** and that only harness rows were removed (row-count diff). (DB mechanics on a disposable snapshot — not a P0 feature run.)
- **Effort:** M (≈1d).

### 0A-8 · F1 — Dev-mock cannot verify money movement/signatures  *(Layer 3; needs 0A-1, 0A-6)*
- **Files:** `RUNTIME_VERIFICATION_HARNESS.md` §B.1/§C-A10/§C-E3/§C-A13/§C-B2/§C-C6/§C-D7/§C-E4/§D, `scripts/harness/.env.sandbox.example`.
- **Change:** Make **sandbox the release-gate mode** for the seven money features; label dev-mock blocks "SMOKE — NON-GATING". Add positive external assertions: payment/refund/payout objects present in the Razorpay/RazorpayX test dashboards with expected `amount`/`notes`/idempotency key; `settlements.payout_id`/`upi_ref` populated only after `processed`.
- **Self-check:** grep §D to confirm every money block's GATE row requires sandbox; review that each adds an external-artifact assertion; load `.env.sandbox` under `set -u` and confirm all required vars resolve (no app call).
- **Effort:** L (≈2d).

### 0A-9 · F2 — No negative/rejection assertions  *(Layer 3; needs 0A-6, 0A-8)*
- **Files:** `scripts/harness/negatives.sh` (new, or folded into blocks), `RUNTIME_VERIFICATION_HARNESS.md` §C-A10/§C-E3/§C-B2/§C-C5/§C-C6/§C-D7/§C-A13.
- **Change:** Add asserted rejections: wrong webhook signature → 4xx `AuthenticationError`; tampered `verify` signature → `PaymentError`; cross-shop seller → 403; cross-rider completion → 403; non-admin refund/assign → 403; replayed `razorpay_payment_id` → no second capture.
- **Self-check:** review each negative asserts a specific non-2xx outcome (not success); lint `negatives.sh`; confirm assertions fail-closed (a 2xx response marks FAIL).
- **Effort:** M (≈1d).

**Phase 0A exit criteria:** preflight isolation+hours guards pass; logins survive re-runs without rate trips; tokens auto-refresh; every block uses fresh status-pinned fixtures with unique ids; money blocks are sandbox-gated with external assertions; negative signature/permission cases present and fail-closed; cleanup runs FK-clean and scoped. **Effort total: ≈ 8.5–9 days.**

---

## 5. Phase 0B — Coverage Completion (Coverage gaps)

**Objective:** every P0 path is *actually* exercised and asserted, not implied. Required for the
harness to be **fully** trustworthy (after 0A, the gate may run with un-done 0B items explicitly
labeled NOT VERIFIED).

### 0B-1 · F18 — Fixture-existence guards  *(Layer 2)*
- **Files:** `scripts/harness/10_fixtures.sh` (`require_fixture`), §C-E11/§C-A9/§C-C6/§C-E12.
- **Change:** Each fixture lookup that returns empty → block result `BLOCKED: fixture missing` (not PASS/FAIL), printing the failing SQL; create required fixtures (featured shop, numeric-stock product, multi-line + single-line carts) via API/SQL in the harness bootstrap.
- **Self-check:** run `require_fixture` against a deliberately-empty query → confirm it emits BLOCKED and exits non-zero.
- **Effort:** S (≈0.5d).

### 0B-2 · F10 — FCM-token fixture + notification reality  *(Layer 2/4)*
- **Files:** `scripts/harness/10_fixtures.sh`, §B.5, §C notif blocks.
- **Change:** Register a dummy device token for customer/seller/rider via `POST /notifications/register-token`; replace log-eyeballing with DB assertions (see F15).
- **Self-check:** after the fixture step, `redis GET fcm:token:<userId>` returns the token (mechanics, not a P0 assertion).
- **Effort:** S (≈0.5d).

### 0B-3 · F15 — `notifications` table assertions  *(Layer 4)*
- **Files:** §C-A10/§C-B2/§C-C5/§C-A13/§C-D7/§C-E3.
- **Change:** Assert `notifications` rows (`channel`,`event_type`) per notifying event instead of relying on debug logs.
- **Self-check:** dry-run the assertion SQL against a manually-inserted sample notification row on the throwaway DB → confirm the query shape returns it.
- **Effort:** S (≈0.5d).

### 0B-4 · F16 — Deterministic queue-state checks  *(Layer 4)*
- **Files:** `scripts/harness/queue_state.mjs` (new), §C-A10/§C-B3/§C-E3/§C-E4 queue checks.
- **Change:** Replace `KEYS bull:*` with BullMQ `getJob(jobId)`/`getJobCounts()` and worker-completion-log assertions; check the specific `jobId` (e.g. `auto-accept:$OID`) and state.
- **Self-check:** run `queue_state.mjs` against the live queue with no job → confirm it reports counts cleanly (connection/mechanics only).
- **Effort:** S (≈0.5d).

### 0B-5 · F17 — Exact-count idempotency assertions  *(Layer 4)*
- **Files:** §C-A10/§C-B3/§C-D7.
- **Change:** Assert *absence* of duplicate effects: `transactions(customer_payment)`=1 after double-verify; `missed_acceptances` delta=1; one active `delivery_assignment` after repeated assign.
- **Self-check:** review each idempotency block now asserts an exact count, not existence.
- **Effort:** S (≈0.5d).

### 0B-6 · F19 — COD amount equality  *(Layer 4)*
- **Files:** `scripts/harness/lib.sh`, §C-C5.
- **Change:** Derive `COD_TOTAL` from the order; post exactly that; assert `cod_collected_paise == total_amount` and rider `cod_balance_paise` delta == it; add a mismatched-amount negative case recording behaviour.
- **Self-check:** confirm `$COD_TOTAL` is now defined and sourced from SQL (no undefined var).
- **Effort:** S (≈0.5d).

### 0B-7 · F22 — Single-shop promo cart pin  *(Layer 2/4)*
- **Files:** §C-E12, `scripts/harness/10_fixtures.sh`.
- **Change:** Pin a single-shop cart for the promo block; assert `appliedPromoCode` set; add a multi-shop case asserting the documented "no preview promo" behaviour.
- **Self-check:** review the E12 cart is single-shop before preview.
- **Effort:** S (≈0.5d).

### 0B-8 · F20 — Multi-shop OrderGroup money correctness  *(Layer 4)*
- **Files:** `scripts/harness/10_fixtures.sh` (multi-shop cart), §C-A9/§C-A10/§C-A13.
- **Change:** Add a two-shop fixture; assert child count == shop count, exactly one child has `delivery_fee>0`, `getOrderGroup` totals == sum of children, discount on carrier only.
- **Self-check:** review assertions reference the group, not a single `$OID`.
- **Effort:** M (≈1d).

### 0B-9 · F11 — Observe Socket.IO emissions  *(Layer 4)*
- **Files:** `scripts/harness/socket_listen.mjs` (new), §C-A14/§C-B2/§C-C5/§C-D7.
- **Change:** Add a `socket.io-client` observer (connect with `auth:{token}`, subscribe, log events) and assert receipt of at least one `order:*` per relevant room within N seconds; where not run, label the block "realtime NOT verified".
- **Self-check:** run `socket_listen.mjs`, confirm it connects and prints the server's `connected` handshake (connection check only — not a P0 assertion).
- **Effort:** M (≈1d).

### 0B-10 · F12 — Single-seller, idempotent settlement  *(Layer 5)*
- **Files:** `scripts/harness/settlement.sh` (new), §C-E4.
- **Change:** Use `single-seller-settle` with explicit `sellerProfileId`/`shopId`/`periodDate`; assert that seller's settlement only; in sandbox assert `pending→processing→paid`, ledger `seller_settlement` written **exactly once** at `paid`, and a second enqueue → **no second payout** (idempotency key).
- **Self-check:** review the settlement assertion is scoped to a known seller id, not `period_date=current_date-1` globally.
- **Effort:** M (≈1d).

### 0B-11 · F13 — Runnable recovery tests  *(Layer 5)*
- **Files:** `scripts/harness/recovery.sh` (new), §C-E3/§C-A9.
- **Change:** Add backdate SQL (`UPDATE orders SET created_at = now() - interval '31 minutes' …`) + a captured-but-un-notified sandbox payment, enqueue `payment-reconcile`, assert order→paid with exactly one `customer_payment`; for oversell assert order count unchanged AND `stock_qty` unchanged; add Redis-flush-then-`GET /cart` for documented cart-loss behaviour.
- **Self-check:** confirm the backdate UPDATE runs on a throwaway order row and changes `created_at` (mechanics).
- **Effort:** M (≈1d).

### 0B-12 · F9 — Execute concurrency cases  *(Layer 5)*
- **Files:** `scripts/harness/concurrency.sh` (new), §C-A9/§C-B3/§C-A13/§C-C6.
- **Change:** Replace prose comments with real parallel invocations + invariant assertions (oversell: parallel `POST /orders`, assert `stock_qty>=0` and exact order count; duplicate-tap: assert order count == 1; auto-accept vs manual: assert `seller_accepted_at` once + `missed_acceptances` delta exact).
- **Self-check:** shellcheck `concurrency.sh`; dry-run the `& … wait` + count scaffolding against a stub endpoint (no real race on the app).
- **Effort:** M (≈1d).

### 0B-13 · F21 — Post-cleanup baseline assertions  *(Layer 6; needs 0A-7)*
- **Files:** `scripts/harness/99_cleanup.sh`, §E.
- **Change:** End cleanup with assertions = clean slate: `count(orders WHERE customer_id=<harness cust>)=0`, rider `cod_balance_paise`=baseline, `count(promo_redemptions WHERE user_id=<cust>)=0`, `count(settlements WHERE …harness ids)=0`; fail the harness if any non-zero.
- **Self-check:** run cleanup twice on the throwaway snapshot; confirm the second run's assertions all read zero.
- **Effort:** S (≈0.5d).

**Phase 0B exit criteria:** every P0 block has DB assertions (incl. `notifications`), exact-count
idempotency, deterministic queue-state checks, COD/group money correctness, socket observation (or
honest NOT-VERIFIED label), single-seller idempotent settlement, runnable recovery + concurrency,
and a verified-clean post-cleanup state. **Effort total: ≈ 8.5–9 days.**

---

## 6. Phase 0C — Nice-to-have (Hygiene)

| ID | Files | Change | Self-check | Effort |
|---|---|---|---|---|
| F23 | §D | Use explicit root `http://localhost:3000/health` & `/ready` | review URLs | S (0.1d) |
| F24 | §C-A9/§C-C5 | Report-only assert `orders.estimated_delivery_at`/`eta_source` set | dry-run SQL on sample row | S (0.25d) |
| F25 | `scripts/harness/lib.sh`, §C all | Tag requests with `x-request-id`; after each block assert no `error`-level API log for those ids | grep a sample log stream for the tag | S (0.5d) |

**Effort total: ≈ 1 day.**

---

## 7. Effort roll-up

| Phase | Findings | Effort |
|---|---|---|
| 0A Trustworthiness (Blockers) | 9 | ≈ 8.5–9 d |
| 0B Coverage Completion | 13 | ≈ 8.5–9 d |
| 0C Nice-to-have | 3 | ≈ 1 d |
| **Total before trusted P0 gate** | **25** | **≈ 18–19 harness-eng-days** |

Minimum to *run* the P0 gate (honestly): **Phase 0A complete** + every un-done 0B item labeled
NOT VERIFIED. Fully trustworthy gate: **0A + 0B complete**.

---

## 8. Final Checklist — "Harness Ready For P0 Execution"

### Part 1 — Phase 0A (Blockers) — ALL required to gate
- [ ] **F8** Preflight aborts on production / non-disposable DB; runs only against an isolated DB (`HARNESS_DB=1`).
- [ ] **F8/F1** `.env.sandbox` loaded; money blocks (A10, E3, A13, B2-reject, C6, D7, E4) run in **sandbox**; dev-mock blocks labeled SMOKE/NON-GATING.
- [ ] **F3** `login()` does not trip OTP rate limits across two consecutive full runs; preflight clears `otp:rate:*`.
- [ ] **F4** `auth()` auto-refreshes on 401; a >15-min run completes without auth false-negatives.
- [ ] **F5** Preflight confirms run is inside the 9 AM–8 PM IST window (or aborts clearly).
- [ ] **F14** All Razorpay payment/event ids are per-run-unique; no constant ids remain.
- [ ] **F6** Every block creates its own fresh, status-pinned fixture; no shared `$OID` reuse; C-E1 attempts an illegal transition from a pinned `paid` order.
- [ ] **F2** Negative signature + permission cases present and **fail-closed** (a 2xx marks FAIL).
- [ ] **F7** Cleanup runs FK-clean, harness-scoped, in the correct child→parent order.

### Part 2 — Phase 0B (Coverage) — done OR explicitly labeled NOT VERIFIED in the gate
- [ ] **F18** Missing fixtures yield `BLOCKED`, never silent PASS.
- [ ] **F10/F15** FCM tokens registered; notifications verified via `notifications` table.
- [ ] **F16** Queue checks use BullMQ job-state / worker logs, not `KEYS`.
- [ ] **F17** Idempotency asserted by exact counts (no duplicate effect).
- [ ] **F19** COD collected amount asserted == order total.
- [ ] **F22** Promo verified on a pinned single-shop cart.
- [ ] **F20** Multi-shop `OrderGroup` money correctness asserted.
- [ ] **F11** Socket emissions observed (or block labeled "realtime NOT verified").
- [ ] **F12** Settlement scoped to one seller; payout idempotency asserted (sandbox).
- [ ] **F13** Dropped-webhook→reconcile and oversell-rollback recovery actually executed + asserted.
- [ ] **F9** Concurrency cases executed in parallel with invariant assertions.
- [ ] **F21** Post-cleanup assertions confirm a clean slate.

### Part 3 — Phase 0C (Hygiene) — recommended
- [ ] **F23** Health/ready use explicit root URLs.
- [ ] **F24** ETA presence asserted (report-only).
- [ ] **F25** No `error`-level API logs for harness request ids.

### Gate decision
- **May run P0 gate:** Part 1 fully checked **and** every unchecked Part 2 item is surfaced as
  **NOT VERIFIED** (never PASS) in the §D release-gate table.
- **Fully trustworthy P0 gate:** Part 1 **and** Part 2 fully checked (Part 3 recommended).

---

*Scope note: this plan improves the verification system only. No application code is modified and
no P0 tests are executed; all "self-checks" above validate the harness changes via lint / dry-run /
guard-logic / mechanics on disposable data, not by running the P0 suite against the application.*
