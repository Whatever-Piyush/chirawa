# PHASE0A_RISK_SURFACE.md

> Capability / blast-radius declaration for each of the 7 Phase 0A files **before** implementation.
> For every file: exact responsibility · execute command · files it can modify · DB tables it can
> write · Redis keys it can write/delete. **No files are modified by this document.**
>
> **Key distinction used throughout:**
> - **Direct DB/Redis** = the script itself issues `INSERT/UPDATE/DELETE` SQL or `SET/DEL` Redis.
> - **App-mediated** = the script calls an authenticated API endpoint and the *application* performs
>   the write as part of its normal behaviour. The harness never reaches into app-owned tables
>   directly except in `99_cleanup.sh`.
> DB names below are the physical (snake_case `@@map`) table names.

---

## 0. Capability summary matrix

| File | Executed how | Modifies repo files | Direct DB writes | App-mediated DB writes | Redis write/delete |
|---|---|---|---|---|---|
| `00_preflight.sh` | run (entry, first) | none | **none** (read-only) | none | **DEL** `otp:rate:*`, `otp:lockout:*` |
| `lib.sh` | **sourced** (defines fns) | none | conduit only¹ | via `login`/`auth` (auth tables) | sandbox `login` only: `otp:*` |
| `.env.sandbox.example` | not executed (data) | none | none | none | none |
| `10_fixtures.sh` | sourced / run | none | **read-only** (discovery) | order/payment/dispatch tables² | `fcm:token:*`, `cart:*`, `rider:*` |
| `99_cleanup.sh` | run (last) | none | **DELETE/UPDATE (scoped)** ³ | `rider_availability` (offline PATCH) | **DEL** harness keys only |
| `negatives.sh` | run | none | read-only (assert no-change) | **none expected** (rejections)⁴ | none expected |
| `RUNTIME_VERIFICATION_HARNESS.md` | not executed (doc) | none | none | none | none |

¹ `lib.sh` defines generic `sql()`/`redis()` conduits that are *technically unbounded*; scope is
enforced by the **callers**, not by `lib.sh` itself (see §8).
² `10_fixtures.sh` issues **no direct writes**; all DB writes are the app's, triggered by legal API calls.
³ `99_cleanup.sh` is the **only** script with direct destructive writes; every statement is `WHERE`-scoped
to harness-created ids and is gated by the `00_preflight.sh` isolation guard.
⁴ Negatives expect rejection → zero writes under correct app behaviour; the *capability if a control is
broken* is exactly what they detect (see §6).

---

## 1. `scripts/harness/00_preflight.sh`  *(new — gate; finding F8, F5, F3)*

- **Exact responsibility:** Single entry gate run before anything else. (a) **Isolation guard** — abort unless `HARNESS_DB=1` **and** `NODE_ENV != production` **and** `SELECT count(*) FROM orders` is below a small ceiling (refuse to run on a populated/shared DB). (b) **Operating-hours guard** — abort if current IST time is outside 9 AM–8 PM. (c) **OTP rate reset** — clear the harness's own rate/lockout counters. (d) **Mode assertion** — when money blocks will run, confirm `.env.sandbox` values are non-placeholder. (e) **Liveness** — `GET /health` + `GET /ready`.
- **What command executes it:** `bash scripts/harness/00_preflight.sh` (sources `lib.sh`; must succeed before any other script runs).
- **Files it can modify:** **none** (no repo writes; emits a run-id + pass/fail to stdout/stderr only).
- **DB tables it can write:** **none.** Read-only: `SELECT count(*) FROM orders` (ceiling), `SELECT 1` (readiness). Issues **no** INSERT/UPDATE/DELETE.
- **Redis keys it can write/delete:** **Delete only** — `otp:rate:phone1h:*`, `otp:rate:phone24h:*`, `otp:rate:ip1h:*`, `otp:lockout:*`. Read-only: `PING`. Writes **no** Redis values. (Blanket-safe only because it runs after its own isolation guard, on a disposable Redis.)

---

## 2. `scripts/harness/lib.sh`  *(new — helper library; findings F3, F4, F14)*

- **Exact responsibility:** Pure function library, **sourced not executed**; defines `sql()` (psql conduit), `redis()` (redis-cli conduit), `login()` (dev-safe: verify-otp only with `123456`, no `send-otp`), `auth()` (HTTP with single-flight refresh-on-401), `gen_id()` (per-run-unique ids). Sourcing it has **no side effects**.
- **What command executes it:** Not run directly — `source scripts/harness/lib.sh` from the other scripts.
- **Files it can modify:** **none** (defines shell functions only).
- **DB tables it can write:**
  - *Direct:* none on its own. `sql()` is a **generic conduit** (unbounded by design — see §8); callers own the statement scope.
  - *App-mediated via `login()`/`auth()`:* `otp_attempts`, `refresh_tokens`; on a **first** login of a new phone the app also creates `users`, `customer_profiles`, `referral_codes` (and `referral_redemptions` if a referral code is passed). `auth()`'s refresh path rotates `refresh_tokens`.
- **Redis keys it can write/delete:**
  - *Dev `login()`* (verify-otp with `123456`): **none** — the app's dev bypass returns before any Redis access.
  - *Sandbox `login()`* (real `send-otp`): app writes `otp:data:{phone}`, `otp:rate:*`.
  - *`auth()`*: none (HTTP + DB refresh only). `redis()` is a generic conduit (see §8).

---

## 3. `scripts/harness/.env.sandbox.example`  *(new — static template; findings F1, F8)*

- **Exact responsibility:** Committed reference listing the **names** (placeholder values only) of the sandbox env vars — Razorpay test keys, `RAZORPAYX_ACCOUNT_NUMBER`, `FCM_SERVICE_ACCOUNT_JSON`, `FAST2SMS_API_KEY`, Mappls, R2. Operator copies to `.env.sandbox` (git-ignored by existing `.env.*` rule) and fills real **test** creds.
- **What command executes it:** **Not executed.** Consumed as data: `cp .env.sandbox.example .env.sandbox` then `set -a; . scripts/harness/.env.sandbox; set +a`.
- **Files it can modify:** **none** (it is inert data; contains no secrets).
- **DB tables it can write:** **none.**
- **Redis keys it can write/delete:** **none.**

---

## 4. `scripts/harness/10_fixtures.sh`  *(new — fixtures; finding F6, plus token-fixture groundwork)*

- **Exact responsibility:** Build per-run fixtures: log in customer (fresh) + seeded seller/rider/admin, capture tokens; register dummy FCM device tokens; create the customer address; expose `mk_order <method>` which drives **cart → order** (and, when a block needs a pinned status, advances it **only through legal API transitions**) and returns a fresh order id; build single-/multi-shop carts. Status pinning uses **API calls only — never direct DB UPDATE/backdate** (backdating lives in Phase 0B `recovery.sh`/`settlement.sh`, out of scope here).
- **What command executes it:** `source scripts/harness/10_fixtures.sh` (after `lib.sh` + a passing preflight), then `mk_order cod` / `mk_order upi` etc.
- **Files it can modify:** **none** (tokens/ids held in shell env vars; no repo writes).
- **DB tables it can write:**
  - *Direct:* **read-only** — `SELECT` to discover a product/shop/seller/rider id; no direct writes.
  - *App-mediated (the app writes these via legitimate authenticated calls):*
    - auth/login (as §2): `users`, `customer_profiles`, `referral_codes`, `refresh_tokens`, `otp_attempts`
    - `POST /users/me/addresses` → `addresses`
    - `POST /cart/items` → `carts` (the carts **row** is upserted; **`cart_items` is not written** — items are Redis-primary)
    - `mk_order` → `POST /orders` → `order_groups` (multi-shop), `orders`, `order_items`, `order_status_history`, `products` (stock decrement when `stock_qty` is tracked), `promo_redemptions` + `promo_codes` (only if a promo applies), and the app updates `orders` ETA fields
    - status-pin via API: `orders`, `order_status_history`; if pinned through online payment → `payments`, `transactions`; if pinned past `confirmed` → `delivery_assignments`, `batches` (dispatch); if a token is registered → `notifications`
    - `PATCH /delivery/availability` (rider online) → `rider_availability`
- **Redis keys it can write/delete (all app-mediated):**
  - `POST /notifications/register-token` → **SET** `fcm:token:{userId}` (90d) for customer/seller/rider
  - `POST /cart/items` → **SET** `cart:{userId}` (24h); `mk_order`'s `POST /orders` → **DEL** `cart:{userId}`
  - `PATCH /delivery/availability` → **SET** `rider:{riderProfileId}:availability` and `rider:{riderProfileId}:location`
  - sandbox login → `otp:data:{phone}`, `otp:rate:*`

---

## 5. `scripts/harness/99_cleanup.sh`  *(new — teardown; finding F7. **Only destructive file.**)*

- **Exact responsibility:** After a run, delete harness-created rows in child→parent order, reset rider COD float + availability, and clear harness Redis keys. **Re-checks the isolation guard at its own top** before any delete. Every `DELETE`/`UPDATE` is `WHERE`-scoped to harness-created identifiers (harness customer id, harness phones `9000000002`/`9000000004`, harness reference ids, harness settlement seller+period) — **never** a blanket predicate.
- **What command executes it:** `bash scripts/harness/99_cleanup.sh` (last step; aborts unless the isolation guard passes).
- **Files it can modify:** **none.**
- **DB tables it can write (direct, scoped):**
  - **DELETE** (child→parent): `order_status_history`, `order_items`, `payments`, `delivery_assignments`, `promo_redemptions`, `transactions` (by `reference_id`), `orders`, `order_groups`, `batches`, `payment_webhook_events` (harness `evt_*` ids), `settlements` (harness seller + harness period), `referral_redemptions` (harness referred users), `addresses` (harness customer), then `users` (harness phones — cascades `customer_profiles`, `referral_codes`, `refresh_tokens`).
  - **UPDATE:** `rider_profiles` (`cod_balance_paise` reset to the captured baseline).
  - *App-mediated:* `PATCH /delivery/availability {"status":"offline"}` → `rider_availability`.
  - **Explicitly NOT touched:** any row not matching a harness-scoped `WHERE`; seeded shops/products/categories/zones; seeded operator accounts (seller/rider/admin) are **kept** (only `9000000002`/`9000000004` are deleted).
- **Redis keys it can write/delete:**
  - **DEL** (scoped): `cart:{harnessCustUserId}`, `fcm:token:{harness user ids}`, `rider:{harnessRiderId}:availability`, `rider:{harnessRiderId}:location`, `otp:*:90000000*` (harness phones).
  - **Must NOT** issue `FLUSHALL`/`FLUSHDB` or blanket-delete `bull:*` (BullMQ) — only harness-owned keys.

---

## 6. `scripts/harness/negatives.sh`  *(new — rejection assertions; finding F2)*

- **Exact responsibility:** Drive the negative/permission cases and assert each is **rejected** with the expected non-2xx and produces **no state change**: tampered `verify` signature → `PaymentError`; wrong webhook signature → `AuthenticationError`; seller-B on shop-A order → 403; rider-Y on rider-X delivery → 403; non-admin `refund`/`assign` → 403; replayed `razorpay_payment_id` → no second capture.
- **What command executes it:** `bash scripts/harness/negatives.sh` (after fixtures; uses role tokens + a fixture order from `10_fixtures.sh`).
- **Files it can modify:** **none.**
- **DB tables it can write:**
  - *Direct:* **read-only** — `SELECT` to assert **no** state change (e.g., order status unchanged, exactly one `customer_payment` transaction, one active `delivery_assignment`).
  - *App-mediated (expected):* **none** — every call must be rejected before any write.
  - *Capability if a control is broken (the failure these tests exist to catch):* a wrongly-accepted forged/over-privileged call could cause the app to write `payments`, `orders`, `transactions`, or `delivery_assignments`. The negative assertions **fail** on exactly that unexpected write/state change.
- **Redis keys it can write/delete:** **none expected** (rejected calls perform no Redis writes). Same "capability-if-broken" caveat as above.

---

## 7. `RUNTIME_VERIFICATION_HARNESS.md`  *(existing — modified; orchestration/doc)*

- **Exact responsibility:** Human-readable runbook + release-gate. After Phase 0A it **references the scripts** (§B preflight, §C blocks via `mk_order`/`negatives`, §E via `99_cleanup.sh`), encodes sandbox-gating and the operating-hours precondition, and holds the §D checklist. Executable logic lives in the scripts; the doc orchestrates order and records PASS/FAIL.
- **What command executes it:** **Not executed by a machine.** An operator reads it and runs the referenced scripts; embedded snippets are illustrative or copied into the scripts.
- **Files it can modify:** **none** (documentation).
- **DB tables it can write:** **none.**
- **Redis keys it can write/delete:** **none.**

---

## 8. Cross-cutting risk callouts

- **C1 — `lib.sh` `sql()`/`redis()` are unbounded conduits.** They can technically run any statement
  against the configured DB/Redis. Scope is enforced by **convention + review**, not by the helpers:
  the only place that uses them for destructive writes is `99_cleanup.sh` (reviewed, scoped, guarded).
  `00_preflight.sh`/`10_fixtures.sh`/`negatives.sh` use `sql()` for **reads only**. *Mitigation to apply
  during implementation:* keep all `DELETE/UPDATE` SQL in `99_cleanup.sh`; reviewers grep the other
  scripts for `DELETE|UPDATE|INSERT` and expect zero hits.
- **C2 — `99_cleanup.sh` is the sole destructive file and depends on the `00_preflight.sh` guard.**
  Its safety is *not intrinsic* — it relies on the isolation guard having already refused non-disposable
  DBs. It therefore **re-asserts the guard at its own top** so it can't delete if invoked standalone.
- **C3 — All `10_fixtures.sh` writes are app-mediated through legal transitions.** No direct status
  pokes/backdates in Phase 0A; this keeps the fixture write-surface identical to ordinary app usage
  and avoids creating illegal states the matrix doesn't expect.

## 9. Boundary invariants (rules implementation must satisfy)

1. No script under `scripts/harness/` issues a `DELETE`/`UPDATE`/`INSERT` **except** `99_cleanup.sh`.
2. No script runs against a DB/Redis that fails the `00_preflight.sh` isolation guard.
3. No Redis `FLUSHALL`/`FLUSHDB`; no blanket `bull:*` deletion; every Redis delete is harness-key-scoped.
4. No script writes any **application** source, schema, migration, or seed; writes stay within
   `scripts/harness/` (none at runtime) and shell env vars.
5. Status pinning is via legal API transitions only (no direct status writes/backdating in Phase 0A).
6. Seeded operator accounts and seeded catalog are read-only to the harness; only harness-created rows
   (`9000000001` customer's data, harness phones `…002`/`…004`, harness reference ids) are deleted.

*No files were modified to produce this document. Implementation remains pending approval.*
