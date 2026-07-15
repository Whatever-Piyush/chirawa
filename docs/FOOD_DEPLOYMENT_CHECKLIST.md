# Bringly Food — Production Deployment Checklist (RC-1)

Run top to bottom on launch day. Every box gets a checker's initials + time.
General deploy mechanics (build, PM2, rollback) live in [DEPLOYMENT.md](DEPLOYMENT.md);
this list is the food-specific overlay. Incident playbook: [FOOD_RUNBOOK.md](FOOD_RUNBOOK.md).

## 1. Infrastructure

- [ ] Code deployed via the standard CI-gated release (DEPLOYMENT.md) — includes the two food migrations
- [ ] **DB migration applied**: `pnpm --filter @chirawa/api db:migrate:prod`
      (backup-guarded). Verify: `psql -c "\dt" | grep -E "restaurants|food_orders"` → 8 food tables
- [ ] **Food seed executed**: `pnpm --filter @chirawa/api db:seed:food`
      → "6 launch restaurants + menus… Rishivan 44 items (REAL)". Safe to re-run (idempotent)
- [ ] **Env verified**: `pnpm --filter @chirawa/api env:check` passes with the flags below
- [ ] API + worker restarted; `/health` 200 and `/ready` shows db+redis `true`
- [ ] Boot log shows `🛟 Food reconcile sweep ready`

## 2. Payments (the gate that actually unlocks Food)

- [ ] **Real production Razorpay keys** in server `.env`: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (no `placeholder`)
- [ ] `RAZORPAY_WEBHOOK_SECRET` real (marketplace path verifies webhooks; food is pull-based but the secret must not be a placeholder in prod — fails closed)
- [ ] **`PAYMENTS_ONLINE_ENABLED=true`** + restart api & worker (Food is UPI-only; without this every food checkout is refused)
- [ ] Razorpay dashboard: UPI enabled on the account; settlement account verified
- [ ] **Live ₹59 test order paid end-to-end** (smoke, §7) and **one reject → refund visible in Razorpay dashboard** + `refund_status='processed'`
- [ ] Marketplace check: customer-app `FEATURES.onlinePayments` remains `false` → grocery checkout still shows COD + "coming soon" online (flag flip for grocery online pay is a separate product decision)

## 3. Notifications

- [ ] Firebase service-account envs present (api boot has no firebase-admin warnings)
- [ ] Test devices registered: `redis-cli GET fcm:token:<sellerUserId>` non-empty
- [ ] One test order → restaurant push arrives with sound; customer gets accepted/on-the-way/delivered pushes

## 4. Restaurants

- [ ] 6 seller accounts created (one per restaurant); OTP login verified on each device
- [ ] `Restaurant.sellerUserId` set for all 6 → 🍽️ tab appears in each seller app
- [ ] **Provisional menus reviewed + corrected by each restaurant** (Rishivan already verbatim); prices signed off
- [ ] Real opening hours set per restaurant (`open_time`/`close_time` — seed defaults are placeholders)
- [ ] **Real coordinates + addresses** set (seed values are approximations — riders navigate by these)
- [ ] Each restaurant trained: accept/reject/preparing/ready, open-close switch, menu sold-out toggle (15-minute walkthrough each)
- [ ] Each restaurant knows: unaccepted orders auto-cancel + refund at 15 min

## 5. Riders

- [ ] Rider accounts active; Food tab visible in rider app
- [ ] Riders briefed: food orders are **prepaid — never collect cash** (PAID ✓ badge)
- [ ] Rider coverage agreed for restaurant hours (restaurants close at 22:00 — later than marketplace 20:00; decide + staff the 20:00–22:00 window or align hours)
- [ ] Pilot payout scheme for food deliveries agreed (manual weekly sheet — FOOD_RUNBOOK.md daily-ops table)

## 6. Monitoring

- [ ] Uptime monitors green (`/health`, `/ready`, worker heartbeat — RUNBOOK.md §2)
- [ ] Sentry receiving events from the deployed release
- [ ] Log watch during launch window: `grep -E "food reconcile|food-refunds|FOOD" /var/log/chirawa/api-out.log`
- [ ] Morning + evening food ops checks scheduled (FOOD_RUNBOOK.md daily table): refund queue empty, no stuck orders

## 7. Launch smoke test (on production, real money, ~₹120)

- [ ] Customer: order 1 Rishivan slush (₹69 + ₹30) → UPI pay → restaurant push → accept → preparing → ready → rider claim → picked up → delivered. Timeline + all pushes correct
- [ ] Second order → restaurant **reject** → refund auto-initiated → `refund_status='processed'` → Razorpay dashboard shows the refund → customer push received
- [ ] `GET /food/admin/refunds` → `[]`
- [ ] Marketplace smoke: one grocery COD order end-to-end unchanged

## 8. Rollback plan

- [ ] Standard exact-SHA rollback ready (ROLLBACK_DRILL.md) — food routes vanish with the old build; marketplace unaffected
- [ ] **Food kill-switches** (no redeploy needed):
      - hide all restaurants: `UPDATE restaurants SET is_active=false;` (Food tab shows empty state; carts/checkout refuse)
      - or per-restaurant: flip `is_open`
- [ ] DB rollback NOT required for app rollback (food tables are additive; old build ignores them). Dropping food tables is a last resort only, after exporting `food_orders` for accounting
- [ ] In-flight orders during a rollback: refund manually per FOOD_RUNBOOK.md F6

## 9. Go criteria

All of: §2 smoke + refund proven · §4 restaurant sign-offs · §5 rider coverage ·
monitors green · refund queue empty at T+2h. Any P0 during the window → flip
kill-switch, fix, re-run §7.
