# P0_VERIFICATION_RESULTS.md

> Phase 1 runtime verification of the 19 P0 features, run against a **freshly-provisioned,
> isolated harness environment**. Discovery only — no fixes applied.
> Run timestamp: **2026-06-19 ~23:00–23:19 IST**. Mode: **dev-mock** (money blocks NON-GATING, F1).

---

## Run environment (provisioned for this run — dev DB never touched)

The only running stack was the **shared dev** stack (`chirawa_development`, 113 orders) — which the
Phase 0A F8 guard correctly refuses. So an isolated stack was provisioned:

| Resource | Value |
|---|---|
| Harness DB | `chirawa_harness` (Postgres, separate from `chirawa_development`) — 26 migrations, 49 tables, seeded (6 shops, 247 products, 6 sellers, 3 riders, 1 admin, FeeRule v1, FIRSTORDER) |
| Harness Redis | separate instance `chirawa_redis_harness` on `:6380` (avoids pub/sub cross-talk with dev) |
| Harness API | dedicated `tsx src/index.ts` on `:3100` → harness DB+Redis (`/ready` = db+redis true) |
| Harness worker | dedicated worker → harness DB+Redis (all 6 workers + schedules ready) |
| Isolation | branded via `00_preflight.sh --init`; preflight passes (marker, orders=0, hosts loopback) |
| Verified | **dev DB unchanged** (113 orders before and after migrate/seed) |

> ⚠ The harness stack (`:3100` API, worker, `:6380` redis, `chirawa_harness` DB) is **still running**
> for a within-hours re-run. Teardown commands in §Teardown.

---

## ⛔ Two blocking conditions discovered (cause of all NOT VERIFIED)

### BLOCK-1 — Operating-hours gate (`SHOP_CLOSED`) — environmental, not a defect
The run is at **~23:00 IST**, outside the app's **9 AM–8 PM IST** window. `placeOrder` calls
`isWithinOperatingHours()` (Asia/Kolkata, TZ-independent — `shared/config/operating-hours.ts`) and
rejects every `POST /orders` with **`422 SHOP_CLOSED`**. **Verified live:**
`{"code":"SHOP_CLOSED","message":"We deliver 9 AM – 8 PM. Place your order tomorrow!"}`, 0 orders created,
cart left intact. Because the entire money/fulfilment spine begins with order creation, **13 features
that require a live order could not be exercised.** This is the exact F5 scenario the Phase 0A
hours-guard anticipated. Re-run within 9 AM–8 PM IST to clear it.

### BLOCK-2 — Harness defect: `mk_order` / doc order payload omits required `cartId` (Severity: High)
`placeOrderSchema` (`orders.schema.ts`) **requires `cartId` (uuid)**, but `scripts/harness/10_fixtures.sh`
`mk_order` and the harness doc send only `{addressId, paymentMethod}` → every `POST /orders` returns
**`400 VALIDATION_ERROR "Required"`**. This would block the entire order spine **even during open hours**.
Discovered live (first A9 attempt 400'd; adding `cartId` reached the real `SHOP_CLOSED` gate). Not fixed
(discovery only). Must be fixed before a within-hours re-run can verify the spine.

---

## Results summary

| # | Feature | Result | Severity (of blocker/finding) |
|---|---|---|---|
| 1 | C-A1 OTP Login & Signup | **PASS** | — |
| 2 | C-B1 Seller PIN Login | **PASS** | — |
| 3 | C-C1 Rider PIN Login | **PASS** | — |
| 4 | C-E11 Fee / Pricing | **PASS** | — |
| 5 | C-A9 Checkout & Order Creation | **NOT VERIFIED** (edge passed) | Env (BLOCK-1) + High (BLOCK-2) |
| 6 | C-A10 Payment | **NOT VERIFIED** | Env (BLOCK-1); dev-mock NON-GATING (F1) |
| 7 | C-E1 Order State Machine | **NOT VERIFIED** | Env (BLOCK-1/2) |
| 8 | C-E3 Webhook + Reconciliation | **NOT VERIFIED** | Env (BLOCK-1); dev-mock NON-GATING |
| 9 | C-E4 Settlement + Payouts | **NOT VERIFIED** | Env (BLOCK-1); needs sandbox + delivered orders |
| 10 | C-E12 Promotions | **NOT VERIFIED** (preview passed) | Env (BLOCK-1/2) |
| 11 | C-E13 COD Float Cap | **NOT VERIFIED** | Env (BLOCK-1/2) |
| 12 | C-E8 Referral Unlock (inert) | **NOT VERIFIED** (signup half passed) | Env (BLOCK-1/2) |
| 13 | C-A13 Cancel / Refund / Rate / Edit | **NOT VERIFIED** | Env (BLOCK-1/2) |
| 14 | C-A14 Item-Unavailable Live | **NOT VERIFIED** | Env (BLOCK-1/2) |
| 15 | C-B2 Seller Accept/Reject/Prepare/Ready | **NOT VERIFIED** | Env (BLOCK-1/2) |
| 16 | C-B3 Auto-Accept on Timeout | **NOT VERIFIED** | Env (BLOCK-1/2) |
| 17 | C-C5 Delivery Completion + COD | **NOT VERIFIED** | Env (BLOCK-1/2) |
| 18 | C-C6 Rider Report Item Unavailable | **NOT VERIFIED** | Env (BLOCK-1/2) |
| 19 | C-D7 Admin Manual Assign + Refund | **NOT VERIFIED** | Env (BLOCK-1/2) |

**Tally: 4 PASS · 0 FAIL · 15 NOT VERIFIED.** No feature *defect* was found; the 15 NOT VERIFIED are
blocked by the operating-hours gate (env) and the harness `cartId` defect (BLOCK-2), not by failing app logic.

---

## Per-feature detail

### 1. C-A1 — OTP Login & Signup — **PASS**
- **Evidence:** send-otp→200 (`🔐 DEV OTP for 9000000001: 994182`); wrong OTP `000000`→`400 "Galat OTP. 4 aur try baaki hain."`; verify `123456`→200 `{isNewUser:true, role:"customer", requiresPin:false, hasAccess:true}`; refresh→200; **reuse old refresh→`401 "Security alert: session compromised."`**. DB: `users.role=customer`, `customer_profiles`=1, `referral_codes`=1, `refresh_tokens` total=2/revoked=2 (theft-detection revoked all). Redis: `otp:rate:ip1h:127.0.0.1` present.
- **Failure reason:** none.
- **Severity:** —.
- **Reproduction:** `curl :3100/api/v1/auth/{send-otp,verify-otp,refresh}` as above.
- **Notes (dev-bypass nuances, not failures):** the `123456` bypass returns before (a) writing the success `otp_attempts` row and (b) deleting `otp:data` — so `otp_attempts.success=0` and `otp:data` persists (5-min TTL). Both would differ in sandbox/prod.

### 2. C-B1 — Seller PIN Login — **PASS**
- **Evidence:** verify-otp `9001110001`→200 `role:"seller"`; `set-pin`→`200 "PIN set ho gaya"`; DB `seller_profiles.pin_hash` set (bcrypt `$2a$…`).
- **Failure reason:** none. **Severity:** —.
- **Reproduction:** verify-otp seller phone, then `POST /auth/set-pin {pin,confirmPin}`.
- **Notes:** `requiresPin:false` on first login — the seed pre-seeds seller PINs (seed detail). PIN *verification + 5-fail lockout* has **no server route** (set-pin is the only PIN endpoint; verify is app-side) → that sub-behavior is NOT VERIFIED at the API tier.

### 3. C-C1 — Rider PIN Login — **PASS**
- **Evidence:** verify-otp `7700110001`→200 `role:"rider", requiresPin:true`; `set-pin`→200; DB `rider_profiles.pin_hash` set.
- **Failure reason:** none. **Severity:** —. **Reproduction:** as B1 with a rider phone.

### 4. C-E11 — Fee / Pricing — **PASS**
- **Evidence (via `POST /pricing/preview`):** cart ₹15 (<₹100)→`deliveryFee 2500`; cart ₹105 (≥₹100, non-featured)→`1000`; cart ₹180 (featured/Special)→`1500`, `hasSpecialShop:true`; `feeRuleVersion`=1; totals reconcile (`subtotal+fee−discount`).
- **Failure reason:** none. **Severity:** —.
- **Reproduction:** add product to cart, `POST /pricing/preview {cartId,addressId}`; vary cart size + featured shop.

### 5. C-A9 — Checkout & Order Creation — **NOT VERIFIED** (edge passed)
- **Evidence (edge, PASS):** `POST /orders` (with `cartId`) → **`422 SHOP_CLOSED`**, 0 orders, cart intact — operating-hours rejection verified.
- **Failure reason (why core unverified):** BLOCK-1 (hours gate) prevents the happy path now; BLOCK-2 (`mk_order` missing `cartId`) would block it regardless. **Discovered:** schema requires `cartId` (first attempt 400'd on it).
- **Severity:** High (BLOCK-2 harness defect) + Env (BLOCK-1).
- **Reproduction:** fix `mk_order` to include `cartId`; re-run 9 AM–8 PM IST; expect order `confirmed` (COD), group split, stock decrement, cart cleared.

### 6. C-A10 — Payment — **NOT VERIFIED**
- **Evidence:** none captured (needs a `pending_payment` order → BLOCK-1/2). Also dev-mock bypasses signature verification (F1) → would be NON-GATING even if run.
- **Severity:** Env + (sandbox required to truly gate). **Reproduction:** within hours + `HARNESS_MODE=sandbox`, create+pay an `upi` order.

### 7. C-E1 — Order State Machine — **NOT VERIFIED**
- **Evidence:** none (illegal-transition test needs a real `paid`/`confirmed` order → BLOCK-1/2). Supplementary code-level check available (`order-transitions.test.ts`) but runtime unverified.
- **Reproduction:** within hours, `mk_order upi paid`, then attempt `POST /orders/:id/ready` → expect `Illegal order transition`.

### 8. C-E3 — Webhook + Reconciliation — **NOT VERIFIED**
- **Evidence:** none (needs an order; webhook idempotency + reconcile sweep). Dev-mock skips webhook signature (F1).
- **Reproduction:** within hours + sandbox; synthetic captured webhook ×2 (idempotency) + backdated stale order + `enqueue chirawa-reconciliation payment-reconcile`.

### 9. C-E4 — Settlement + Payouts — **NOT VERIFIED**
- **Evidence:** none (needs delivered orders dated yesterday + RazorpayX sandbox). Worker is up and ready (`✅ All job schedules configured`).
- **Reproduction:** within hours + sandbox; deliver an order, backdate `delivered_at`, `enqueue chirawa-settlement single-seller-settle`.

### 10. C-E12 — Promotions — **NOT VERIFIED** (preview passed)
- **Evidence (preview, PASS):** FIRSTORDER **auto-applies for the first-time customer** above min-cart — band1 (₹15) → no promo (below min); bands 2/3 → `appliedPromoCode:"FIRSTORDER"`, `discount == deliveryFee` (free delivery), clamped (total never negative).
- **Failure reason (core unverified):** redemption persistence (`promo_redemptions` row + `current_uses` increment) needs a real order → BLOCK-1/2.
- **Reproduction:** within hours, place an order with FIRSTORDER; assert `promo_redemptions`=1 + `current_uses` incremented.

### 11. C-E13 — COD Float Cap — **NOT VERIFIED**
- **Evidence:** none (needs COD orders + delivery to accumulate `cod_balance_paise` past the cap → BLOCK-1/2). Intent is to *confirm unenforced*.
- **Reproduction:** within hours, complete COD deliveries past ₹2000 cap; confirm no enforcement block.

### 12. C-E8 — Referral Unlock (inert) — **NOT VERIFIED** (signup half passed)
- **Evidence (signup-inert, PASS):** signup `9000000004` with code `XJ5L88` → `referral_redemptions` = `pending/pending`, referred `wallet_balance`=0, `wallet_transactions`=0, no "Referral unlocked" log.
- **Failure reason (core unverified):** the documented inert state on *first delivery* (no credit granted) needs a delivered order → BLOCK-1/2.
- **Reproduction:** within hours, deliver the referred user's first order; confirm still `pending/pending`, wallet still 0.

### 13. C-A13 — Cancel / Refund / Rate / Edit — **NOT VERIFIED**
- **Evidence:** none (needs an order to cancel/rate/edit → BLOCK-1/2). Dev-mock would not move real refund money (F1).
- **Reproduction:** within hours + sandbox; cancel a prepaid order → assert refund + `cancelled`.

### 14. C-A14 — Item-Unavailable Live (customer) — **NOT VERIFIED**
- **Evidence:** none (depends on C6 against a live order; also no socket observer in Phase 0A — F11). **Reproduction:** within hours, trigger C6 + observe `order:item-unavailable` socket / `GET /orders/:id` refund block.

### 15. C-B2 — Seller Accept/Reject/Prepare/Ready — **NOT VERIFIED**
- **Evidence:** none (needs a live order → BLOCK-1/2). **Reproduction:** within hours, `mk_order upi paid` → accept→preparing→ready; separate order → reject → cancel+refund (sandbox).

### 16. C-B3 — Auto-Accept on Timeout — **NOT VERIFIED**
- **Evidence:** none (needs a paid order + `SELLER_ACCEPT_MS` wait → BLOCK-1/2). Env knob already set (`SELLER_ACCEPT_MS=8000`). **Reproduction:** within hours, pay an order, wait, assert `confirmed` + `seller_accepted_at` + `missed_acceptances`+1 (exactly).

### 17. C-C5 — Delivery Completion + COD — **NOT VERIFIED**
- **Evidence:** none (needs an order assigned + advanced to out-for-delivery → BLOCK-1/2). **Reproduction:** within hours, drive an order to `out_for_delivery`, `cod-collected`/`delivered`; assert `cod_balance_paise` delta == total.

### 18. C-C6 — Rider Report Item Unavailable — **NOT VERIFIED**
- **Evidence:** none (needs a live assigned order → BLOCK-1/2). **Reproduction:** within hours + sandbox, report a line unavailable; assert line refund / order cancel + product out_of_stock.

### 19. C-D7 — Admin Manual Assign + Refund — **NOT VERIFIED**
- **Evidence:** none (needs a confirmed order + captured payment → BLOCK-1/2). Admin account exists (`9999900001`). **Reproduction:** within hours + sandbox, `POST /delivery/orders/:id/assign` (admin), `POST /payments/refund/:id`.

---

## Harness defects discovered this run (for review — not fixed)

| ID | Defect | Severity | Impact |
|---|---|---|---|
| H-1 | `mk_order` (`10_fixtures.sh`) + harness doc `POST /orders` payload omit required **`cartId`** | **High** | Blocks the **entire** order spine with `400 VALIDATION_ERROR` even during open hours |
| H-2 | `negatives.sh` webhook-signature case only runs in sandbox; dev-mock can't verify signature controls | Medium | Known (F1/F2) — money-control negatives need sandbox |

(Note: the 4 PASS features exercised auth + pricing helpers; H-1 only affects the order-creation path.)

---

## Teardown (when review is done)
```bash
# stop the two background processes (harness API + worker) via your runner, then:
docker rm -f chirawa_redis_harness
docker exec -i chirawa_postgres psql -U chirawa -d postgres -c "DROP DATABASE IF EXISTS chirawa_harness;"
```
Dev stack (`chirawa_development`, `:3000`, `:6379`) is untouched.

---

## Conclusion
Auth (A1/B1/C1) and pricing/promo-preview (E11, E12-preview) are **runtime-verified PASS** against the
isolated environment. The 15 order-dependent P0 features are **NOT VERIFIED**, blocked by (1) the real
operating-hours gate at 23:00 IST and (2) harness defect **H-1** (missing `cartId`). No app-feature
defect was found. **Recommended next step (on review): fix H-1, then re-run the spine within
9 AM–8 PM IST (sandbox mode for the money blocks).** Stopping here for review as instructed.
