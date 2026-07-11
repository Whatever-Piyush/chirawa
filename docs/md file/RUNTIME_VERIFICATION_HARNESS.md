# RUNTIME_VERIFICATION_HARNESS.md

> A repeatable runtime verification harness that **proves the 19 P0 features actually work**
> against a running system. Run the whole thing before every release.
> Sources: `SYSTEM_INVENTORY.md`, `FEATURE_INVENTORY.md`, `FEATURE_VERIFICATION_MATRIX.md`,
> `PHASED_VERIFICATION_PLAN.md`.
> This document **only defines verification** — no fixes, no audits, no improvements.
> All endpoints, tables, Redis keys, queue names, and log strings are taken verbatim from the code.

---

## How to run

> **Phase 0A note (script-driven harness).** The trustworthiness tooling now lives in
> `scripts/harness/` (`lib.sh`, `00_preflight.sh`, `10_fixtures.sh`, `99_cleanup.sh`,
> `negatives.sh`, `.env.sandbox.example`). The inline bash in §B/§E below is superseded by those
> scripts and kept only as a description of what each script does. See
> `HARNESS_REMEDIATION_PLAN.md` for the per-finding rationale (F1–F14).

0. **Preflight gate (required):** `bash scripts/harness/00_preflight.sh` — refuses to run unless
   the target DB/Redis pass the isolation guard (disposable, non-production, branded) **and** the
   clock is inside the 9 AM–8 PM IST window. Nothing else runs until this returns `0`.
1. Run **§B Baseline** once per harness run (infra up, seed, processes, fixtures).
2. Execute the **19 P0 blocks in §C** in listed order (they follow the dependency-aware sequence
   from `PHASED_VERIFICATION_PLAN.md §1B`: auth+foundation → money spine → refund branches → money/inert).
3. Fill the **§D Release-Gate Checklist** (PASS/FAIL per feature).
4. Run **§E Global Cleanup** (`bash scripts/harness/99_cleanup.sh`).

A feature is **Runtime Verified** only when its *Expected Result*, *Database Checks*, and the
applicable *Redis/Queue/External* checks all pass and no *Failure Signal* is observed.
**Money blocks (A10, E3, A13, B2-reject, C6, D7, E4) only GATE in sandbox mode** — in dev-mock the
app bypasses signatures/refunds/payouts, so those blocks are SMOKE/NON-GATING (F1).

---

## B. Baseline (shared across all P0 blocks)

### B.1 Environment Required (shared)
- Postgres + Redis via `docker-compose.yml` (containers `chirawa_postgres`, `chirawa_redis`).
- Extensions present (`scripts/init-db.sql`): `postgis`, `pg_trgm`, `pgcrypto`, `uuid-ossp`.
- API process(es) + worker process running:
  - **1× API + 1× worker** is enough for most P0 blocks.
  - The **worker MUST run** for E3 (reconciliation) and E4 (settlement/payout).
  - B3 auto-accept runs *inside the API process* (`seller-timeout.plugin`), not the worker.
- `.env` (apps/api): RS256 JWT keys generated (`scripts/generate-dev-keys.mjs`); `NODE_ENV` per mode below.
- **Isolation (F8):** the harness DB/Redis must be branded disposable once via
  `bash scripts/harness/00_preflight.sh --init`, and the run env must set `HARNESS_DB=1` +
  non-production `NODE_ENV`. `00_preflight.sh` enforces this on every run (see its guard).
- **Two run modes** (`HARNESS_MODE`, consumed by `00_preflight.sh`):
  - **`dev-mock`** (default): `RAZORPAY_*`/`RAZORPAYX_ACCOUNT_NUMBER` = `placeholder`,
    `FCM_SERVICE_ACCOUNT_JSON={}`, `FAST2SMS_API_KEY=placeholder`, `NODE_ENV=development` (OTP bypass `123456`).
    Payments mock; pushes/SMS/OTP to console. **Money blocks are NON-GATING** (signatures/refunds/payouts bypassed, F1).
  - **`sandbox`**: real Razorpay **test** keys + RazorpayX sandbox + webhook tunnel + FCM service account.
    `NODE_ENV` stays `development` (OTP bypass is key-independent). **Money blocks GATE.** Copy
    `scripts/harness/.env.sandbox.example` → `.env.sandbox` (git-ignored) and fill TEST creds.
- Short time-controls for deterministic waits: `SELLER_ACCEPT_MS=10000`, `BATCH_WINDOW_MS=10000`,
  `ASSIGN_RETRY_MS=5000`, `ASSIGN_MAX_ATTEMPTS=3` (set in the API/worker env for the run).

### B.2 Accounts Required (shared)
| Role | How obtained | Notes |
|---|---|---|
| Customer | created fresh via OTP in B.5 | new phone → role `customer` |
| Seller | seeded (`prisma/seeds/shops.ts`) | discover phone via SQL (B.4); seeded phone may be `+91`-prefixed vs 10-digit auth — strip prefix |
| Rider | seeded (`prisma/seeds/riders.ts`) | needs `rider_availability` online to be dispatch-eligible |
| Admin | seeded or inserted | role `admin`; required for D7 |

### B.3 Seed Data Required (shared)
Run `pnpm --filter @chirawa/api db:migrate:prod && pnpm --filter @chirawa/api db:seed`.
Provides: `FeeRule` v1 (active), shops + products + categories, delivery zones, riders, search aliases.
(Daily-essentials/feed depend on in-stock products existing.)

### B.4 Shell helpers (now in `scripts/harness/lib.sh`)
```bash
set -a; . scripts/harness/.env.sandbox 2>/dev/null || true; set +a   # or export the env yourself
. scripts/harness/lib.sh        # hsql / hredis / url_host / gen_id / login_as / auth / expect_status
```
The hardened helpers (replacing the old inline versions; see `HARNESS_GAP_ANALYSIS.md`):
- `login_as ROLE PHONE` — **F3**: dev-safe login (verify-otp `123456` only — never `send-otp`, so the
  run can't rate-limit itself); stores tokens in a file-backed store.
- `auth ROLE METHOD PATH [JSON]` — **F4**: refresh-on-401 that **persists** the new token to the store
  (durable across `$(...)` body-capture); sets `REPLY_STATUS` and `last_status`.
- `gen_id PREFIX` — **F14**: per-run-unique ids (file-backed counter) so repeated runs don't collide
  with the `razorpay_payment_id`/`event_id` UNIQUE constraints.
- `hsql 'SQL'` / `hredis ARGS…` — DB/Redis conduits against the validated `DATABASE_URL`/`REDIS_URL`.
```bash
# Enqueue an otherwise cron-gated worker job on demand (used by E3/E4 blocks):
enqueue(){ ( cd apps/api && pnpm exec tsx -e "import {Queue} from 'bullmq';import Redis from 'ioredis';const c=new Redis(process.env.REDIS_URL,{maxRetriesPerRequest:null});const q=new Queue('$1',{connection:c});await q.add('$2',${3:-'{}'});await q.close();await c.quit();" ); }
```

### B.5 Fixtures bootstrap (now in `scripts/harness/10_fixtures.sh`)
```bash
. scripts/harness/10_fixtures.sh
bootstrap_all      # discover_fixtures + bootstrap_accounts (CUST/SELLER/RIDER/ADMIN) + mk_address
```
Exports `PROD_ID`, `SHOP_ID`, `ADDR_ID`, `CUST_UID`, `RIDER_PID` and stores role tokens. **F6 fix:**
each block builds its **own** fresh, status-pinned order via `mk_order METHOD [created|paid|confirmed]`
(no shared `$OID` threaded across blocks). Status pinning uses **legal API transitions only**
(`pay_order`, `seller_accept`, `admin_assign`, `rider_pickup`, `rider_start`, …) — no direct DB pokes.

### B.6 Cleanup Procedure (shared — see also §E)
Canonical teardown is `bash scripts/harness/99_cleanup.sh` (**F7**: ordered child→parent, FK-safe,
harness-scoped; re-asserts the isolation guard before any delete). Never deletes seeded operator
accounts or catalog — only harness-created rows (harness customers + their orders/payments/etc.).

---

## C. P0 Feature Verification Blocks

> Each block defines all 13 fields. Fields 2–4 inherit §B unless a **Δ** (delta) is noted.

---

### C-A1 · OTP Login & Signup  *(Risk: High)*
1. **Test Data:** new phone `9000000002`; wrong OTP `000000`; valid `123456`.
2. **Environment:** Baseline (dev-mock → OTP bypass active).
3. **Accounts:** none pre-existing (creates one).
4. **Seed:** Baseline.
5. **Procedure:**
   ```bash
   curl -s $API/auth/send-otp  -d '{"phone":"9000000002"}' -H 'content-type: application/json'
   curl -s $API/auth/verify-otp -d '{"phone":"9000000002","otp":"000000"}' -H 'content-type: application/json'   # wrong
   N=$(login 9000000002); echo "$N" | jq '{isNewUser,role,requiresPin}'
   AC=$(echo "$N" | jq -r .tokens.accessToken); RF=$(echo "$N" | jq -r .tokens.refreshToken)
   curl -s $API/auth/refresh -d "{\"refreshToken\":\"$RF\"}" -H 'content-type: application/json' | jq .tokens.accessToken
   curl -s $API/auth/refresh -d "{\"refreshToken\":\"$RF\"}" -H 'content-type: application/json'   # reuse → revoke-all
   ```
6. **Expected:** wrong OTP → 4xx "Galat OTP…"; `verify-otp` → `isNewUser:true, role:"customer"`; refresh returns new pair; **reusing** the old refresh token → 401 "session compromised".
7. **Failure Signals:** new user not created; bypass `123456` accepted in `NODE_ENV=production`; reuse not detected.
8. **Logs:** API: `🔐 DEV OTP for 9000000002: …` (dev). No stack traces.
9. **DB Checks:**
   ```bash
   psqlc "SELECT role FROM users WHERE phone='9000000002';"                 # customer
   psqlc "SELECT count(*) FROM customer_profiles cp JOIN users u ON u.id=cp.user_id WHERE u.phone='9000000002';"  # 1
   psqlc "SELECT count(*) FROM referral_codes rc JOIN users u ON u.id=rc.owner_user_id WHERE u.phone='9000000002';"  # 1
   psqlc "SELECT is_successful FROM otp_attempts WHERE phone='9000000002' ORDER BY attempted_at DESC LIMIT 2;"
   psqlc "SELECT revoked_at IS NOT NULL AS revoked FROM refresh_tokens rt JOIN users u ON u.id=rt.user_id WHERE u.phone='9000000002';"  # revoked after reuse
   ```
10. **Redis Checks:** `redisc GET otp:data:9000000002` → nil after success; `redisc GET otp:rate:phone1h:9000000002` → counter.
11. **Queue Checks:** n/a.
12. **External Checks:** dev → OTP in console; sandbox → SMS received via Fast2SMS.
13. **Cleanup:** `psqlc "DELETE FROM users WHERE phone='9000000002';"` (cascades profile/tokens/referral).

---

### C-B1 · Seller OTP + PIN Login  *(Risk: High)*
1. **Test Data:** seller phone; PIN `1357`; wrong PIN `0000` ×5.
2. **Env / 3. Accounts / 4. Seed:** Baseline (seeded seller).
5. **Procedure:**
   ```bash
   S=$(login "$SELLER_PHONE"); echo "$S" | jq '{requiresPin,role}'
   ST=$(echo "$S" | jq -r .tokens.accessToken)
   auth "$ST" POST /auth/set-pin '{"pin":"1357","confirmPin":"1357"}'
   ```
6. **Expected:** `role:"seller"`; `requiresPin:true` until set; set-pin → "PIN set ho gaya". (Wrong-PIN lockout is exercised by the app's PIN screen; verify counter via DB.)
7. **Failure Signals:** seeded `+91` phone can't log in (strip prefix); PIN endpoint accepts customer role.
8. **Logs:** `🔐 DEV OTP for …`.
9. **DB Checks:** `psqlc "SELECT pin_hash IS NOT NULL AS has_pin, pin_fail_count, pin_locked_until FROM seller_profiles sp JOIN users u ON u.id=sp.user_id WHERE u.phone='$SELLER_PHONE';"`
10. **Redis:** OTP keys as A1. 11. **Queue:** n/a. 12. **External:** OTP console/SMS.
13. **Cleanup:** none (keep seeded seller). To reset PIN state: `psqlc "UPDATE seller_profiles SET pin_fail_count=0, pin_locked_until=NULL WHERE …;"`.

---

### C-C1 · Rider OTP + PIN Login  *(Risk: High)*
Identical engine to C-B1 with `$RIDER_PHONE`. 9. **DB:** check `rider_profiles.pin_hash/pin_fail_count/pin_locked_until`. Keep seeded rider on cleanup.

---

### C-E1 · Order State Machine  *(Risk: Critical)*
1. **Test Data:** one `paid` order (created in C-A9/C-A10).
2–4. Baseline. (Run after C-A10.)
5. **Procedure:** attempt an illegal jump (skip `preparing`) on a `paid`/`confirmed` order:
   ```bash
   auth "$SELLER" POST /orders/$OID/ready '{}'        # paid → ready_for_pickup (illegal)
   ```
   Supplementary (code-level): `pnpm --filter @chirawa/api test order-transitions`.
6. **Expected:** 4xx BusinessRule error `Illegal order transition: <from> → ready_for_pickup`; order status unchanged.
7. **Failure Signals:** illegal jump accepted; status advanced; no history integrity.
8. **Logs:** request-error log with the transition message; no 500.
9. **DB Checks:** `psqlc "SELECT status FROM orders WHERE id='$OID';"` unchanged; `psqlc "SELECT status,changed_by_role FROM order_status_history WHERE order_id='$OID' ORDER BY changed_at;"` shows only legal transitions.
10. **Redis / 11. Queue / 12. External:** n/a.
13. **Cleanup:** none (read/attempt only).

---

### C-E11 · Fee / Pricing Engine  *(Risk: Critical)*
1. **Test Data:** carts below ₹100, ≥₹100 standard, and one containing a featured (Special) shop product.
2–4. Baseline. Need a `is_featured=true` shop product for the special band: `psqlc "SELECT p.id FROM products p JOIN shops s ON s.id=p.shop_id WHERE s.is_featured AND p.stock_status='available' LIMIT 1;"`.
5. **Procedure:** seed cart then preview:
   ```bash
   auth "$CUST" DELETE /cart >/dev/null
   auth "$CUST" POST /cart/items "{\"productId\":\"$CHEAP_PROD\",\"quantity\":1}" >/dev/null     # < ₹100
   CART=$(auth "$CUST" GET /cart | jq -r .cartId)
   auth "$CUST" POST /pricing/preview "{\"cartId\":\"$CART\",\"addressId\":\"$ADDR\"}" | jq '{deliveryFee,cartSubtotal,total,hasSpecialShop}'
   ```
   Repeat with a ≥₹100 cart and with a Special-shop product.
6. **Expected:** fee = **2500** when subtotal < 10000 paise; **1000** standard ≥₹100; **1500** when `hasSpecialShop:true`; `feeRuleVersion` = active version; `total = cartSubtotal + deliveryFee − discount`.
7. **Failure Signals:** float/negative fee; wrong band; `No active fee rule found`.
8. **Logs:** none expected (pure path).
9. **DB Checks:** `psqlc "SELECT version FROM fee_rules WHERE effective_to IS NULL ORDER BY version DESC LIMIT 1;"` matches `feeRuleVersion`.
10. **Redis:** reads `cart:9000000001`. 11. **Queue/12. External:** n/a.
13. **Cleanup:** `auth "$CUST" DELETE /cart`.

---

### C-A9 · Checkout & Order Creation  *(Risk: Critical)*
1. **Test Data:** known in-stock `$PROD`; a numeric-stock product for oversell; `$ADDR`.
2–4. Baseline. Δ: pick a `stock_qty`-tracked product for the oversell case: `psqlc "SELECT id, stock_qty FROM products WHERE stock_qty IS NOT NULL AND stock_qty>0 LIMIT 1;"`.
5. **Procedure (COD happy path + oversell + duplicate-tap):**
   ```bash
   auth "$CUST" DELETE /cart >/dev/null
   auth "$CUST" POST /cart/items "{\"productId\":\"$PROD\",\"quantity\":2}" >/dev/null
   R=$(auth "$CUST" POST /orders "{\"cartId\":\"$(auth "$CUST" GET /cart | jq -r .cartId)\",\"addressId\":\"$ADDR\",\"paymentMethod\":\"cod\"}")  # cartId required (H-1)
   echo "$R" | jq '{orderId,orderIds,groupId,status,totalAmount,droppedLines}'
   OID=$(echo "$R" | jq -r .orderId)
   # Oversell: add qty > stock of tracked product, then order → whole order rejected
   # Duplicate tap: fire POST /orders twice rapidly with the same cart
   ```
6. **Expected:** COD order → `status:"confirmed"`; one order per shop under a `groupId` if multi-shop; cart cleared; oversell → 4xx "…stock bacha hai" with **no** partial order; operating-hours outside 9 AM–8 PM → 422 `SHOP_CLOSED`.
7. **Failure Signals:** order created on empty/foreign address; stock decremented but order rolled back inconsistent; duplicate orders from one tap; cart not cleared.
8. **Logs:** seller alert path (`🔔 New order alert sent to seller`) for COD; `📡 Order … status → confirmed`.
9. **DB Checks:**
   ```bash
   psqlc "SELECT status,total_amount,payment_method,group_id FROM orders WHERE id='$OID';"
   psqlc "SELECT product_name,quantity,subtotal FROM order_items WHERE order_id='$OID';"
   psqlc "SELECT status,changed_by_role FROM order_status_history WHERE order_id='$OID';"   # confirmed/customer
   psqlc "SELECT stock_qty,stock_status FROM products WHERE id='$PROD';"                      # decremented if tracked
   ```
10. **Redis Checks:** `redisc GET cart:$CUST_UID` → nil after success; present and unchanged after a rejected oversell.
11. **Queue Checks:** COD confirmed → dispatch batching (see C-E2 in Phase 2). For P0, confirm no auto-accept job for COD (auto-accept only relevant to online/`paid`).
12. **External Checks:** none for COD (no Razorpay).
13. **Cleanup:** record `$OID`/`$GID` for teardown; restore product stock if mutated: `psqlc "UPDATE products SET stock_qty=stock_qty+2 WHERE id='$PROD' AND stock_qty IS NOT NULL;"`.

---

### C-A10 · Payment (Razorpay)  *(Risk: Critical)*
1. **Test Data:** an **online** (`upi`) order in `pending_payment`.
2. **Env:** dev-mock (default) **or** sandbox. 3–4. Baseline.
5. **Procedure (create → verify):**
   ```bash
   auth "$CUST" DELETE /cart >/dev/null
   auth "$CUST" POST /cart/items "{\"productId\":\"$PROD\",\"quantity\":1}" >/dev/null
   OID=$(auth "$CUST" POST /orders "{\"cartId\":\"$(auth "$CUST" GET /cart | jq -r .cartId)\",\"addressId\":\"$ADDR\",\"paymentMethod\":\"upi\"}" | jq -r .orderId)  # cartId required (H-1)
   P=$(auth "$CUST" POST /payments/orders/$OID '{}'); echo "$P" | jq '{razorpayOrderId,amountPaise,isDev}'
   RZO=$(echo "$P" | jq -r .razorpayOrderId)
   auth "$CUST" POST /payments/verify/$OID "{\"razorpayOrderId\":\"$RZO\",\"razorpayPaymentId\":\"pay_DEV1\",\"razorpaySignature\":\"sig\"}" | jq .
   ```
   (Sandbox: complete the real test checkout, then call verify with the real signature.)
6. **Expected:** create → `isDev:true` + mock `order_DEV_…` in dev (real `order_…` in sandbox); verify → `{success:true}`; order → `paid`; second verify idempotent (`already confirmed`).
7. **Failure Signals:** order paid without valid signature **in sandbox**; multi-shop order leaves siblings unpaid; total mismatch.
8. **Logs:** `✅ Order $OID marked as paid`; `📡 Order … status → paid`; `🔔 New order alert sent to seller`. Sandbox-only: not `⚠️  Webhook signature skipped (dev mode)`.
9. **DB Checks:**
   ```bash
   psqlc "SELECT status,razorpay_order_id,razorpay_payment_id,amount_paise,captured_at FROM payments WHERE order_id='$OID';"  # captured
   psqlc "SELECT status FROM orders WHERE id='$OID';"                                            # paid
   psqlc "SELECT type,amount_paise FROM transactions WHERE reference_id='$OID' AND type='customer_payment';"  # 1 row
   ```
10. **Redis:** seller FCM token lookup `fcm:token:<sellerUserId>` (push path).
11. **Queue:** online `paid` schedules seller auto-accept → `redisc KEYS 'bull:chirawa-seller-accept:*'` shows a delayed job (jobId `auto-accept:$OID`).
12. **External:** dev → mock; sandbox → order+payment visible in Razorpay test dashboard.
13. **Cleanup:** keep `$OID` for spine; or cancel+refund in C-A13.

---

### C-E3 · Payment Webhook + Reconciliation  *(Risk: Critical)*
1. **Test Data:** (a) a `pending_payment` online order for the webhook; (b) a stale `pending_payment` order older than 30 min for reconcile.
2. **Env:** **worker running**; dev (webhook signature skipped on placeholder secret) or sandbox (real signature).
3–4. Baseline.
5. **Procedure (webhook idempotency + reconcile):**
   ```bash
   # (a) Synthetic captured webhook in dev:
   OID=$(auth "$CUST" POST /orders "{\"cartId\":\"$(auth "$CUST" GET /cart | jq -r .cartId)\",\"addressId\":\"$ADDR\",\"paymentMethod\":\"upi\"}" | jq -r .orderId)  # cartId required (H-1)
   RZO=$(auth "$CUST" POST /payments/orders/$OID '{}' | jq -r .razorpayOrderId)
   BODY='{"id":"evt_TEST1","event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_WH1","order_id":"'$RZO'","method":"upi","amount":1,"status":"captured"}}}}'
   curl -s $API/payments/webhook/razorpay -H 'content-type: application/json' -d "$BODY"     # → {received:true,processed:true}
   curl -s $API/payments/webhook/razorpay -H 'content-type: application/json' -d "$BODY"     # → processed:false (idempotent)
   # (b) Reconcile sweep (sandbox only — needs real Razorpay to poll). Backdate a stale order then:
   enqueue chirawa-reconciliation payment-reconcile
   ```
6. **Expected:** first webhook → order `paid`; duplicate (`evt_TEST1`) → `processed:false`, no double effect; reconcile (sandbox) marks a truly-captured stale order paid.
7. **Failure Signals:** duplicate webhook double-credits; transient handler error records the event (blocking retry); bad signature accepted in sandbox.
8. **Logs:** `✅ Order $OID marked as paid`; reconcile: `🔍 Reconciling N stale orders…`, `✅ Reconciled order …`, `💰 Reconciled N payments`.
9. **DB Checks:**
   ```bash
   psqlc "SELECT event_id,event_type FROM payment_webhook_events WHERE event_id='evt_TEST1';"   # exactly 1
   psqlc "SELECT status FROM orders WHERE id='$OID';"                                            # paid
   psqlc "SELECT count(*) FROM transactions WHERE reference_id='$OID' AND type='customer_payment';"  # 1 (not 2)
   ```
10. **Redis:** reconcile worker reads `fcm:token:<sellerUserId>` (direct seller push path).
11. **Queue Checks:** `redisc KEYS 'bull:chirawa-reconciliation:*'`; worker log `✅ Job completed: payment-reconcile`.
12. **External:** sandbox → Razorpay `orders.fetchPayments` polled.
13. **Cleanup:** `psqlc "DELETE FROM payment_webhook_events WHERE event_id='evt_TEST1';"`; mark test order cancelled in §E.

---

### C-B2 · Seller Accept / Reject / Prepare / Ready  *(Risk: Critical)*
1. **Test Data:** a `paid` (online) order and a fresh prepaid order for the reject-refund case.
2–4. Baseline (seller owns the order's shop).
5. **Procedure:**
   ```bash
   auth "$SELLER" POST /orders/$OID/accept '{}'      # paid → confirmed
   auth "$SELLER" POST /orders/$OID/preparing '{}'   # → preparing
   auth "$SELLER" POST /orders/$OID/ready '{}'       # → ready_for_pickup
   # Reject (separate prepaid order $OID2):
   auth "$SELLER" POST /orders/$OID2/reject '{"reason":"out of stock"}'
   ```
6. **Expected:** accept → `confirmed` + `seller_accepted_at` set; preparing/ready advance; reject → order `cancelled`, prepaid auto-refund recorded, assigned rider/batch freed.
7. **Failure Signals:** seller acts on another shop's order (should 403); accept from non-`paid|confirmed`; reject leaves payment captured.
8. **Logs:** `📡 Order … status → confirmed/preparing/ready_for_pickup`; `❌ Order … cancelled → seller …`.
9. **DB Checks:**
   ```bash
   psqlc "SELECT status, seller_accepted_at IS NOT NULL FROM orders WHERE id='$OID';"
   psqlc "SELECT status,changed_by_role FROM order_status_history WHERE order_id='$OID' ORDER BY changed_at;"
   # reject refund:
   psqlc "SELECT status,refunded_paise FROM payments WHERE order_id='$OID2';"        # refunded
   psqlc "SELECT type,amount_paise FROM transactions WHERE reference_id='$OID2' AND type='refund';"
   psqlc "SELECT rider_id,batch_id FROM orders WHERE id='$OID2';"                    # null after release
   ```
10. **Redis:** customer FCM token lookup. 11. **Queue:** reject frees any `chirawa-order-assignment` job for that order.
12. **External:** dev → `📱 [DEV FCM]`/`📨 [DEV SMS]`; sandbox → refund in Razorpay dashboard.
13. **Cleanup:** advance `$OID` through the spine; `$OID2` is terminal.

---

### C-B3 · Auto-Accept on Seller Timeout  *(Risk: High)*
1. **Test Data:** an online order that reaches `paid` with **no** seller action.
2. **Env:** API running with `SELLER_ACCEPT_MS=10000`. 3–4. Baseline.
5. **Procedure:** create+pay an online order (C-A10), then **do not** accept; wait ~12 s.
   ```bash
   redisc KEYS "bull:chirawa-seller-accept:*"     # delayed job present (jobId auto-accept:$OID)
   sleep 12
   psqlc "SELECT status, seller_accepted_at IS NOT NULL, (SELECT missed_acceptances FROM seller_profiles sp JOIN shops s ON s.seller_id=sp.id WHERE s.id=orders.shop_id) AS misses FROM orders WHERE id='$OID';"
   ```
6. **Expected:** after the window, order `confirmed`, `seller_accepted_at` set, seller `missed_acceptances` incremented by 1; COD orders (already confirmed) → no transition.
7. **Failure Signals:** order stuck `paid`; double-accept; job not deduped (two auto-accepts).
8. **Logs:** `⏱️ Order auto-accepted (seller timeout)` (API process).
9. **DB Checks:** as in procedure; `order_status_history` shows reason `Auto-accepted (no seller response)`.
10. **Redis:** `redisc ZCARD bull:chirawa-seller-accept:delayed` before; job gone after run.
11. **Queue Checks:** stable jobId `auto-accept:$OID` → exactly one job even if both API timer + reconcile produced it.
12. **External:** seller FCM (dev console). 13. **Cleanup:** advance/cancel the order.

---

### C-D7 · Admin Manual Assign + Refund  *(Risk: High)*
1. **Test Data:** a `confirmed` order with no rider; a captured-payment order for refund.
2–4. Baseline. Δ: a **rider online** in the order's zone (`PATCH /delivery/availability {"status":"online","lat":28.24,"lng":75.64}` as rider).
5. **Procedure:**
   ```bash
   auth "$RIDER" PATCH /delivery/availability '{"status":"online","lat":28.2403,"lng":75.6466}'
   auth "$ADMIN" POST /delivery/orders/$OID/assign '{}'        # manual assign
   auth "$ADMIN" POST /payments/refund/$OID2 '{"reason":"goodwill"}'  # admin refund
   ```
6. **Expected:** assign → `{assigned:true,riderId}`; order gets `rider_id`; refund → order `cancelled`, payment `refunded`, ledger row written.
7. **Failure Signals:** non-admin can call (should 403); refund without captured payment; double assign.
8. **Logs:** `🚴 Order assigned to rider …`; refund path status event.
9. **DB Checks:**
   ```bash
   psqlc "SELECT rider_id FROM orders WHERE id='$OID';"                       # set
   psqlc "SELECT is_active FROM delivery_assignments WHERE order_id='$OID';"  # true
   psqlc "SELECT status,refunded_paise FROM payments WHERE order_id='$OID2';" # refunded
   psqlc "SELECT type FROM transactions WHERE reference_id='$OID2' AND type='refund';"
   ```
10. **Redis:** rider FCM token. 11. **Queue:** n/a (direct service call). 12. **External:** sandbox → refund in dashboard.
13. **Cleanup:** order $OID continues to C5; $OID2 terminal.

---

### C-C5 · Delivery Completion + COD  *(Risk: Critical)*
1. **Test Data:** one prepaid and one COD order, each assigned to `$RIDER` and advanced to `out_for_delivery`.
2–4. Baseline. Δ: drive each order picked_up → out_for_delivery via rider endpoints first.
5. **Procedure:**
   ```bash
   auth "$RIDER" POST /delivery/orders/$OID/pickup '{}'
   auth "$RIDER" POST /delivery/orders/$OID/start-delivery '{}'
   auth "$RIDER" POST /orders/$OID/delivered '{}'                       # prepaid
   auth "$RIDER" POST /orders/$COD_OID/cod-collected '{"amountPaise":'"$COD_TOTAL"'}'   # COD
   ```
6. **Expected:** both → `delivered` + `delivered_at`; COD increments rider `cod_balance_paise` by collected amount; customer FCM + SMS, seller FCM fired; prepaid path rejects COD orders and vice-versa.
7. **Failure Signals:** non-owning rider completes (should 403); COD cash not recorded; wrong-method accepted.
8. **Logs:** `📡 Order … status → delivered`; dev `📱 [DEV FCM]` + `📨 [DEV SMS]`.
9. **DB Checks:**
   ```bash
   psqlc "SELECT status,delivered_at IS NOT NULL,cod_collected_paise FROM orders WHERE id IN ('$OID','$COD_OID');"
   psqlc "SELECT cod_balance_paise FROM rider_profiles WHERE id=(SELECT rider_id FROM orders WHERE id='$COD_OID');"
   psqlc "SELECT status,changed_by_role FROM order_status_history WHERE order_id='$OID' ORDER BY changed_at DESC LIMIT 1;"  # delivered/rider
   ```
10. **Redis:** customer/seller `fcm:token:*`. 11. **Queue:** n/a.
12. **External:** dev console FCM/SMS; sandbox SMS delivered.
13. **Cleanup:** orders terminal; note rider cod_balance delta for §E reset.

---

### C-E4 · Seller Settlement + RazorpayX Payouts  *(Risk: Critical)*
1. **Test Data:** a **delivered** order with `delivered_at` = *yesterday* for a seeded shop (one seller **with** `upi_id`, one **without**, to exercise both branches).
2. **Env:** **worker running**; dev (payout skipped) or sandbox (RazorpayX configured).
3–4. Baseline. Δ backdate a delivered order:
   ```bash
   psqlc "UPDATE orders SET delivered_at = (now() - interval '1 day') WHERE id='$OID' AND status='delivered';"
   ```
5. **Procedure:** `enqueue chirawa-settlement daily-settlement` then inspect.
   Payout reconcile branch (sandbox): `enqueue chirawa-settlement payout-reconcile`.
6. **Expected:**
   - **Dev (unconfigured):** `settlements` row created (`status:pending`, `failure_reason:"RazorpayX not configured…"`), **no** ledger `seller_settlement` transaction.
   - **No UPI seller:** `status:pending`, `needs_attention:true`, `failure_reason:"No UPI ID…"`.
   - **Sandbox processed:** `status:paid`, `payout_id` set, `upi_ref` set, ledger `seller_settlement` transaction written once.
   - Re-running is idempotent (unique `seller_id+period_date`; payoutId guard).
7. **Failure Signals:** ledger written before payout `processed`; duplicate payout on re-run; paid faked when unconfigured.
8. **Logs:** `💰 Running daily settlement for …`; one of `🧪 Payout skipped (unconfigured)…` / `⚠️  Seller … has no UPI…` / `✅ Payout processed…` / `⏳ Payout …` / `❌ Payout … flagged for admin`; re-run `↩️  Settlement … already … — skipping payout`.
9. **DB Checks:**
   ```bash
   psqlc "SELECT status,total_orders,total_product_paise,net_payable_paise,payout_id,needs_attention,failure_reason FROM settlements WHERE period_date=current_date - 1;"
   psqlc "SELECT count(*) FROM transactions WHERE reference_type='settlement' AND reference_id IN (SELECT id FROM settlements WHERE period_date=current_date-1);"  # 0 dev / 1 sandbox-processed
   ```
10. **Redis:** BullMQ only. 11. **Queue Checks:** `redisc KEYS 'bull:chirawa-settlement:*'`; worker `✅ Job completed: daily-settlement`.
12. **External Checks:** sandbox → payout visible in RazorpayX dashboard with the `idempotencyKey` = settlement id.
13. **Cleanup:** `psqlc "DELETE FROM transactions WHERE reference_type='settlement' AND reference_id IN (SELECT id FROM settlements WHERE period_date=current_date-1); DELETE FROM settlements WHERE period_date=current_date-1;"`.

---

### C-A13 · Cancel / Refund (+ Rate / Edit)  *(Risk: Critical)*
1. **Test Data:** a prepaid `confirmed` order (cancellable); a `delivered` order to rate.
2–4. Baseline.
5. **Procedure:**
   ```bash
   auth "$CUST" DELETE /orders/$OID '{"reason":"changed mind"}'         # cancel + auto-refund
   auth "$CUST" POST /orders/$DELIVERED_OID/rating '{"rating":5,"comment":"good"}'
   auth "$CUST" PATCH /orders/$EDITABLE_OID/receiver '{"name":"Asha","phone":"9000000003"}'
   ```
6. **Expected:** cancel (while `pending_payment|paid|confirmed`) → `cancelled`, prepaid auto-refund recorded, rider/batch freed, refund-specific FCM+SMS; cancel past `confirmed` → 4xx; rate only when `delivered` and once; receiver/address edit only pre-pickup.
7. **Failure Signals:** cancel allowed post-pickup; double rating; COD cancel issues Razorpay refund (should be none).
8. **Logs:** `📡 Order … status → cancelled`; `❌ Order … cancelled → seller …`; dev FCM/SMS.
9. **DB Checks:**
   ```bash
   psqlc "SELECT status,cancel_reason FROM orders WHERE id='$OID';"
   psqlc "SELECT status,refunded_paise FROM payments WHERE order_id='$OID';"     # refunded (prepaid)
   psqlc "SELECT type FROM transactions WHERE reference_id='$OID' AND type='refund';"
   psqlc "SELECT rating,rated_at IS NOT NULL FROM orders WHERE id='$DELIVERED_OID';"
   ```
10. **Redis:** customer/seller FCM tokens. 11. **Queue:** any pending assignment for $OID freed.
12. **External:** sandbox refund in Razorpay; dev console. 13. **Cleanup:** orders terminal.

---

### C-C6 · Rider Report Item Unavailable  *(Risk: Critical)*
1. **Test Data:** a `confirmed`/`preparing`/`ready_for_pickup` **multi-line** order assigned to `$RIDER`, and a **single-line** order for the cancel branch.
2–4. Baseline.
5. **Procedure:**
   ```bash
   ITEM=$(psqlc "SELECT id FROM order_items WHERE order_id='$MULTI_OID' LIMIT 1;")
   auth "$RIDER" POST /delivery/orders/$MULTI_OID/items/$ITEM/unavailable '{}' | jq '{cancelled,refundedPaise,suggestion}'
   # single-line order → whole-order cancel branch
   ITEM1=$(psqlc "SELECT id FROM order_items WHERE order_id='$SINGLE_OID' LIMIT 1;")
   auth "$RIDER" POST /delivery/orders/$SINGLE_OID/items/$ITEM1/unavailable '{}' | jq '{cancelled}'
   ```
6. **Expected:** multi-line → line refunded (prepaid) / order total reduced (COD), product flipped `out_of_stock`, optional substitute returned, order proceeds; single-line → `cancelled:true` + full refund + rider freed; report past `ready_for_pickup` → 4xx; already-reported line → 4xx.
7. **Failure Signals:** rider without active assignment succeeds (should 403); double refund; product not flipped.
8. **Logs:** `🧺 Item unavailable on order … → customer …`.
9. **DB Checks:**
   ```bash
   psqlc "SELECT fulfillment_status,refunded_paise FROM order_items WHERE id='$ITEM';"   # unavailable_refunded
   psqlc "SELECT cart_subtotal_at_pricing,total_amount FROM orders WHERE id='$MULTI_OID';"  # decremented (multi-line)
   psqlc "SELECT stock_status FROM products WHERE id=(SELECT product_id FROM order_items WHERE id='$ITEM');"  # out_of_stock
   psqlc "SELECT status FROM orders WHERE id='$SINGLE_OID';"                              # cancelled (single-line)
   ```
10. **Redis:** customer room push; `catalog:shop:<shopId>:full` invalidated. 11. **Queue:** single-line cancel frees assignment.
12. **External:** prepaid → Razorpay line refund (sandbox); COD → none. 13. **Cleanup:** restore product `stock_status='available'` if desired.

---

### C-A14 · Item-Unavailable Live Update (customer)  *(Risk: Critical)*
1. **Test Data:** customer subscribed to the order from C-C6.
2–4. Baseline. Δ: a Socket.IO client connected as the customer (token in `auth.token`) joined `order:subscribe` for `$MULTI_OID`.
5. **Procedure:** with the socket open, trigger C-C6; observe the `order:item-unavailable` event; also confirm REST fallback.
   ```bash
   auth "$CUST" GET /orders/$MULTI_OID | jq '{refund, items:[.items[]|{productName,fulfillment_status:.fulfillmentStatus,refundedPaise}]}'
   ```
6. **Expected:** socket delivers `{orderId,productName,refundedPaise,cancelled,suggestion?,timestamp}`; `GET /orders/:id` reflects the same refund + `refund` block regardless of socket delivery.
7. **Failure Signals:** event leaks to other users' rooms; refund not visible via REST when socket missed.
8. **Logs:** `🧺 Item unavailable on order …`; socket connect `🔌 Socket connected: <custUserId> (customer)`.
9. **DB Checks:** same rows as C-C6 (this is the read/notify side).
10. **Redis:** event published on `chirawa:events:v1`; multi-instance fan-out via Socket.IO adapter.
11. **Queue:** n/a. 12. **External:** none.
13. **Cleanup:** disconnect socket.

---

### C-E12 · Promotions  *(Risk: High)*
1. **Test Data:** the fresh customer (first-time → FIRSTORDER eligible); an explicit promo code from seed/DB; a code below min-cart.
2–4. Baseline. Discover a code: `psqlc "SELECT code,type,value_paise,min_cart_paise,max_uses_per_user FROM promo_codes WHERE is_active LIMIT 5;"`.
5. **Procedure:**
   ```bash
   CART=$(auth "$CUST" GET /cart | jq -r .cartId)
   auth "$CUST" POST /pricing/preview "{\"cartId\":\"$CART\",\"addressId\":\"$ADDR\"}" | jq '{discount,appliedPromoCode,promoError}'        # FIRSTORDER auto
   auth "$CUST" POST /pricing/preview "{\"cartId\":\"$CART\",\"addressId\":\"$ADDR\",\"promoCode\":\"$CODE\"}" | jq '{discount,appliedPromoCode,promoError}'
   # then place order with promo and re-check (second use should be blocked)
   ```
6. **Expected:** first-time customer auto-gets `FIRSTORDER` (free delivery → discount = fee); valid code → clamped discount in [0, subtotal+fee]; below min-cart / expired / exhausted / 2nd per-user use → `promoError` populated, checkout still renders; on order, `promo_redemptions` row + `current_uses` incremented.
7. **Failure Signals:** discount makes total negative; per-user cap bypassed; promo applied to a non-first-time customer.
8. **Logs:** none specific (validation path).
9. **DB Checks:**
   ```bash
   psqlc "SELECT discount,promo_code_id FROM orders WHERE id='$OID';"
   psqlc "SELECT count(*) FROM promo_redemptions WHERE order_id='$OID';"            # 1
   psqlc "SELECT current_uses FROM promo_codes WHERE code='$CODE';"                 # incremented
   ```
10. **Redis:** reads cart. 11. **Queue/12. External:** n/a.
13. **Cleanup:** if not placing the order, just clear cart; else order goes to teardown.

---

### C-E13 · COD Float Cap  *(Risk: High — verify documented state)*
1. **Test Data:** the rider's current `cod_balance_paise`; `COD_FLOAT_CAP_PAISE` (₹2000 default).
2–4. Baseline.
5. **Procedure:** drive the rider's COD balance toward/over the cap by completing COD orders (C-C5), and attempt placing/accepting/assigning further COD orders.
   ```bash
   psqlc "SELECT cod_balance_paise FROM rider_profiles WHERE id='$RIDER_PID';"
   # complete enough COD orders to exceed 200000 paise, then place another COD order to the same rider
   ```
6. **Expected (documents current behaviour):** COD orders continue to be placeable/assignable/collectable **with no enforced cap block** — confirms `COD_FLOAT_CAP_PAISE` is configured but not enforced in the COD path (per `FEATURE_VERIFICATION_MATRIX` E13). Record the observed `cod_balance_paise` exceeding the cap.
7. **Failure Signals (relative to documented state):** an *unexpected* enforcement block appears (would mean the documented state changed), or the COD balance fails to accumulate.
8. **Logs:** none cap-specific.
9. **DB Checks:** `psqlc "SELECT cod_balance_paise FROM rider_profiles WHERE id='$RIDER_PID';"` rises past cap.
10. **Redis/11. Queue/12. External:** n/a.
13. **Cleanup:** reset balance in §E.

---

### C-E8 · Referral Credit Unlock  *(Risk: Low — verify inert)*
1. **Test Data:** a new customer signed up **with a referral code**, completing their first delivery.
2–4. Baseline. Δ: sign up `9000000004` passing `referralCode` of an existing user; complete one delivery for them.
5. **Procedure:**
   ```bash
   N=$(curl -s $API/auth/verify-otp -d '{"phone":"9000000004","otp":"123456","referralCode":"'"$EXISTING_CODE"'"}' -H 'content-type: application/json')
   # …place + deliver this customer's first order via the spine…
   redisc KEYS "bull:chirawa-referral:*"
   ```
6. **Expected (documents current behaviour):** referral **redemption row** is created at signup, but on first delivery **no** `unlock-referral` job is enqueued and **no** wallet/credit is granted — confirms the producer (`enqueueReferralUnlock`) only logs (per `FEATURE_VERIFICATION_MATRIX` E8). `referee_credit_status`/`referrer_credit_status` stay `pending`.
7. **Failure Signals (relative to documented state):** credits *are* granted (would mean producer reconnected), or no redemption row at signup.
8. **Logs:** **absence** of `🎁 Referral unlocked…`; `[Referral] Unlock queued for order …` may appear (log-only, no enqueue).
9. **DB Checks:**
   ```bash
   psqlc "SELECT referrer_credit_status,referee_credit_status FROM referral_redemptions WHERE referred_user_id=(SELECT id FROM users WHERE phone='9000000004');"  # pending/pending
   psqlc "SELECT wallet_balance FROM customer_profiles WHERE user_id=(SELECT id FROM users WHERE phone='9000000004');"   # 0
   psqlc "SELECT count(*) FROM wallet_transactions WHERE user_id=(SELECT id FROM users WHERE phone='9000000004');"       # 0
   ```
10. **Redis:** no `bull:chirawa-referral:*` job created. 11. **Queue:** `chirawa-referral` idle.
12. **External:** none. 13. **Cleanup:** `psqlc "DELETE FROM users WHERE phone='9000000004';"`.

---

## D. Release-Gate Checklist

Run §C in this order; mark each. A release is gated on **all P0 = PASS** (E8/E13 PASS = documented
inert/unenforced state observed).

| # | Feature | PASS/FAIL | Evidence (order id / settlement id / log line) |
|---|---|---|---|
| 1 | C-A1 OTP Login & Signup | ☐ | |
| 2 | C-B1 Seller PIN Login | ☐ | |
| 3 | C-C1 Rider PIN Login | ☐ | |
| 4 | C-E1 Order State Machine | ☐ | |
| 5 | C-E11 Fee / Pricing | ☐ | |
| 6 | C-A9 Checkout & Order Creation | ☐ | |
| 7 | C-A10 Payment | ☐ | |
| 8 | C-E3 Webhook + Reconciliation | ☐ | |
| 9 | C-B2 Seller Accept/Reject/Prepare/Ready | ☐ | |
| 10 | C-B3 Auto-Accept on Timeout | ☐ | |
| 11 | C-D7 Admin Manual Assign + Refund | ☐ | |
| 12 | C-C5 Delivery Completion + COD | ☐ | |
| 13 | C-E4 Settlement + Payouts | ☐ | |
| 14 | C-A13 Cancel / Refund / Rate / Edit | ☐ | |
| 15 | C-C6 Rider Report Item Unavailable | ☐ | |
| 16 | C-A14 Item-Unavailable Live (customer) | ☐ | |
| 17 | C-E12 Promotions | ☐ | |
| 18 | C-E13 COD Float Cap (verify unenforced) | ☐ | |
| 19 | C-E8 Referral Unlock (verify inert) | ☐ | |

**Gate prerequisites (before the table):**
```bash
bash scripts/harness/00_preflight.sh        # isolation guard + IST-hours + health/ready + otp-clear
ROOT="${API%/api/v1}"
curl -s "$ROOT/health" | jq .status         # ok   (root path, not under /api/v1)
curl -s "$ROOT/ready"  | jq '.checks'        # {database:true, redis:true}
# Worker up (logs): "🔧 Chirawa Worker started" + "✅ All job schedules configured"
# Realtime up (logs): "⚡ Socket.io real-time server ready" + "🔔 Notification service ready"
# Dispatch up (logs): "🛵 Dispatch (batched auto-assignment) ready" + "⏱️ Seller acceptance-timeout watcher ready"
```

---

## E. Global Cleanup / Reset

Canonical teardown (**F7** — replaces the old, FK-unsafe blanket inline version):
```bash
bash scripts/harness/99_cleanup.sh          # ordered child→parent, harness-scoped, FK-safe
```
What it does (all `WHERE`-scoped to harness customers `9000000001/002/004`; re-asserts the isolation
guard first): deletes `order_status_history → order_items → payments → delivery_assignments →
promo_redemptions → transactions(by order) → orders → order_groups → empty batches →
payment_webhook_events(`evt_TEST%`/`evt_HARNESS%`) → referral_redemptions(dropped users) → addresses`,
then drops users `…002/…004` (keeps `…001`); resets rider `cod_balance_paise`; and deletes only the
harness Redis keys (`cart:*`, `fcm:token:*`, `rider:*`, `otp:*:90000000*`) — **never** `FLUSHALL` or
blanket `bull:*`. Full reset alternative (non-prod only): `pnpm --filter @chirawa/api db:reset && db:seed`.

> **Note (Phase 0B):** post-cleanup "clean slate" assertions (F21) and the scoped-by-known-id
> settlement cleanup (F12) are Phase 0B; the F7 script above is the Phase 0A teardown.

**Idempotency of the harness itself:** `gen_id` now emits per-run-unique payment/event ids (F14), so a
prior run's cleanup leaves a clean slate; the settlement unique key (`seller_id+period_date`) and
webhook `event_id` make repeats safe.

---

*Scope note: this document defines runtime verification only — it does not fix, audit, or
propose changes to any feature.*
