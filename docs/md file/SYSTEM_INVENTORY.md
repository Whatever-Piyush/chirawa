# SYSTEM_INVENTORY.md

> Discovery-mode inventory of the **Chirawa / Bringly** quick-commerce platform.
> Read-only description of what exists in the repository. No recommendations, fixes, or audits.
> All file citations are relative to the repo root (`/Users/aadii/chirawa`).

---

## 1. High-Level Architecture

Chirawa (product name also appears as **Bringly**) is a single-town quick-commerce
(grocery delivery) platform for **Chirawa**, a tier-3 town in Rajasthan, India. It is a
**pnpm monorepo** (`pnpm-workspace.yaml`) containing one backend service and three
React Native (Expo) mobile apps, plus three shared TypeScript packages.

Architecturally it is a **modular monolith** (documented in `docs/adr/001-modular-monolith.md`):
a single Fastify API process holds all business modules, with one separate BullMQ
**worker** process for background jobs. There is no admin web frontend in the repo — the
admin surface is API-only (`apps/api/src/modules/admin/admin.routes.ts`).

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ customer-app│   │ seller-app  │   │  rider-app  │   (Expo / React Native)
└──────┬──────┘   └──────┬──────┘   └──────┬──────┘
       │ HTTPS + WebSocket (Socket.IO)     │
       └──────────────┬───────────────────┘
                      ▼
        ┌──────────────────────────────┐
        │  Fastify API  (apps/api)      │  4 PM2 cluster instances
        │  REST /api/v1/* + Socket.IO   │  (apps/api/ecosystem.config.js)
        └──────┬───────────────┬────────┘
               │               │
        ┌──────▼─────┐   ┌─────▼──────┐
        │ PostgreSQL │   │   Redis    │
        │ + PostGIS  │   │ cart/cache │
        │ + pg_trgm  │   │ pub/sub    │
        └────────────┘   └─────┬──────┘
                               │ BullMQ queues
                      ┌────────▼─────────┐
                      │  Worker process  │  1 PM2 fork instance
                      │ (apps/api/worker)│
                      └──────────────────┘
```

Source of bootstrap: `apps/api/src/index.ts` (HTTP server), `apps/api/src/app.ts`
(plugin + route registration), `apps/api/src/worker/index.ts` (worker process).

Deployment topology (`apps/api/ecosystem.config.js`):
- `api` — `tsx src/index.ts`, **4 instances, cluster mode**
- `worker` — `tsx src/worker/index.ts`, **1 instance, fork mode**

Because the API runs multiple instances, two cross-instance mechanisms exist:
- **Socket.IO Redis adapter** fans WebSocket broadcasts across all API instances
  (`apps/api/src/shared/plugins/realtime.plugin.ts:54-58`).
- **Redis pub/sub event-bus bridge** carries internal events between the worker and API
  processes (`apps/api/src/shared/events/event-bus.ts:76-98`).

---

## 2. Frontend Apps

All three are **Expo ~54 / React Native 0.81.5** apps. Each reads its own `.env`
(`EXPO_PUBLIC_*` only). Dev API host comes from `src/config/devHost.ts`; production base
URL is hardcoded to `https://api.chirawa.in/api/v1` in each app's API service.

### 2.1 customer-app — `apps/customer-app` (`@chirawa/customer-app`)
- **Purpose:** end-customer storefront, cart, checkout, order tracking.
- **Screens:** 39 `.tsx` screens under `src/screens/` (auth, home, categories, search,
  shop, product, orders, profile). Key screens: `home/HomeScreen.tsx`,
  `search/SearchScreen.tsx`, `product/ProductDetailScreen.tsx`,
  `orders/CheckoutScreen.tsx`, `orders/OrderTrackingScreen.tsx`,
  `orders/OrderHistoryScreen.tsx`, `profile/*` (addresses, privacy, share/receive address).
- **API layer:** uses the shared `@chirawa/api-client` via `src/services/api.service.ts`.
- **Realtime:** Socket.IO client in `src/screens/orders/OrderTrackingScreen.tsx:693`
  (subscribes `order:subscribe`; listens `order:status`, `order:location`, `order:eta`,
  `order:item-unavailable`).
- **Maps:** `react-native-maps` 1.20.1 (`src/components/tracking/TrackingMap.tsx`).
- **Notifications:** `expo-notifications` (`src/services/notifications.ts`).
- **Feature flags:** `src/config/features.ts` — `growthLoops: false`, `shopBrowsing: false`.
- **i18n:** `@chirawa/i18n` + `LanguagePickerScreen.tsx`.

### 2.2 seller-app — `apps/seller-app` (`@chirawa/seller-app`)
- **Purpose:** shopkeeper order queue, stock management, settlements.
- **Screens (9):** `auth/{OtpLogin,VerifyOtp,SetPin}Screen.tsx`,
  `orders/OrderQueueScreen.tsx`, `stock/StockScreen.tsx`, `stock/BarcodeScannerModal.tsx`,
  `settlement/SettlementScreen.tsx`, `profile/ProfileScreen.tsx`, `LanguagePickerScreen.tsx`.
- **API layer:** own client `src/services/api.service.ts` (`SellerApi`, not the shared client).
- **Offline tolerance:** `src/services/offline-queue.ts` — persists "I stock this" ops to
  `AsyncStorage` and replays them (idempotent server upsert).
- **Realtime:** Socket.IO in `src/screens/orders/OrderQueueScreen.tsx:102` (`order:new`,
  `order:status`, `order:cancelled`).
- **Auth:** PIN-gated after OTP (`requiresPin`).

### 2.3 rider-app — `apps/rider-app` (`@chirawa/rider-app`)
- **Purpose:** delivery rider availability, active deliveries, COD collection, earnings.
- **Screens (8):** `auth/{OtpLogin,VerifyOtp,SetPin}Screen.tsx`, `home/HomeScreen.tsx`,
  `delivery/DeliveryScreen.tsx`, `earnings/EarningsScreen.tsx`, `profile/ProfileScreen.tsx`,
  `LanguagePickerScreen.tsx`.
- **API layer:** own client `src/services/api.service.ts` (`RiderApi`).
- **Realtime:** Socket.IO in `home/HomeScreen.tsx:40` (`order:assigned`) and
  `delivery/DeliveryScreen.tsx:54` (`order:status`, `order:assigned`); emits
  `rider:location` + `rider:availability` to the server.
- **Auth:** PIN-gated after OTP.

---

## 3. Backend Service (`apps/api` — `@chirawa/api`)

A single **Fastify 4** application (`apps/api/src/app.ts`). Language: TypeScript, run via
`tsx` in dev, `tsc` build in prod. Module layout under `apps/api/src/modules/` — each
module is `*.routes.ts` (+ `*.service.ts`, `*.schema.ts`, plugins). Registered route
prefixes (`app.ts:171-184`):

| Module | Prefix | Primary files |
|---|---|---|
| auth | `/api/v1/auth` | `modules/auth/{auth.routes,auth.service,otp.service,token.service}.ts` |
| users | `/api/v1/users` | `modules/users/{users.routes,users.service,users.schema}.ts` |
| catalog | `/api/v1/catalog` | `modules/catalog/{catalog.routes,catalog.service,inventory.service,aggregation.service,master.service,moderation.service,requests.service}.ts` |
| search | `/api/v1` | `modules/catalog/search.routes.ts` |
| cart | `/api/v1/cart` | `modules/cart/{cart.routes,cart.service}.ts` |
| pricing | `/api/v1/pricing` | `modules/pricing/{pricing.routes,pricing.service,distance.service}.ts` |
| orders | `/api/v1/orders` | `modules/orders/{orders.routes,orders.service,resolver.service,eta.service}.ts` |
| payments | `/api/v1/payments` | `modules/payments/{payments.routes,payments.service,razorpay.service}.ts` |
| delivery | `/api/v1/delivery` | `modules/delivery/{delivery.routes,dispatch.service,batching.service}.ts` |
| admin | `/api/v1/admin` | `modules/admin/admin.routes.ts` |
| loyalty | `/api/v1/loyalty` | `modules/loyalty/loyalty.routes.ts` (**stub**) |
| notifications | `/api/v1/notifications` | `modules/notifications/{notifications.routes,notifications.plugin,fcm.service,sms.service}.ts` |
| sellers | `/api/v1/sellers` | `modules/sellers/{sellers.routes,sellers.service}.ts` |
| geo | `/api/v1/geo` | `modules/geo/{geo.routes,geo.service}.ts` |

**Health endpoints:** `GET /health` (liveness) and `GET /ready` (DB+Redis readiness),
`app.ts:142-168`.

**Fastify plugins registered (`app.ts:53-89`):** `prisma`, `redis`, `event-bus`, `queue`,
`realtime` (Socket.IO), `notifications`, `dispatch` (auto-assign), `seller-timeout`
(auto-accept), plus `@fastify/sensible`, `@fastify/helmet`, `@fastify/cors`,
`@fastify/rate-limit` (1000/min dev, 100/min prod), `@fastify/multipart` (5MB image cap).

**Worker process (`apps/api/src/worker/index.ts`):** consumes BullMQ queues for settlement,
reconciliation, cleanup, referral, order-assignment, enrichment; sets up recurring schedules
via `worker/scheduler.ts`.

---

## 4. Shared Packages (`packages/`)

### 4.1 `@chirawa/types` — `packages/types`
Shared DTOs, enums, and domain types (`src/index.ts` re-exports). Includes
`dto/order.dto.ts`, `dto/cart.dto.ts`, `dto/auth.dto.ts`, `dto/address.dto.ts`,
`dto/geo.dto.ts`, `dto/search.dto.ts`, `dto/pricing.dto.ts`, `dto/product.dto.ts`,
`dto/loyalty.dto.ts`; enums for user-role, order-status, payment-method/status,
rider-availability, stock-status; domain `money.ts`, `coordinates.ts`.

### 4.2 `@chirawa/api-client` — `packages/api-client`
Single typed REST client class `ChirawaApiClient` (`src/index.ts`, 504 lines) with
automatic JWT refresh + single-flight 401 retry. **Used by the customer-app only**; the
seller and rider apps have their own inline clients (`SellerApi` / `RiderApi`). Covers
auth, catalog, cart, delivery tracking, loyalty, addresses, geo, pricing, orders, search,
notifications.

### 4.3 `@chirawa/i18n` — `packages/i18n`
Translation strings (`src/translations.ts`, 641 lines), `LanguageProvider`/`useLanguage`
context, and `useT` hook. Used by all three apps' `LanguagePickerScreen`.

---

## 5. Infrastructure

- **Monorepo:** pnpm workspaces (`pnpm-workspace.yaml`, `pnpm-lock.yaml`). No Turbo/Nx
  (root `package.json` uses `pnpm -r`).
- **Local dev infra:** `docker-compose.yml` → PostgreSQL (`postgis/postgis:15-3.3`) and
  Redis (`redis:7-alpine`, `--maxmemory 256mb --maxmemory-policy noeviction`).
- **DB init:** `scripts/init-db.sql` enables extensions `postgis`, `pg_trgm`, `pgcrypto`,
  `uuid-ossp`. Additional indexes: `scripts/setup-postgis-indexes.sql`.
- **Process manager:** PM2 (`apps/api/ecosystem.config.js`) — 4× api (cluster) + 1× worker.
- **Container build:** root `Dockerfile`, `.dockerignore`.
- **Reverse proxy:** `scripts/nginx/` (nginx config).
- **CI/CD:** `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`;
  `scripts/deploy.sh`; `docs/github-secrets.md`.
- **Dev key generation:** `scripts/generate-dev-keys.mjs` (RS256 JWT keypair).
- **Test/utility scripts:** `scripts/test-{notifications,payments,realtime,worker}.{sh,mjs}`.
- **Config validation:** `apps/api/src/config/env.schema.ts` (zod) — production hard-fails
  if Razorpay secrets are still placeholders (`env.schema.ts:96-107`).

---

## 6. External Integrations

| Service | Purpose | Code | Dev-mode fallback |
|---|---|---|---|
| **Razorpay** (payments) | UPI/card checkout, signature + webhook verification, refunds | `modules/payments/razorpay.service.ts` | Unconfigured (placeholder keys) → mock order ids, signature/webhook checks skipped (`razorpay.service.ts:17-22,63-68`) |
| **RazorpayX** (payouts) | Seller settlement UPI payouts (contacts/fund-accounts/payouts REST API, Basic auth) | `razorpay.service.ts:103-208` | Unconfigured → settlement left `pending`, never faked |
| **Firebase Cloud Messaging** | Push notifications to all 3 apps | `modules/notifications/fcm.service.ts` | Empty `FCM_SERVICE_ACCOUNT_JSON` → push logged to console only |
| **Fast2SMS** | OTP delivery + critical SMS (delivered/cancelled/refund) | `modules/auth/otp.service.ts:153-182`, `modules/notifications/sms.service.ts` | `placeholder` key → SMS logged to console; **dev OTP bypass `123456`** (`otp.service.ts:101`) |
| **Mappls / MapmyIndia** | Backend geo proxy: place autocomplete + reverse geocode (OAuth token + REST key) | `modules/geo/geo.service.ts` | Placeholder creds → empty results; app falls back to on-device geocoder. `placeDetails()` always returns `null` (free tier has no coord API — `geo.service.ts:157-162`) |
| **Cloudflare R2** (S3-compatible) | Image storage (product/shop images) | `services/r2.service.ts`, `services/image-pipeline.ts` | Placeholder creds; `R2_PUBLIC_URL` defaults to localhost |
| **Open Food Facts (OFF)** | Catalog enrichment: bulk JSONL dump (worker) + single live lookup (seller scan) | `services/off-source.ts`, `services/off-live.ts`, `worker/jobs/enrichment.job.ts` | No dump path → items marked `needs_manual`; bulk never calls live API |
| **Google Maps** | Customer-app Android map render only (client key in `app.json`); **not** the backend geo proxy | (client-side) | n/a |
| **Sentry** | Crash/error reporting (API + worker) | `shared/observability/sentry.ts` | Empty DSN → no-op |

---

## 7. Databases

**PostgreSQL 15 + PostGIS + pg_trgm**, accessed via **Prisma 5** ORM.

- **Schema:** `apps/api/prisma/schema.prisma` (1058 lines) — **49 models, 11 enums**.
- **Migrations:** 26 migrations in `apps/api/prisma/migrations/` (init `20260525012222_init`
  through `20260617184209_eta_phase1`).
- **All money is integer paise** (documented in `docs/adr/002-integer-paise.md`); never float.

**Model groups (snake_case `@@map` table names):**
- **Identity:** `User`, `CustomerProfile`, `SellerProfile`, `RiderProfile`, `AdminProfile`.
- **Catalog:** `Shop`, `Category`, `Product`, `ProductVariant`, `ProductImage`,
  `MasterCatalog` (global GTIN dictionary), `ProductRequest`, `ImageReport`.
- **Address/Cart:** `Address`, `Cart`, `CartItem`.
- **Orders:** `Order`, `OrderGroup`, `OrderItem`, `OrderStatusHistory`.
- **Payments:** `Payment`, `PaymentWebhookEvent`.
- **Delivery:** `DeliveryAssignment`, `RiderLocation`, `RiderAvailability`, `DeliveryZone`,
  `Batch`, `RiderZone`.
- **Pricing/Ledger:** `FeeRule`, `Transaction`, `Settlement`, `RiderSettlement`.
- **Loyalty/Wallet/Referrals:** `WalletTransaction`, `LoyaltyTier`, `ReferralCode`,
  `ReferralRedemption`.
- **Promotions:** `PromoCode`, `PromoRedemption`.
- **Auth/Security:** `OtpAttempt`, `RefreshToken`.
- **Audit/Ops:** `AuditLog`, `Notification`, `StockUpdateLog`, `AppConfig`, `SearchAlias`.

**Enums:** `UserRole`, `OrderStatus` (9 states), `PaymentMethod`, `PaymentStatus`,
`StockStatus`, `MasterStatus`, `RiderAvailabilityStatus`, `TransactionType` (11 types),
`SettlementStatus`, `NotificationChannel`, `AuditAction`.

**Seed data:** `prisma/seed.ts` + `prisma/seeds/{shops,zones,riders,search-aliases,dev-images}.ts`
+ `prisma/backfill-barcode.ts`. Seeds FeeRule v1, shops, delivery zones, riders, search aliases.

---

## 8. Queues (BullMQ on Redis)

Queue names + job names in `apps/api/src/worker/queues.ts`. Workers in `worker/index.ts`.

| Queue (`QueueNames`) | Jobs | Worker concurrency | Schedule (`worker/scheduler.ts`) |
|---|---|---|---|
| `chirawa-settlement` | `daily-settlement`, `single-seller-settle`, `payout-reconcile` | 1 | daily 05:30 UTC (11 AM IST); payout-reconcile every 30 min |
| `chirawa-reconciliation` | `payment-reconcile` | 1 | every 15 min |
| `chirawa-cleanup` | `location-cleanup`, `otp-cleanup`, `token-cleanup`, `cart-cleanup` | 2 | location 20:30 UTC, otp every 6h, token 21:30 UTC, cart hourly |
| `chirawa-referral` | `unlock-referral` | 5 | (on-demand — **producer is disconnected, see FEATURE_INVENTORY**) |
| `chirawa-order-assignment` | `assign-batch` | 3 | on-demand (delayed by batch window); retries 10× @ 60s then SMS escalation |
| `chirawa-seller-accept` | `auto-accept` | 5 (run in API process via `seller-timeout.plugin`) | delayed `SELLER_ACCEPT_MS` (3 min) |
| `chirawa-enrichment` | `catalog-enrich` | 1 | nightly 19:30 UTC (1 AM IST) |
| `chirawa-notification` | `send-push`, `send-sms` (names declared) | — | (names exist in `queues.ts`; push/SMS are sent inline via plugin, not via this queue) |

---

## 9. Storage

- **Object storage:** Cloudflare R2 (S3-compatible via `@aws-sdk/client-s3`) — product and
  shop images. Upload + normalize pipeline: `services/r2.service.ts`,
  `services/image-pipeline.ts` (square ~1200px WebP, EXIF stripped, content-hash re-host,
  `sharp` 0.35). 5 MB upload cap.
- **Redis (`ioredis` 5):** carts (`cart:{userId}`, 24h TTL), OTP data + rate-limit counters,
  FCM device tokens (`fcm:token:{userId}`, 90d TTL), rider live location
  (`rider:{userId}:location`, 30s TTL) + availability, aggregated-feed cache
  (`catalog:agg:all`), per-shop catalog cache (`catalog:shop:{id}:full`), search/alias
  caches, Socket.IO adapter pub/sub, BullMQ queue backing store, event-bus pub/sub channel
  (`chirawa:events:v1`).
- **PostgreSQL:** the durable system of record (see §7). Cart, rider location, and OTP have
  DB copies in addition to their Redis primaries.
- **Client storage:** `AsyncStorage` in each app (tokens via `storage.service.ts`;
  seller offline queue).

---

## 10. Authentication Systems

**Phone + OTP** primary auth for all roles, with **RS256 JWT** access tokens and rotating
opaque refresh tokens. Code: `modules/auth/`, `shared/middleware/auth.middleware.ts`,
`shared/plugins`/socket auth.

- **OTP** (`auth/otp.service.ts`): 6-digit `crypto.randomInt`, Redis 5-min TTL, per-phone
  (3/hr, 10/day) and per-IP (20/hr) rate limits, 5-attempt lockout (15 min). Audit rows in
  `OtpAttempt`. **Dev bypass:** code `123456` in non-production (`otp.service.ts:101`).
- **JWT access token** (`auth/token.service.ts`): RS256, 15-min expiry, issuer
  `chirawa-api`, payload `{ sub: userId, role, profileId }`. Private key signs, public key
  verifies (`JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`).
- **Refresh token** (`auth/token.service.ts`): 64-char random hex, stored as SHA-256 hash in
  `RefreshToken`, 7-day expiry, **rotation with reuse-detection** (reused token → revoke all
  user sessions). Client auto-refresh on 401 (`api-client/src/index.ts:84-104`,
  seller/rider `api.service.ts`).
- **Roles:** `customer | seller | rider | admin`. Guarded by `authenticate` + `requireRole`
  middleware (`shared/middleware/auth.middleware.ts`).
- **PIN** (`auth/auth.service.ts:198-283`): seller/rider/admin set a bcrypt PIN after first
  login (`requiresPin` flag); 5-fail lockout (15 min). Customer has no PIN.
- **Socket.IO auth** (`shared/plugins/realtime.plugin.ts:62-82`): every socket handshake must
  carry a valid access token; joins `user:{id}` + role rooms.
- **New users** are always created with role `customer` on first OTP verify
  (`auth.service.ts:65-94`); seller/rider/admin accounts are seeded/provisioned out-of-band.
