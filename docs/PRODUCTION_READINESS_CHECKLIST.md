# Production Readiness Checklist — Infrastructure & Configuration (Phase 5)

Every external-service, credential, and environment task standing between this
codebase and a safe launch. Code-side enforcement is DONE (commits `Infra 1–5`);
what remains is console work and server configuration — each unchecked box below
is a human action. Companion docs: [RUNBOOK.md](RUNBOOK.md) (operations),
[DEPLOYMENT.md](DEPLOYMENT.md) (shipping), [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)
(database).

**Launch decisions this checklist encodes (founder, 2026-07-02):**
- **COD-only launch.** Online payment is wired but OFF (`PAYMENTS_ONLINE_ENABLED=false`);
  the app shows "Pay Online — coming soon". Razorpay still gets configured properly.
- **Mappls, not Google.** All maps API calls (search, geocoding, distance) are Mappls.
  One client-side Google key remains solely for Android map *tiles* (see §7).

## 0. What the code already enforces (nothing to configure — know it exists)

| Enforcement | Where |
|---|---|
| Boot/deploy hard-fails on placeholder Fast2SMS/R2 creds, localhost URLs, template JWT keys — and placeholder Razorpay creds *once online payments are enabled* | `env.schema.ts`, `env:check` in the release script |
| Non-COD orders rejected; Razorpay payment-order creation refused while the launch flag is off | `orders.service.ts`, `payments.service.ts` |
| Webhooks reject (fail closed) if the webhook secret is a placeholder in production | `razorpay.service.ts` |
| OTP `123456` bypass is development-only | `otp.service.ts` |
| `db:seed` / `db:seed:images` refuse to run against production | `prisma/seed-guard.ts` |
| Dev-mode FCM/SMS/geo/distance degrade gracefully and WARN at production boot | `collectProductionWarnings` |

## 1. Razorpay (COD-only launch — configure it, don't expose it)

- [ ] Complete Razorpay account activation/KYC for the live account.
- [ ] Put the REAL `rzp_live_…` key id + secret in the server `.env`
      (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`). The flag being off means
      placeholders merely *warn* — but the decision is to configure it properly.
- [ ] Leave `PAYMENTS_ONLINE_ENABLED=false` (or unset — false is the default).
- [ ] **Flip-on procedure (whenever online payments launch):** verify live creds →
      set `PAYMENTS_ONLINE_ENABLED=true` + `pm2 restart api worker --update-env` →
      ship a customer-app build with `FEATURES.onlinePayments=true` → place one
      real ₹1 order end-to-end and watch the webhook arrive.

## 2. Razorpay webhook verification

Signature verification is HMAC-SHA256 over the raw body with `timingSafeEqual`,
and never skips in production. To make it live:

- [ ] Razorpay dashboard → Webhooks → add
      `https://api.chirawa.in/api/v1/payments/webhook/razorpay`, events
      **payment.captured** + **payment.failed** (the two the processor handles).
- [ ] Generate a strong webhook secret there; set `RAZORPAY_WEBHOOK_SECRET` to the
      same value.
- [ ] Confirm the nginx `webhook` rate-limit zone is applied on the server
      (P1-5 changed `scripts/nginx/chirawa.conf`; nginx is copied manually —
      `nginx -t && systemctl reload nginx`).

## 3. RazorpayX readiness (seller payouts)

Payout code is live but self-disables until configured (`isPayoutConfigured`):
settlements are recorded and stay `pending`; money moves manually. Boot warns.

- [ ] Activate RazorpayX + current account; set `RAZORPAYX_ACCOUNT_NUMBER`.
- [ ] Ensure every live seller has a payout `upiId` on their profile — fund
      accounts (contact + VPA) are created automatically on first payout.
- [ ] First run: one small real settlement, verify `fetchPayout` shows `processed`
      and the seller confirms receipt (worker logs: `grep settlement`).

## 4. Fast2SMS production configuration

- [ ] Real `FAST2SMS_API_KEY` on the server (placeholder hard-fails production —
      OTP login is load-bearing).
- [ ] Top up SMS credits and enable auto-alert on low balance in the dashboard.
- [ ] OTP route works **without** DLT registration (it rides Fast2SMS's own
      approved template) — verify one real login OTP on a real phone.

## 5. DLT readiness (transactional SMS beyond OTP)

`sms.service.ts` (order delivered / cancelled / refund / settlement SMS) still
uses the pre-DLT quick route `'q'` — acceptable short-term because SMS is a
non-fatal secondary channel (FCM is primary), but not TRAI-compliant for
production traffic and increasingly filtered by operators. Registration is a
multi-day process — start early:

- [ ] Register the business as a Principal Entity on one operator DLT portal
      (Jio TrueConnect / Airtel DLT / VI DLT — one registration covers all).
- [ ] Register a 3–6 letter sender header (e.g. `BRNGLY`).
- [ ] Register the four `SmsTemplates` texts **verbatim** as content templates,
      with variables as `{#var#}`.
- [ ] Fast2SMS dashboard → DLT Manager → submit entity/header/templates → collect
      the approved **Message IDs**.
- [ ] Swap `sms.service.ts` to `route: 'dlt'` per the contract documented in that
      file (sender_id + message-ID + pipe-separated `variables_values` — verified
      against docs.fast2sms.com/reference/dlt-sms).

## 6. Firebase production credentials (FCM push)

- [ ] Firebase console (production project) → Project settings → Service accounts
      → generate private key; paste the JSON **single-line** into
      `FCM_SERVICE_ACCOUNT_JSON` (while `{}`, pushes are log-only and boot warns).
- [ ] Confirm each app's `google-services.json` belongs to the production Firebase
      project and matches its package name (`com.chirawa.customer` / seller / rider).
- [ ] The API keys inside `google-services.json` ship in every APK by design —
      restrict each in Google Cloud console: **Android apps** restriction
      (package + SHA-1), API restriction to Firebase services.
- [ ] Send one test push per app (order flow in staging or `scripts/test-notifications.sh`).

## 7. Maps — Mappls everywhere; one rotated tile key (item: "Google Maps API restrictions")

- [ ] Mappls console (auth.mappls.com/console): collect `MAPPLS_CLIENT_ID`,
      `MAPPLS_CLIENT_SECRET`, `MAPPLS_REST_KEY` into the server `.env`
      (placeholders = geo search/reverse-geocode return empty + distance falls
      back to haversine — boot warns).
- [ ] Restrict the Mappls REST key to the server IP; note the free-tier daily
      quotas and watch usage after launch.
- [ ] **ROTATE the exposed Google Maps key** (`AIzaSyBN1U…` — it lived in
      `app.json`, so it is in git history forever): delete it in Google Cloud
      console.
- [ ] Create its replacement restricted to package `com.chirawa.customer` +
      release-keystore SHA-1 + **Maps SDK for Android only**; provide it as the
      `GOOGLE_MAPS_ANDROID_API_KEY` EAS environment variable (never in git —
      `app.config.js` injects it at build time).
- Note: that key only renders map *tiles* via react-native-maps (free on mobile
  SDKs). Every maps API *call* is Mappls. Eliminating Google entirely would mean
  migrating the app to the Mappls React Native SDK — a separate product decision.

## 8. Secret management audit — findings & actions

Swept the repo for `AIza…`, `rzp_live/test_…`, and private-key blocks:

| Finding | Status |
|---|---|
| Real Google Maps key hardcoded in `customer-app/app.json` | **Fixed** (env-injected via `app.config.js`) — rotation still pending (§7) |
| Firebase API keys in 3× `google-services.json` | Committed by design (client config, ships in APK) — restrict per §6 |
| `.env*` files | Gitignored; only `.example` files tracked ✓ |
| Razorpay live keys / PEM private keys in history | None found ✓ |
| CI/deploy secrets | GitHub Actions secrets only (`docs/github-secrets.md`) ✓ |

- [ ] Server `.env`: owned by `appuser`, mode `600`.
- [ ] Production JWT keypair is unique (never the dev/test pair; the `.env.example`
      template marker hard-fails production anyway).
- [ ] Rotate any credential that has ever been pasted into a chat/ticket/screenshot.

## 9. Placeholder sweep

`env:check` is the mechanical sweep — placeholders that matter hard-fail, the
rest warn. What each surviving placeholder means:

| Left as placeholder/empty | Consequence (all boot-warned) |
|---|---|
| `MAPPLS_*` | /geo/* empty (on-device geocoder fallback); distance = haversine×1.4 |
| `RAZORPAY_*` (flag off) | webhooks fail closed; refund/reconcile inert — fine for COD-only |
| `RAZORPAYX_ACCOUNT_NUMBER` | settlements recorded but payouts stay pending (manual transfer) |
| `FCM_SERVICE_ACCOUNT_JSON={}` | push notifications disabled (log-only) |
| `SENTRY_DSN` empty | no error tracking |
| `WORKER_HEARTBEAT_URL` empty | nobody paged if the worker dies |

- [ ] On the server: `NODE_ENV=production pnpm --filter @chirawa/api env:check`
      → zero ❌, and every remaining ⚠️ is a *decision*, not an oversight.

## 10. Development seeds (enforced — verify once)

- [ ] On the server, `pnpm --filter @chirawa/api db:seed` refuses with the
      seed-guard message (NODE_ENV=production). Nothing else to do — demo shops,
      known-phone riders and the dev admin cannot reach production.

## 11. Founder admin (secure creation)

- [ ] On the server: `pnpm --filter @chirawa/api admin:create -- --phone <founder's real number>`.
- [ ] Log in via OTP on that phone; verify the admin/dispatch view works.
- There is no admin password or PIN to manage: admin auth is OTP-to-that-phone,
  and the dev bypass (`123456`) is compiled out of production behavior. The
  seeded dev admin (`9999900001`) is blocked from production by §10.

## 12. Environment separation (verify)

Dev / test / production are separated by explicit signals, not convention:
`NODE_ENV` is required (no default); dev OTP bypass and dev-mode payment mocks
key off it; CI injects test-only JWT keys; PM2 sets `env_production`; seeds
refuse production (§10); Razorpay/webhook behavior is production-strict.

- [ ] Server `.env` has `NODE_ENV=production` (DEPLOYMENT.md §4 one-time step).
- [ ] Production Postgres + Redis listen on localhost only (or are firewalled)
      and require auth.
- [ ] Production JWT keys, DB password, and Redis password differ from every
      dev/test value.
- [ ] `FRONTEND_URLS` lists only the real production origins.

## Final gate — run top to bottom before opening to customers

1. [ ] `env:check` clean on the server (§9).
2. [ ] Deploy pipeline green end-to-end; `/health` + `/ready` 200 (RUNBOOK §2–4).
3. [ ] Monitors live: health, ready, worker heartbeat + Sentry alert rules (RUNBOOK §2).
4. [ ] Log rotation installed (DEPLOYMENT §9); backup restore drill run this month
       (DISASTER_RECOVERY §3a).
5. [ ] Founder admin created and logged in (§11).
6. [ ] One real COD order end-to-end on production: place → seller accept →
       rider assign → deliver → COD collect → SMS/push received.
7. [ ] Checkout shows "Pay Online — coming soon" and refuses to select it; a
       forged non-COD API request gets the BUSINESS_RULE_VIOLATION rejection.
