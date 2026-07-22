# HARNESS_GAP_ANALYSIS.md

> **HARNESS_READINESS_REVIEW** of the verification harness itself — a meta-audit of
> `RUNTIME_VERIFICATION_HARNESS.md` against `FEATURE_VERIFICATION_MATRIX.md` and
> `PHASED_VERIFICATION_PLAN.md`. The subject under review is the **harness**, not the
> application. No tests were executed; no application code is changed or proposed for change.
> Every "Exact improvement" is a change to the *verification harness*.
>
> Code facts cited below were confirmed by reading the source (file:line given).

## Severity legend
- **Critical** — the harness can report PASS while a P0 feature is actually broken (false green that ships).
- **High** — the harness corrupts its own run, blocks the suite for non-feature reasons, or leaves a P0 path unverified.
- **Medium** — a real gap that weakens confidence or produces ambiguous results.
- **Low** — hygiene / fragility that should be tightened.

## Executive summary
25 findings: **2 Critical · 12 High · 8 Medium · 3 Low**.

The single most important conclusion: **as written, the harness's default "dev-mock mode" cannot
verify the core property of any P0 money feature** — that money actually moves and that
signatures/authorization are enforced. In dev-mock, payment signature checks, webhook signature
checks, Razorpay refunds, and RazorpayX payouts are all **bypassed or skipped by the application's
own dev fallbacks**, so the harness's DB assertions (`payments.status='refunded'`, order `paid`,
settlement row created) pass by writing rows without the real external call ever happening
(F1, F2). Several other findings (rate-limit self-DoS F3, token expiry F4, operating-hours
time-dependency F5, shared-`$OID` threading F6, unsafe cleanup F7, missing FCM-token fixture F10,
unobserved socket emissions F11) mean the harness in its current form will either **block on
itself** or **pass features it never actually exercised**.

**Readiness verdict:** _Not yet release-gating._ The Critical + the run-integrity High findings
(F3, F4, F5, F6, F7, F8, F14) must be closed before the harness can be trusted as a release gate.

---

## Group A — Critical correctness (harness can go green while broken)

### F1 — Default "dev-mock mode" structurally cannot verify money movement or signature enforcement
- **Severity:** Critical
- **Affected:** C-A10, C-E3, C-A13, C-B2 (reject-refund), C-C6, C-D7, C-E4
- **Why insufficient:** The harness defaults to dev-mock (`§B.1`), where the app's own fallbacks neutralize the very controls these P0 blocks claim to verify:
  - `verifyClientPayment` only checks the signature `if (isRazorpayConfigured() && …)` — so with placeholder keys the signature is **never validated** (`payments.service.ts:94`). C-A10's verify step passes with the literal dummy `"sig"`/`"pay_DEV1"`.
  - `verifyWebhookSignature` returns `true` whenever the secret contains `placeholder` (`razorpay.service.ts:65`). C-E3's synthetic webhook is accepted with no real signature.
  - All refunds call Razorpay only `if (isRazorpayConfigured())` (`payments.service.ts:157,232,275`). In dev-mock, C-A13/C-B2/C-C6/C-D7 write `payments.refunded_paise` / `transactions(type='refund')` **without any refund actually occurring**.
  - `isPayoutConfigured()` is false in dev (`razorpay.service.ts:114`) → C-E4 hits the `🧪 Payout skipped (unconfigured)` branch and the harness even *expects* "no ledger transaction." The RazorpayX fund-account creation, payout, idempotency-key, and ledger-on-`processed` logic are **never exercised**.
  - The harness's "Expected Result" conflates *"a DB row was written"* with *"the feature works"*. A release in which the real Razorpay/RazorpayX integration is broken passes every dev-mock block.
- **Exact improvement:** Make **sandbox mode the release gate** for all seven features above (real Razorpay test keys + RazorpayX sandbox + webhook tunnel + real refund/payout). Label dev-mock blocks "SMOKE — NON-GATING" in §D. In sandbox, add positive *external* assertions the harness currently lacks: payment/refund/payout objects visible in the Razorpay/RazorpayX dashboards with the expected `amount`, `notes`, and `idempotency key`, and `settlements.upi_ref`/`payout_id` populated only after status `processed`.
- **Expected impact:** Converts the money-critical blocks from "DB-row theatre" into genuine money-movement verification; removes the largest class of false-green in the suite.

### F2 — No negative / rejection assertions (signatures, permissions) → "passes while broken"
- **Severity:** Critical
- **Affected:** C-A10, C-E3 (signatures); C-B2, C-C5, C-C6, C-D7, C-A13 (authorization)
- **Why insufficient:** Every block tests only *valid input → success*. A control that always returns "valid" (e.g., a `verifyPaymentSignature`/`verifyWebhookSignature` that returned `true` unconditionally, or a missing ownership guard) would pass **100%** of the current harness. The matrix lists these as Permission/Failure cases, but the harness encodes none of them as executable assertions. You cannot detect "bad input also succeeds" with only good-input tests.
- **Exact improvement:** Add explicit negative cases with asserted rejections, e.g.: (a) sandbox webhook with a deliberately wrong `x-razorpay-signature` → expect 4xx `AuthenticationError`; (b) `verify/:orderId` with a tampered signature → expect `PaymentError`; (c) seller B accepting shop-A's order → expect 403; (d) rider Y completing rider X's delivery → expect 403; (e) non-admin calling `/payments/refund/:id` and `/delivery/.../assign` → expect 403; (f) replayed `razorpay_payment_id` → expect no second capture.
- **Expected impact:** Catches silent failures of the highest-consequence controls (forged payments, broken authorization) that the happy-path suite is blind to.

---

## Group B — Run integrity / self-corruption (harness breaks itself)

### F3 — OTP rate limits will throttle the harness's own logins and cascade-fail every block
- **Severity:** High
- **Affected:** all blocks (every one depends on a token from `login()`)
- **Why insufficient:** `login()` (`§B.4`) calls `POST /auth/send-otp` on every invocation. `sendOtp` enforces **per-phone 3/hour, 10/day, per-IP 20/hour** (`otp.service.ts:39-53`) plus a route limit of 10/min (`auth.routes.ts`). A full run logs in customer/seller/rider/admin repeatedly from one IP (localhost); a re-run within the hour compounds it. The **per-IP 20/hour** cap trips, `login()` throws "Bahut zyada requests", tokens come back empty, and **all downstream blocks fail for a harness-internal reason** — a self-inflicted false negative. Note the dev bypass `123456` short-circuits `verifyOtp` *before* the stored OTP check (`otp.service.ts:101`), so `send-otp` is unnecessary in dev yet still burns the budget.
- **Exact improvement:** In dev mode, drop the `send-otp` call from `login()` (verify-otp with `123456` works standalone). Add a baseline step that clears OTP rate keys before the run: `redisc --scan --pattern 'otp:rate:*' | xargs -r redisc DEL`. For sandbox, distribute logins across distinct phones/IPs and capture tokens **once** into vars rather than re-calling `login()` per block.
- **Expected impact:** Removes a guaranteed mid-run failure on the second+ harness execution; makes the suite re-runnable.

### F4 — 15-minute access tokens expire mid-run; the `auth()` helper never refreshes
- **Severity:** High
- **Affected:** all blocks after ~15 minutes (C-B3 waits ~12 s; C-E4 backdates + enqueues; a full run easily exceeds 15 min)
- **Why insufficient:** `JWT_ACCESS_EXPIRES_IN=15m` (`env.schema.ts:37`). The harness captures `$CUST/$SELLER/$RIDER/$ADMIN` once in `§B.5` and the `auth()` helper has **no refresh-on-401** (unlike the real app clients). Long blocks (auto-accept wait, settlement enqueue, multi-step spine) outlive the token, so later calls 401 and blocks fail spuriously.
- **Exact improvement:** Either (a) wrap `auth()` to refresh on 401 using the stored refresh token (mirroring the app client), or (b) re-`login` at the top of each major section, or (c) set a harness-only `JWT_ACCESS_EXPIRES_IN=8h` in the API env for the run (documented as a harness setting). Prefer (a) so token-refresh itself stays exercised.
- **Expected impact:** Eliminates time-driven false negatives in long runs.

### F5 — Operating-hours gate makes the entire order spine time-of-day dependent
- **Severity:** High
- **Affected:** C-A9, C-A10, C-E3, C-B2, C-B3, C-D7, C-C5, C-C6, C-A14, C-E12 (anything that creates an order)
- **Why insufficient:** `placeOrder` throws 422 `SHOP_CLOSED` outside **9 AM – 8 PM IST** (`orders.service.ts:143`, `operating-hours.ts:25,31`). The harness uses real `POST /orders` as the happy path for ~12 blocks but provides no time override. Run in CI at night IST (or a UTC CI box after 14:30 UTC), **every order-creation block fails for a non-feature reason**, collapsing the spine.
- **Exact improvement:** Document the IST 9 AM–8 PM window as a hard harness precondition and add a pre-flight guard that aborts with a clear message if outside it; or run the suite inside the window; or pin a fixed clock for the harness environment. State explicitly which approach the release process uses.
- **Expected impact:** Prevents a whole-suite false failure that looks like a product outage but is a clock artifact.

### F14 — Hard-coded `razorpay_payment_id` / `event_id` collide with their UNIQUE constraints on re-run
- **Severity:** High
- **Affected:** C-A10 (`pay_DEV1`), C-E3 (`evt_TEST1`, `pay_WH1`)
- **Why insufficient:** `Payment.razorpayPaymentId` and `PaymentWebhookEvent.eventId` are `@unique`. The harness reuses constant ids. If a prior run's rows survive (and cleanup is itself buggy — see F7), `markOrderPaid`'s `updateMany{… razorpayPaymentId:'pay_DEV1'}` violates the unique constraint, the transaction throws, the order is **not** marked paid, and the block false-fails on re-run. Re-runnability is asserted in `§E` but not actually guaranteed.
- **Exact improvement:** Generate per-run-unique ids in the harness (e.g., `PID="pay_DEV_$(date +%s)_$RANDOM"`, `EVT="evt_TEST_$(date +%s)"`) and thread them through the curl bodies and the cleanup `LIKE` patterns.
- **Expected impact:** Makes the payment/webhook blocks deterministically re-runnable independent of cleanup state.

### F18 — Fixture-existence is never guarded; empty `LIMIT 1` lookups silently produce malformed requests
- **Severity:** Medium
- **Affected:** C-E11 (featured-shop product), C-A9 (numeric-stock product, multi-shop), C-C6 (multi-line + single-line order), C-E12 (active promo code)
- **Why insufficient:** Blocks do `read VAR < <(psqlc "… LIMIT 1")`. If the seed lacks (say) a featured-shop product or a `stock_qty`-tracked product, the var is empty, the curl body is malformed, the API returns 400/404, and the operator may misread that as a feature failure — or, worse, mark PASS because "something returned." There is no "fixture missing → SKIP with reason" path.
- **Exact improvement:** Add a precondition guard per fixture: if the SQL returns empty, **fail the block as `BLOCKED: fixture missing`** (not PASS, not feature-FAIL) and print the SQL that returned nothing. Seed the required fixtures explicitly in `§B.3` (a featured shop, a numeric-stock product, a multi-line and a single-line orderable cart).
- **Expected impact:** Distinguishes "feature broken" from "test data missing"; removes ambiguous results.

---

## Group C — Hidden dependencies & shared mutable state

### F6 — A single `$OID`/`$RIDER`/`$CUST` is threaded across blocks with no status contract → ordering-dependent pass/fail
- **Severity:** High
- **Affected:** C-E1, C-B2, C-B3, C-D7, C-C5, C-C6, C-A13 (the whole spine)
- **Why insufficient:** The "money spine" reuses one order/rider/customer across blocks, but each block assumes a *specific* prior status without pinning which order is at which state. Concrete failure modes:
  - **C-E1** attempts `paid → ready_for_pickup` as the illegal transition (`sellerMarkReady` → `assertTransition`, `orders.service.ts:92-98`). If the shared `$OID` was already advanced to `preparing` by C-B2, then `preparing → ready_for_pickup` is **legal**, so E1's "should reject" assertion fails — not because the state machine is broken, but because the precondition drifted (false negative). Conversely a fresh-but-`confirmed` order would mask a real defect (false positive).
  - **C-C5** assumes `$OID` is already assigned to `$RIDER` and at `out_for_delivery`, but the assignment happens in **C-D7** with load-balanced rider selection — if more than one rider is online, the order may be assigned to a different rider and `$RIDER`'s pickup returns 403.
- **Exact improvement:** Give every block its **own freshly-created, status-pinned fixture order** (helper: `mk_order <paymentMethod>` returning a new `$OID`), and for C-E1 create an order pinned exactly at `paid` for the illegal attempt. Pin the assignment target by asserting `orders.rider_id == $RIDER_PID` after C-D7 before C-C5 proceeds.
- **Expected impact:** Removes cross-block coupling so a block's result reflects only its own feature; makes failures localizable.

### F8 — No environment-isolation guard; blanket queries/cleanups can read and delete real data
- **Severity:** High
- **Affected:** C-E4 (settlement) and `§E` cleanup most acutely; all blocks generally
- **Why insufficient:** The harness can be pointed at a shared staging DB. Fixture lookups (`… products … LIMIT 1`), the global `runDailySettlement` (scans *all* yesterday-delivered orders), and `§E`'s `DELETE FROM settlements WHERE period_date=current_date-1` operate on **whatever else lives in that DB**. On a shared environment this deletes/မutates non-harness data and makes assertions ambiguous (other sellers' settlements appear in the same period).
- **Exact improvement:** Require a **dedicated, disposable database** for the harness and add a pre-flight guard that aborts unless an explicit `HARNESS_DB=1` marker / a known-empty `orders` table / `NODE_ENV != production` is present. Scope settlement verification to one known seller via the `single-seller-settle` job (with that seller's `sellerProfileId` + a unique `periodDate`), never the global daily run, and scope all cleanups to harness-created reference ids only.
- **Expected impact:** Prevents the harness from corrupting shared data and from producing assertions polluted by unrelated rows.

### F10 — Notification verification depends on an FCM-token fixture the harness never creates
- **Severity:** High
- **Affected:** C-A10, C-B2, C-C5, C-A13, C-D7, C-E3 (and every "Logs: 📱 [DEV FCM]" expectation)
- **Why insufficient:** Push handlers fetch the token first and **return early if absent** (`notifications.plugin.ts:19-22` and each `if (token)` branch). The harness fixtures (`§B.5`) **never call `POST /notifications/register-token`**, so `fcm:token:{userId}` is unset for every account → every push is silently skipped → the `📱 [DEV FCM]` log the harness tells the operator to look for **never prints**. The operator then either marks FAIL (false negative) or PASS-without-evidence (false positive). The seller socket log `🔔 New order alert sent to seller` *does* fire (it's the Socket.IO path, token-independent), which can mislead the operator into thinking the FCM push fired.
- **Exact improvement:** Add a fixtures step that registers a dummy device token for customer/seller/rider via `POST /notifications/register-token`. Replace the flaky log-eyeball with a **DB assertion on the `notifications` table** (deterministic, channel-tagged) — e.g., after C-A10, assert a `notifications` row with `event_type='new_order'` for the seller.
- **Expected impact:** Makes the notification pipeline actually testable and observable, and stops the seller-socket log from masquerading as proof of FCM delivery.

### F12 — Settlement block is globally scoped, non-deterministic, and payout-gated to sandbox
- **Severity:** High
- **Affected:** C-E4
- **Why insufficient:** It enqueues the **global** `daily-settlement` (processes every yesterday-delivered order), so the DB assertion (`settlements WHERE period_date=current_date-1`) is ambiguous on any DB with other data, and the dev branch verifies only "row created, payout skipped" — i.e., the actual payout state machine, idempotency key, fund-account caching, and ledger-on-`processed` (the entire money-movement core, `settlement.job.ts`) go unverified.
- **Exact improvement:** Use the targeted `single-seller-settle` job with a known `sellerProfileId`/`shopId`/`periodDate`; assert on that seller's settlement only. Gate the payout half to sandbox and assert: status transitions `pending→processing→paid`, ledger `seller_settlement` transaction written **exactly once** only at `paid`, and a **second enqueue produces no second payout** (idempotency-key reuse), confirmed in the RazorpayX dashboard.
- **Expected impact:** Turns the most consequential P0 money job from "a row exists" into a verified, idempotent payout state machine.

---

## Group D — Concurrency & recovery depth

### F9 — Concurrency cases are described in comments but never executed or asserted
- **Severity:** High
- **Affected:** C-A9 (oversell race, duplicate place-order), C-E3 (duplicate webhook — *this one is asserted*), C-B3 (auto-accept vs manual), C-A13/C-C6 (cancel racing pickup/report)
- **Why insufficient:** For P0 money features the **race is the risk** (oversell, double-charge, double-settle, double-accept). The harness writes prose like `# Duplicate tap: fire POST /orders twice rapidly` with **no concurrent execution and no invariant assertion**. A described-but-unrun race is zero coverage that reads like coverage.
- **Exact improvement:** Provide concrete parallel invocations and invariant assertions, e.g. oversell: `for i in 1 2; do (auth "$CUST" POST /orders … &) ; done; wait` then assert `stock_qty >= 0` and exactly the expected number of `orders` rows; duplicate-tap: two parallel `POST /orders` then assert order count == 1 (or the documented behaviour); auto-accept: trigger manual accept and let the timer fire, assert `seller_accepted_at` set once and `missed_acceptances` incremented by **exactly** the expected amount.
- **Expected impact:** Actually exercises the failure modes the matrix flags as the top P0 risks instead of implying they were tested.

### F13 — Recovery tests are thin and the most important one (dropped-webhook → reconcile) is not concretely runnable
- **Severity:** High
- **Affected:** C-E3 (reconcile recovery), C-A9 (rollback recovery)
- **Why insufficient:** The dropped-webhook→reconcile path is the headline P0 recovery, yet the harness gates it to sandbox and never shows the required precondition SQL (a `pending_payment` order with `created_at` older than 30 min). C-A9's oversell rollback is asserted only via "cart unchanged," not via "no `orders` row created AND `stock_qty` not decremented." Redis-cart-loss recovery is listed in the matrix but absent from the harness.
- **Exact improvement:** Add the backdate SQL (`UPDATE orders SET created_at = now() - interval '31 minutes' WHERE id=…`) and, for sandbox, a captured-but-un-notified Razorpay test payment, then enqueue `payment-reconcile` and assert the order flips to `paid` with exactly one `customer_payment` transaction. For oversell, assert `SELECT count(*) FROM orders WHERE …` is unchanged and `stock_qty` equals its pre-attempt value. Add a Redis-flush-then-`GET /cart` step to confirm documented cart-loss behaviour.
- **Expected impact:** Verifies the safety nets that exist precisely for when the primary path already failed.

### F16 — Queue checks are existence-only via `KEYS` and race the worker
- **Severity:** Medium
- **Affected:** C-A10, C-B3, C-E3, C-E4 (all "Queue Checks")
- **Why insufficient:** `redisc KEYS 'bull:<q>:*'` is timing-sensitive: with `SELECT_ACCEPT_MS=10000` the job moves delayed→active→completed quickly, so by the time the operator runs `KEYS` it may be gone → false "scheduling failed." `KEYS` is also a discouraged O(N) scan, and the BullMQ key layout (delayed = ZSET, jobs = hashes) isn't asserted precisely.
- **Exact improvement:** Assert via the **deterministic worker completion log** (`✅ Job completed: <name>`) and/or BullMQ's job-state API in a small tsx snippet (`queue.getJobCounts()`, `queue.getJob(jobId)`), checking the specific `jobId` (e.g., `auto-accept:$OID`) and its state, rather than `KEYS` existence at an arbitrary instant.
- **Expected impact:** Removes timing-driven false negatives on queue assertions.

### F17 — Idempotency tests assert the first effect happened but not that the second did **not**
- **Severity:** Medium
- **Affected:** C-A10 (second verify), C-B3 (auto-accept dedupe), C-D7 (double assign)
- **Why insufficient:** "Second verify idempotent" is only eyeballed via the response message; C-B3 doesn't assert `missed_acceptances` incremented by **exactly 1** (2 would mean dedupe failed); double-assign isn't asserted to leave exactly one active `delivery_assignment`. Idempotency is only proven by asserting the *absence* of the duplicate effect.
- **Exact improvement:** Add exact-count assertions: `transactions(customer_payment)`=1 after double-verify; `missed_acceptances` delta=1; `count(delivery_assignments WHERE order_id=$OID AND is_active)`=1 after a repeated assign.
- **Expected impact:** Converts idempotency from assumed to verified.

---

## Group E — Observability & missing assertions

### F11 — Socket.IO emissions are never actually observed; realtime delivery ships unverified
- **Severity:** High
- **Affected:** C-A14 (live item-unavailable), and the realtime side of C-B2 (`order:new` alarm), C-C5/C-B2 (`order:status`), C-D7/dispatch (`order:assigned`)
- **Why insufficient:** C-A14 says "with a Socket.IO client connected … observe the event" but provides **no client**. Everything is then verified via REST, so a release where Socket.IO broadcasting is broken (Redis adapter misconfigured, event-bus bridge down, room targeting wrong) passes every block. Realtime is core to tracking, the seller alarm, and the rider alert.
- **Exact improvement:** Add a minimal `socket.io-client` listener snippet (node one-liner: connect with `auth:{token}`, `emit('order:subscribe', oid)`, log received `order:*` events) and assert receipt within N seconds for at least one event per role-room (`user:`, `seller:`, `rider:`, `order:`). Where a socket client isn't run, explicitly downgrade the block's gate to "REST-verified; realtime NOT verified."
- **Expected impact:** Closes a blind spot that currently lets the entire realtime layer ship green.

### F15 — The `notifications` table (deterministic notification proof) is never asserted
- **Severity:** Medium
- **Affected:** C-A10, C-B2, C-C5, C-A13, C-D7, C-E3
- **Why insufficient:** Every notification event writes a `Notification` row (`logNotification`), which is the DB-observable, deterministic proof the pipeline ran — yet the harness checks console logs instead. Logs are level-gated (`debug` in non-prod), flaky, and (per F10) often don't fire.
- **Exact improvement:** Add `SELECT channel,event_type FROM notifications WHERE user_id=… ORDER BY sent_at DESC LIMIT 3;` assertions to each notifying block.
- **Expected impact:** Replaces log-eyeballing with a reliable DB assertion.

### F19 — COD collection amount is never asserted equal to the order total; `$COD_TOTAL` is undefined
- **Severity:** Medium
- **Affected:** C-C5
- **Why insufficient:** `codCollected` records whatever `amountPaise` the client sends and increments the rider balance by it, with **no server check that it equals the order total** (`orders.service.ts:666-684`). The harness uses an undefined `$COD_TOTAL` and never asserts the recorded amount matches the order total — so a client sending the wrong cash amount (a real money-data risk) passes.
- **Exact improvement:** Derive `COD_TOTAL=$(psqlc "SELECT total_amount FROM orders WHERE id='$COD_OID';")`, post exactly that, then assert `orders.cod_collected_paise == total_amount` and the rider `cod_balance_paise` delta equals it. Also add a negative case posting a mismatched amount and record the (currently unguarded) behaviour.
- **Expected impact:** Verifies COD cash integrity rather than just "status=delivered".

### F20 — Multi-shop `OrderGroup` money correctness is unasserted
- **Severity:** Medium
- **Affected:** C-A9, C-A10, C-A13
- **Why insufficient:** The harness's DB checks inspect a single `$OID`, but the multi-shop split (one child order per shop, one combined delivery fee on the carrier, group-level promo) is a known-complex P0 money path. Nothing asserts `sum(child total_amount) == group total`, that the fee is carried exactly once, or that the discount lands on the carrier order.
- **Exact improvement:** Add a multi-shop fixture (cart spanning two shops) and assert: number of child orders == shop count; exactly one child has `delivery_fee > 0`; `getOrderGroup` totals equal the sum of children; promo discount on the carrier only.
- **Expected impact:** Verifies the split-order accounting that single-order assertions skip.

### F21 — Cleanup leaves no post-condition assertion; "clean slate" is claimed, not verified
- **Severity:** Medium
- **Affected:** `§E`, and therefore the next run's correctness
- **Why insufficient:** After `§E` there is no check that the harness customer's orders are gone, rider `cod_balance_paise` reset, promo redemptions cleared, settlements/webhook-events removed. A partial cleanup silently poisons the next run (e.g., leftover yesterday-delivered orders inflate the next settlement; a surviving `promo_redemptions` row blocks FIRSTORDER via the unique `(promoCodeId,userId)` constraint).
- **Exact improvement:** End `§E` with assertions: `count(orders WHERE customer_id=<harness cust>)=0`, `rider cod_balance_paise = baseline`, `count(promo_redemptions WHERE user_id=<harness cust>)=0`, `count(settlements WHERE period_date=<harness period>)=0`. Fail the harness if any is non-zero.
- **Expected impact:** Guarantees re-runnability instead of asserting it.

### F7 — Cleanup script is FK-unsafe, incomplete, and over-broad
- **Severity:** High
- **Affected:** `§E`
- **Why insufficient:** Three concrete defects:
  1. **FK order/coverage:** the comment "repeat the WITH-pattern for order_items, payments, …" omits `delivery_assignments`, `batches`, `order_groups` and gives no delete ordering; children must be deleted before parents or the deletes FK-fail.
  2. **User delete FK-fails with orders:** `Order.customerId` has **no cascade** (`schema.prisma:579`). `DELETE FROM users WHERE phone='9000000004'` (who placed an order in C-E8) **violates the FK** because their order still references them — the cleanup itself errors out.
  3. **Over-broad settlement delete:** `DELETE FROM settlements WHERE period_date=current_date-1` removes *any* seller's settlement for that date, not just the harness's (compounds F8).
- **Exact improvement:** Provide an explicit, ordered, harness-scoped teardown: delete `order_status_history → order_items → payments → delivery_assignments → promo_redemptions → transactions(by reference_id) → orders → order_groups → batches`, scoped to the harness customer/sellers, **before** deleting users; scope settlement/transaction deletes to harness reference ids; and for 9000000004 delete their orders first, then the user.
- **Expected impact:** Makes cleanup actually run to completion and stops it from deleting unrelated data.

### F24 — ETA side-effect of P0 flows is never asserted
- **Severity:** Low
- **Affected:** C-A9, C-C5 (ETA is recomputed inside placeOrder/transitions)
- **Why insufficient:** `computeAndPersistEta` is best-effort and swallows all errors (`eta.service.ts:125`), so a broken ETA path is invisible. The harness never asserts `orders.estimated_delivery_at`/`eta_source` are set after placement/transition, even though the matrix lists this under A12.
- **Exact improvement:** Add a non-blocking assertion in C-A9/C-C5: `SELECT estimated_delivery_at IS NOT NULL, eta_source FROM orders WHERE id='$OID';` (report-only if you want to keep it out of the P0 gate).
- **Expected impact:** Surfaces silent ETA failures that the swallow-all design otherwise hides.

### F25 — No assertion that flows complete without server-side errors
- **Severity:** Low
- **Affected:** all blocks
- **Why insufficient:** Several blocks say "no 500 / no stack traces" in prose but never capture the API error log for the request. A feature can return 200 while logging an internal error (e.g., a swallowed notification/ETA failure), and the harness passes.
- **Exact improvement:** Tag harness requests with a known header/`x-request-id` and, after each block, assert the API log has no `error`-level line for those request ids (e.g., grep the API log file/stream for the run's correlation id).
- **Expected impact:** Catches "succeeds but logs an error" defects.

### F22 — Promo preview cart isn't pinned to a single shop, so FIRSTORDER can silently no-op
- **Severity:** Medium
- **Affected:** C-E12
- **Why insufficient:** `pricing/preview` applies promos **only when `shopIds.length === 1`** (`pricing.routes.ts`). If the E12 cart happens to span two shops, `discount` stays 0 with no error and the operator may read it as "promo broken."
- **Exact improvement:** Pin a single-shop cart for the promo block and assert `appliedPromoCode` is set; add a separate multi-shop case asserting the documented "no preview promo" behaviour.
- **Expected impact:** Removes a false-negative on the promo path.

### F23 — `/health` and `/ready` URLs are constructed fragilely
- **Severity:** Low
- **Affected:** `§D` process-health pre-check
- **Why insufficient:** `curl -s $API/../../health` relies on curl path-normalization of `/api/v1/../../health`; `/health` and `/ready` live at the **root** (`app.ts:142,154`), not under `/api/v1`. The indirection is confusing and can yield a misleading pre-check result.
- **Exact improvement:** Use the explicit root URLs: `curl -s http://localhost:3000/health` and `…/ready`.
- **Expected impact:** A reliable, unambiguous process-health gate.

---

## Per-P0-feature residual confidence (after this review, before fixes)

| Feature | Key harness gaps | Residual confidence if run as-is |
|---|---|---|
| C-A1 OTP Login | F3 (rate self-DoS), F2 (no negative) | Low–Med |
| C-B1 / C-C1 PIN Login | F3, lockout not actually driven at runtime | Low–Med |
| C-E1 State Machine | F6 (shared-state drift → false pos/neg) | Low |
| C-E11 Pricing | F18 (featured fixture), otherwise sound | Med |
| C-A9 Checkout/Order | F1?, F5 (hours), F9 (races unrun), F20 (group), F13 (rollback) | Low |
| C-A10 Payment | **F1 (dev-mock false green)**, F2, F14, F17 | Very Low (dev) / Med (sandbox+) |
| C-E3 Webhook+Reconcile | **F1**, F2, F13 (reconcile unrun), F14 | Very Low (dev) / Med (sandbox+) |
| C-B2 Accept/Reject | F1 (refund), F6, F10/F15 (notif), F2 (perm) | Low |
| C-B3 Auto-Accept | F4 (token expiry), F16 (queue race), F17 (dedupe count) | Low–Med |
| C-D7 Assign+Refund | F1 (refund), F2 (admin perm), F6 (assign target) | Low |
| C-C5 Delivery+COD | F19 (COD amount), F6 (rider target), F2 | Low |
| C-C6 Item Unavailable | F1 (line refund), F11 (socket), F18 (fixtures) | Low |
| C-A14 Live Update | **F11 (socket never observed)** | Very Low (realtime) |
| C-E4 Settlement+Payout | **F1/F12 (core payout unverified)**, F8 | Very Low (dev) / Med (sandbox+) |
| C-A13 Cancel/Refund | F1 (refund), F2 | Low |
| C-E12 Promotions | F22 (single-shop), F18 | Med |
| C-E13 COD Cap (inert) | sound as a "verify-unenforced" check; add F19 linkage | Med |
| C-E8 Referral (inert) | F7 (cleanup FK on 9000000004), otherwise sound | Med |

## Coverage of the requested review questions
- **Test cases sufficient?** No — F1, F2, F9, F13.
- **Edge cases missing?** Yes — F5 (hours), F20 (multi-shop), F2 (negatives), F22 (multi-shop promo).
- **Concurrency realistic?** Described, not executed — F9, F17.
- **Recovery adequate?** No — F13, F16.
- **Hidden dependencies?** Yes — F6, F8, F10, F12, F25.
- **Cleanup safe?** No — F7, F8, F21.
- **False positives / pass-while-broken?** Yes — F1, F2, F10, F11.
- **External-service assumptions valid?** Only in sandbox — F1, F10.
- **Missing observability?** Yes — F11, F15, F24, F25.
- **Missing DB/Redis assertions?** Yes — F15, F17, F19, F20, F21.
- **Could corrupt test results?** Yes — F3, F4, F6, F7, F8, F14.

## Readiness verdict
The harness is a strong skeleton but is **not yet trustworthy as a release gate**. Close, at
minimum, the Critical findings (F1, F2) and the run-integrity High findings (F3, F4, F5, F6,
F7, F8, F14) before first use; address F10/F11/F12/F13 to make the notification, realtime,
settlement, and recovery paths genuinely verified rather than implied.

*Scope note: this is an audit of the verification harness only. No tests were executed and no
application code was modified or recommended for modification.*
