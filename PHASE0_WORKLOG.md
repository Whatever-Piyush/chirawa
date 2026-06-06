# 🐛 Phase 0 — Production-Critical Bug Fix Worklog

Companion to `fixme.MD` (the master roadmap). `fixme.MD` says **what** to do and in what order;
this file records **what was actually done**, whether it works, and any extra bugs found & fixed
along the way. One section per Phase-0 task (0.1 → 0.5). After each, I stop for on-device testing
before moving to the next per the roadmap.

**Conventions:** pnpm only · money in integer paise · per repo `.claude-rules` each fix is its own
Conventional-Commits commit · `.env` files are never staged.

> ⚠️ **Branch-wide pre-existing issue (not introduced by these fixes):** `pnpm typecheck` is already
> red on `feat/blinkit-style-catalog` (~26 errors) due to `exactOptionalPropertyTypes: true` — it
> trips nearly every Fastify route generic and several Prisma writes across unrelated modules
> (`users.service`, `pricing.routes`, `payments`, `orders.service:updateOrderStatus`). New code here
> adds **no new error category**. This deserves its own cleanup task (tsconfig or per-handler typing).

---

## ✅ 0.1 — Rider "delivered" path for non-COD (prepaid) orders

**Commit:** `5c750ea` — `fix(api): add rider delivered path for non-COD (prepaid) orders`

**Problem:** Only `codCollected` could move an order to `delivered`, and it's COD-only. Prepaid/UPI
orders had **no completion path** — they could get stuck `out_for_delivery` forever.

**Fix:** Added `markDelivered(orderId, riderId)` in `orders.service.ts` + `POST /orders/:id/delivered`
(rider role). It mirrors `codCollected` exactly — `$transaction([order.update{status:'delivered',
deliveredAt}, orderStatusHistory.create])` then `emitOrderStatusChanged` — but records **no cash**
(no `codCollectedPaise`, no rider COD balance change). COD orders are rejected here and must still
use `/cod-collected`. **No generic status setter** introduced (per constraint).

**Files:** `orders.service.ts`, `orders.routes.ts`, `__tests__/orders.delivered.test.ts` (new).

**Tests:** ✅ 4/4 (delivers prepaid; rejects COD; rejects non-owner rider; rejects missing order).

**Working?** Backend verified by tests. Needs an API-level device check (see below). Rider app has
**no UI button yet** for prepaid completion — flagged as a follow-up frontend task.

**Verify on device:** As the assigned rider, `POST /api/v1/orders/{id}/delivered` on a prepaid order
that's `out_for_delivery` → 200, order `delivered`, customer tracking flips via socket. COD order →
400; other rider → 403.

**Follow-ups / extra notes:**
- **Frontend (separate task):** wire `markDelivered` into `rider-app` `api.service.ts` + a "Mark
  delivered" button in `DeliveryScreen.tsx` for prepaid orders.
- Neither `codCollected` nor `markDelivered` guards the *prior* status (mirrors existing behaviour).
  If we want to enforce `out_for_delivery → delivered`, add it symmetrically to both.

---

## ✅ 0.2 — Hard-fail in production on placeholder Razorpay secrets

**Commit:** _(see git log; committed with this worklog entry)_

**Problem:** `config/env.ts` defaulted `RAZORPAY_KEY_ID='rzp_test_placeholder'`,
`RAZORPAY_KEY_SECRET='placeholder'`, `RAZORPAY_WEBHOOK_SECRET='placeholder'`. In production these
silently make `razorpay.service` run in "dev mock" mode → webhook signatures aren't verified and
prepaid orders are effectively free. The server would boot happily with fake payment creds.

**Fix (done the testable way):** Split the pure Zod schema into `config/env.schema.ts` and kept
`config/env.ts` as the thin loader (it still `process.exit(1)`s on bad env). Added a `.superRefine`
that, **only when `NODE_ENV==='production'`**, fails if any of the three Razorpay secrets contains
`"placeholder"` (case-insensitive). It reports **all** offending keys at once (not just the first),
flowing through the existing `flatten().fieldErrors` error printer. Dev/test keep working on the
placeholder defaults.

**Why split the file:** importing `env.ts` runs `validateEnv()` at module load, so it can't be unit
tested without triggering `process.exit`. Extracting the schema makes the rule testable in isolation.
All existing importers use `{ env }` only, so nothing else changed.

**Files:** `config/env.schema.ts` (new), `config/env.ts` (now a loader), `__tests__/env.schema.test.ts` (new).

**Tests:** ✅ 8/8 (real prod passes; each of the 3 secrets fails individually; placeholder default
key-id fails; multiple placeholders all reported; dev allowed; test allowed).

**Working?** Yes — verified by unit tests. No new typecheck errors in env files.

**Verify on device / locally:** `NODE_ENV=production RAZORPAY_KEY_SECRET=placeholder pnpm --filter
@chirawa/api start` → process exits with `❌ Invalid environment variables` listing the offending
key(s). Set real `rzp_live_*` creds → boots normally.

**Extra bug / recommendation (NOT changed in code, to avoid blocking your current prod deploy):**
The same "placeholder in prod = silently broken" risk applies to `JWT_PRIVATE_KEY/JWT_PUBLIC_KEY`,
`FCM_SERVICE_ACCOUNT_JSON` (`{}`), `FAST2SMS_API_KEY`, and the R2 creds. Recommend extending the
production hard-fail to those once their real values are provisioned. Kept 0.2 scoped to Razorpay as
specified.

---

## ✅ 0.3 — Real RazorpayX payouts in `settlement.job.ts`

**Commit:** _(committed with this worklog entry)_ · **Migration:** `20260606175525_settlement_payout_tracking`

**Problem:** `initiatePayout` was a stub. It **logged a fake `DEV_<ts>` UTR and marked the settlement
`paid` + wrote the ledger without any money moving** — so every settlement looked paid while sellers
got nothing. Worse, a seller with **no UPI** was marked `failed` (wrong: it's a fixable data gap, not
a payment failure).

**Fix — real RazorpayX integration + a strict money state machine:**
- New REST payout layer in `razorpay.service.ts` (`razorpay-node` doesn't wrap payouts): `isPayoutConfigured()`,
  `ensureSellerFundAccount()` (contact + VPA fund-account, created once and cached), `createPayout()`
  (Basic auth + **`X-Payout-Idempotency` header** keyed on settlement id).
- `initiatePayout` state machine:
  | Situation | Result |
  |---|---|
  | payout `processed` | `paid` + `payoutId` + `upiRef=UTR` + **ledger row** (atomic `$transaction`) |
  | payout `queued/pending/processing` | `processing` + `payoutId`, **no ledger, not paid** |
  | payout `rejected/cancelled/reversed` | `failed` + `needsAttention` + reason, **no ledger** |
  | API/network throw | `failed` + `needsAttention` + reason, **no ledger** (safe to retry — idempotent) |
  | **no UPI** on seller | stays **`pending`** + `needsAttention` + reason — **not `failed`**, no ledger |
  | RazorpayX unconfigured (dev/test) | stays `pending` with a note — **never a fake paid** (0.2 keeps prod from hitting this) |
- **Idempotency:** DB guard (skip if already `paid`/`processing`/has `payoutId`) + the idempotency header.
- **Invariants held:** ledger `Transaction` and `status='paid'` happen **only** on `processed`. Money
  sums still from order-item snapshots.

**Migration (additive, no backfill):** `settlements` += `payout_id`, `failure_reason`,
`needs_attention BOOL default false`; `seller_profiles` += `razorpay_contact_id`,
`razorpay_fund_account_id`. New env var **`RAZORPAYX_ACCOUNT_NUMBER`** added to `env.schema.ts`
(default `placeholder`). ⚠️ **Action for you:** set `RAZORPAYX_ACCOUNT_NUMBER` (and real `rzp_live_*`
keys) in `apps/api/.env` before payouts run — I did **not** touch `.env` files per your instruction.

**Files:** `prisma/schema.prisma` + migration, `config/env.schema.ts`, `payments/razorpay.service.ts`,
`worker/jobs/settlement.job.ts`, `worker/jobs/__tests__/settlement.job.test.ts` (new).

**Tests:** ✅ 8/8 new (processed→paid+ledger; queued→processing+no ledger; rejected→failed+flag;
throw→failed+flag; no-UPI→pending+flag+no API call; unconfigured→no fake paid; idempotent skip;
caches new fund-account ids). Full suite: ✅ **66/66**. Typecheck: no new errors in 0.3 files (the one
`razorpay.service:97` error is the pre-existing `RazorpayPayment` index-signature issue in unchanged code).

**Working?** State machine fully unit-verified. The **live HTTP path can't be E2E-verified without a
funded RazorpayX test account** — verify in staging with real creds.

**Verify on device / staging:**
1. Set real `rzp_live_*` keys + `RAZORPAYX_ACCOUNT_NUMBER` in `.env`; fund the RazorpayX account.
2. Create a delivered order for a seller **with** a `upiId`; trigger settlement (`DAILY_SETTLEMENT`
   job or the single-seller job). Expect a `payout` in the RazorpayX dashboard; settlement →
   `processing` then `paid` once RazorpayX reports `processed`; one `seller_settlement` ledger row.
3. Seller **without** UPI → settlement stays `pending`, `needsAttention=true`, no payout.
4. Re-run the job → no duplicate payout (idempotent).

**Known follow-ups (flagged, not in scope):**
- **No payout webhook yet** → a `processing` payout won't auto-flip to `paid`. Need a
  `payout.processed`/`payout.failed` webhook handler **or** a reconcile sweep that fetches payout
  status and finishes the transition (+ writes the ledger then). High priority before relying on payouts.
- `processSingleSellerSettle` `upsert` returns `status` from `create` only; on an existing row it
  returns `{}`-updated record — current `if (settlement.status === 'pending')` still works because
  upsert returns the row, but worth a glance when the webhook lands.
- Consider extending 0.2's prod hard-fail to `RAZORPAYX_ACCOUNT_NUMBER` once provisioned.

---

_Next per `fixme.MD`: **0.4** — in `reconciliation.job.ts`, after `markOrderPaid` (worker context),
notify the seller via FCM directly + enqueue the seller auto-accept job (event bus can't cross the
worker→API process boundary)._
