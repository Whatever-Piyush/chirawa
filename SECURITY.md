# Bringly — Security posture

What the backend enforces today, and the known gaps. Updated alongside the Phase
0–4 hardening work.

## Authentication & authorization
- **JWT (RS256)** access tokens; every protected route runs `authenticate`, and
  role gates use `requireRole(...)`.
- **Ownership checks on every mutation** (authorization audit, 4.10):
  - **Orders** — customer actions assert `order.customerId === auth.userId`
    (`getOrder`, `cancelOrder`, `rateOrder`, address/receiver edits); seller
    actions assert `order.shop.seller.userId === auth.userId` (accept/reject/
    preparing/ready); rider actions assert an active assignment / `order.riderId`
    (`codCollected`, `markDelivered`, `riderAdvance`).
  - **Catalog/inventory** — product/category/variant writes resolve the shop's
    seller and assert ownership; `admin` bypasses (`inventory.service`:
    `assertShopOwner` / `loadOwnedProduct`).
  - **Payments** — `createPaymentOrder`/`verify` assert order ownership; refunds
    are `requireRole('admin')`.
  - **Users** — address writes assert `address.userId === auth.userId`.
  - **Settlements** — seller settlement reads scoped to the seller's own shop.

## Payment integrity
- **Fail-fast on placeholder secrets in production (0.2):** the server refuses to
  boot if any Razorpay secret still contains `placeholder`.
- **Webhook signature always verified** (`verifyWebhookSignature`) before any
  processing; in prod the secret is real (per 0.2).
- **Webhook process-then-record (1.8):** events are processed first and recorded
  only on success, so a transient failure is retried, not silently dropped.
  Handlers are idempotent.
- **Idempotent checkout (0.5):** `POST /orders` honours an `Idempotency-Key`
  (Redis SETNX) so retries can't double-create orders/charges.
- **Payouts never lie (0.3):** a settlement is marked `paid` (and ledgered) only
  when the RazorpayX payout actually reports `processed`; payouts use an
  idempotency key; the reconcile sweep finalizes in-flight payouts.
- **Money = integer paise** everywhere; multi-row writes are `$transaction`.

## Rate limiting
- **Global per-IP** limit (`@fastify/rate-limit`): 100/min in prod.
- **Tighter per-IP** on OTP routes (`/auth/send-otp`, `/auth/verify-otp`): 10/min.
- **Per-user** caps (4.8) on `POST /orders` (20/min) and payment create/verify
  (30/min), keyed by JWT `sub` (falls back to IP), on top of the global per-IP cap.

## Transport & input
- **CORS locked to `FRONTEND_URLS`** for both HTTP and Socket.io in production
  (2.5); `*` only in dev.
- **Helmet** enabled. **Multipart** capped at 5 MB, single file.
- **Validation at the boundary** — every endpoint validates input with zod before
  logic; typed errors shape every response as `{ success:false, error:{code,message} }`.
- **UUID-format `:id` guards** on catalog reads; CSV import sanitised (quote-aware
  parser, paise coercion, per-row error report).

## Operational safety
- **`/health`** (liveness) and **`/ready`** (DB + Redis reachable → 503 if not, 4.4).
- **Nightly Postgres backups** via `apps/api/scripts/backup-postgres.sh` (off-box
  copy + rotation + a restore runbook). *Action: run a real restore once.*

## Known gaps (tracked)
- **Admin TOTP + ipAllowlist (4.6)** — schema fields exist; enforcement not yet wired.
- **Sentry (4.1)** — not yet wired (needs a DSN); add to api/worker/apps.
- **Per-phone** OTP limiting (currently per-IP) would further harden auth.
- **Secret rotation + storage** (4.7), **Redis durability/memory alerts** (4.12),
  and **uptime/alerting** (4.3) are infra tasks owned in Phase 4/5.
- **`exactOptionalPropertyTypes` typecheck debt** — `tsc` is red repo-wide; fix or
  relax before relying on `pnpm typecheck` in CI.
