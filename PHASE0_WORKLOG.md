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

_Next per `fixme.MD`: **0.3** — rewrite `settlement.job.ts` `initiatePayout` (real RazorpayX payouts;
never mark paid unless payout succeeded; no-UPI ⇒ pending + admin flag, not failed)._
