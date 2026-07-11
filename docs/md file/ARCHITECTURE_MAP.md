# ARCHITECTURE_MAP.md

> Layered architecture, module dependencies, and process topology for Chirawa/Bringly.
> Description only — no recommendations. Citations are exact files.

---

## 1. Layered Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND APPS  (Expo / React Native 0.81)                                     │
│                                                                                │
│  customer-app            seller-app             rider-app                      │
│  ├─ @chirawa/api-client  ├─ SellerApi (own)     ├─ RiderApi (own)              │
│  ├─ socket.io-client     ├─ socket.io-client    ├─ socket.io-client           │
│  ├─ expo-notifications   ├─ offline-queue       ├─ rider:location emit         │
│  └─ react-native-maps    └─ barcode scanner     └─ availability/COD            │
│         @chirawa/types  ·  @chirawa/i18n  (shared)                             │
└───────────────┬───────────────────────────────────────────┬──────────────────┘
                │ HTTPS  REST /api/v1/*                       │ WebSocket (Socket.IO)
                ▼                                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  API SERVICE  (Fastify 4 — apps/api/src/app.ts)   ×4 PM2 cluster instances     │
│                                                                                │
│  Routes → Services → Prisma                                                    │
│  auth · users · catalog · search · cart · pricing · orders · payments ·        │
│  delivery · admin · loyalty(stub) · notifications · sellers · geo              │
│                                                                                │
│  Plugins: prisma · redis · event-bus · queue · realtime · notifications ·      │
│           dispatch · seller-timeout · cors/helmet/ratelimit/multipart          │
└───┬──────────────┬──────────────┬──────────────┬──────────────────────────────┘
    │              │              │              │
    ▼              ▼              ▼              ▼
┌─────────┐  ┌──────────┐  ┌────────────┐  ┌──────────────────────────────┐
│ DATABASE│  │  REDIS    │  │  EVENTS    │  │  NOTIFICATIONS               │
│ Postgres│  │ cart/cache│  │ event-bus  │  │ FCM (push) · Fast2SMS (SMS)  │
│ +PostGIS│  │ pub/sub   │  │ + Redis    │  │ Socket.IO broadcast          │
│ +pg_trgm│  │ BullMQ    │  │ bridge     │  │                              │
│ (Prisma)│  │ tokens    │  │            │  │                              │
└─────────┘  └────┬─────┘  └─────┬──────┘  └──────────────────────────────┘
                  │ BullMQ queues │ chirawa:events:v1
                  ▼               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  WORKER  (apps/api/src/worker/index.ts)   ×1 PM2 fork instance                 │
│  settlement · reconciliation · cleanup · referral · order-assignment ·         │
│  enrichment   (+ scheduler: recurring jobs)                                    │
└──────────────────────────────────────────────────────────────────────────────┘
            │ RazorpayX            │ Razorpay         │ OFF dump → R2
            ▼                      ▼                  ▼
        [seller payouts]      [reconcile]        [image enrichment]
```

---

## 2. Request → Persistence Path (vertical slice)

```
Mobile app
   │  fetch / Authorization: Bearer <RS256 JWT>
   ▼
Fastify route (modules/<m>/<m>.routes.ts)
   │  preHandler: authenticate → requireRole(...)            (auth.middleware.ts)
   │  zod parse (modules/<m>/<m>.schema.ts)
   ▼
Service (modules/<m>/<m>.service.ts)
   │  business rules + state machine (orders.service: ORDER_TRANSITIONS)
   ├─► app.prisma  → PostgreSQL                              (prisma.plugin.ts)
   ├─► app.redis   → cart / cache / tokens                   (redis.plugin.ts)
   ├─► app.queues  → BullMQ (worker)                         (queue.plugin.ts)
   └─► emit*()     → event-bus                               (event-bus.ts)
                       │ local EventEmitter + Redis publish
                       ├─► realtime.plugin  → Socket.IO rooms
                       ├─► notifications.plugin → FCM / SMS
                       ├─► dispatch.plugin → batching/assignment
                       └─► seller-timeout.plugin → auto-accept timer
```

---

## 3. Plugin Load Order (`apps/api/src/app.ts:53-89`)

```
1. prisma          (DB client → app.prisma)
2. redis           (ioredis → app.redis)
3. event-bus       (after redis — starts Redis pub/sub bridge for cross-process events)
4. queue           (after prisma+redis — app.queues: settlement/recon/cleanup/referral/assignment/sellerAccept/enrichment)
5. realtime        (Socket.IO + Redis adapter; wires event-bus → socket broadcasts)
6. notifications   (after prisma+redis; wires event-bus → FCM/SMS)
7. dispatch        (after queues; ORDER_STATUS_CHANGED:confirmed → batch + schedule assign)
8. seller-timeout  (after queues; NEW_ORDER_FOR_SELLER → schedule auto-accept; runs auto-accept worker IN api process)
9. HTTP plugins    (sensible, helmet, cors, rate-limit, multipart)
10. error handler + /health + /ready
11. module routes  (auth, users, catalog, search, cart, pricing, orders, payments, delivery, admin, loyalty, notifications, sellers, geo)
```

---

## 4. Module Dependency Map (API services)

```
orders.service ──┬─► pricing.service        (delivery fee, fee-rule version)
                 ├─► promotions.service      (validate/auto promo)
                 ├─► resolver.service        (aggregated line → concrete shop)
                 ├─► payments.service         (refundCapturedOrderPayment / refundOrderLine)
                 ├─► catalog.service          (invalidateShopCache on item-unavailable)
                 ├─► eta.service              (computeAndPersistEta)
                 └─► event-bus                (emit order/seller/item events)

payments.service ─┬─► razorpay.service       (order/refund/signature/webhook)
                  └─► event-bus              (paid / new-order / cancelled)

delivery: dispatch.service / batching.service ─┬─► geo utils (pointInPolygon, haversine)
                                               ├─► eta.service
                                               └─► event-bus (ORDER_ASSIGNED_TO_RIDER)

catalog.routes ──┬─► catalog.service         (shops/products/search/caches)
                 ├─► inventory.service        (CRUD/variants/CSV/stock-this)  ─► image-pipeline ─► r2.service
                 ├─► aggregation.service      (feed + daily-essentials)
                 ├─► master.service           (barcode lookup) ─► off-live
                 └─► requests.service         (demand + restock notify) ─► FCM

admin.routes ────┬─► moderation.service      (review queue/coverage/metrics/takedown)
                 ├─► requests.service
                 ├─► image-pipeline ─► r2.service
                 └─► prisma (search aliases, imports, dispatch snapshot)

auth.service ────┬─► otp.service ─► Fast2SMS
                 └─► token.service (RS256 JWT + refresh rotation)

users.service / sellers.service / geo.service ─► prisma (+ geo.service ─► Mappls)
```

**Worker job dependencies (`worker/index.ts`):**
```
settlement.job      ─► razorpay.service (RazorpayX payouts)        ─► prisma
reconciliation.job  ─► razorpay.service + payments.service.markOrderPaid + FCM ─► prisma, redis, sellerAcceptQueue
assignment.job      ─► batching.service + sms.service              ─► prisma, redis, queue
enrichment.job      ─► off-source + image-pipeline (r2.service)    ─► prisma
referral.job        ─► prisma   (NOTE: no producer enqueues it — see FEATURE_INVENTORY E8)
cleanup.job         ─► prisma, redis
```

---

## 5. Event Bus Topology (`shared/events/event-bus.ts`)

```
EMITTERS (services, either process)                 LISTENERS (API process only)
  orders.service       ─┐                          ┌─► realtime.plugin   → Socket.IO rooms:
  payments.service      ├─ emit*() ─► dispatch():   │     order:{id}, user:{id}, seller:{id}, rider:{id}
  dispatch/batching     │   1) local EventEmitter ──┤
  eta.service           │   2) Redis PUBLISH ───────┼─► notifications.plugin → FCM + Fast2SMS + Notification row
  reconciliation.job   ─┘      chirawa:events:v1    ├─► dispatch.plugin   → batch + schedule assign-batch
                                                    └─► seller-timeout.plugin → schedule auto-accept

Cross-process: worker emits → Redis publish → API subscribers re-emit locally
(PROCESS_ID tag prevents self-echo). startEventBusBridge() runs in API only.
```

Events: `ORDER_STATUS_CHANGED`, `NEW_ORDER_FOR_SELLER`, `ORDER_CANCELLED_FOR_SELLER`,
`ORDER_ASSIGNED_TO_RIDER`, `ORDER_ITEM_UNAVAILABLE`, `ORDER_ETA_CHANGED`.

Socket emits to clients: `order:status`, `order:location`, `order:eta`,
`order:new`, `order:cancelled`, `order:assigned`, `order:item-unavailable`,
`rider:availability:confirmed`, `connected`. Client→server: `order:subscribe/unsubscribe`,
`rider:location`, `rider:availability`.

---

## 6. Process & Scaling Topology

```
PM2 (apps/api/ecosystem.config.js)
├─ api    ×4  (cluster)  — Fastify + Socket.IO   ── Socket.IO Redis adapter fans broadcasts across all 4
└─ worker ×1  (fork)     — BullMQ workers + scheduler

Shared backing services (docker-compose.yml in dev):
├─ PostgreSQL 15 + PostGIS  (system of record, Prisma)
└─ Redis 7                  (cart, cache, tokens, BullMQ, Socket.IO adapter, event-bus pub/sub)

External (prod): Razorpay/RazorpayX · FCM · Fast2SMS · Mappls · Cloudflare R2 · OFF · Sentry
```

---

## 7. Data Model Relationship Clusters (`prisma/schema.prisma`)

```
User ──1:1── CustomerProfile / SellerProfile / RiderProfile / AdminProfile
User ──1:N── Address, Order(customer), RefreshToken, Notification, WalletTransaction, AuditLog
SellerProfile ──1:1── Shop ──1:N── Category, Product, Order, Settlement
Product ──N:1── MasterCatalog (GTIN dictionary) ; ──1:N── ProductVariant, ProductImage
Order ──N:1── OrderGroup ; ──1:N── OrderItem, OrderStatusHistory, Payment, DeliveryAssignment
Order ──N:1── Shop, Address, PromoCode, Batch ; rider via Order.riderId (denormalized → RiderProfile.id)
DeliveryAssignment ──N:1── RiderProfile, Order ; Batch ──N:1── DeliveryZone
RiderProfile ──1:1── RiderAvailability ; ──N:N── DeliveryZone (via RiderZone)
PromoCode ──1:N── PromoRedemption ; ReferralCode ──1:N── ReferralRedemption
Transaction / Settlement / RiderSettlement = financial ledger (referenceId/Type polymorphic)
```

---

## 8. Cross-cutting Concerns

| Concern | Mechanism | Location |
|---|---|---|
| AuthN/AuthZ | RS256 JWT + `requireRole` | `shared/middleware/auth.middleware.ts`, `auth/token.service.ts` |
| Error shape | `{success:false,error:{code,message}}` | `app.ts:94-139`, `shared/errors/app-errors.ts` |
| Rate limiting | global + per-route (`perUserRateLimit`) | `app.ts:71-84`, `shared/middleware/rate-limit.ts` |
| Observability | Sentry (no-op without DSN) | `shared/observability/sentry.ts` |
| Config validation | zod, prod hard-fail on placeholder Razorpay | `config/env.schema.ts`, `config/env.ts` |
| Idempotency | webhook events, payouts, stock-this, barcode upsert | `payments.service`, `settlement.job`, `inventory.service`, `shared/utils/idempotency.ts` |
| Money | integer paise everywhere | ADR `docs/adr/002-integer-paise.md` |
| Operating hours | 9 AM–8 PM gate at checkout | `shared/config/operating-hours.ts` |

---

## DISCOVERY_COMPLETENESS_SCORE: **88 / 100**

**Basis.** The full backend (`apps/api/src`) was read at the source level: the Prisma schema
(all 49 models / 11 enums), `app.ts`, all plugins, the event bus, every route module's
endpoints, and the core services (orders, payments, cart, pricing, ETA, resolver, dispatch,
batching, catalog routes/aggregation/inventory, auth/OTP/token, geo, users, sellers,
promotions, admin), all worker jobs, the scheduler, Razorpay/FCM/SMS integrations, the env
schema, and DB init. The shared `api-client` (full API surface), socket usage across all
three apps, the seller/rider API clients, the offline queue, feature flags, and frontend
screen/file inventories were read or enumerated. External integrations and their dev-mode
fallbacks were traced to code. Dead/partial/stub/dormant items were verified against source
(referral producer, loyalty stub, audit-log absence, distance-fee dormancy).

**Why not higher (the ~12 points).** The following were enumerated or sampled but **not read
line-by-line**, so behavioral detail there is inferred from names/signatures/usage rather
than full source:

### Files/areas NOT fully analyzed (read by name/usage, not line-by-line)
- **API services skimmed via routes/usage (not fully read):** `catalog/catalog.service.ts`
  (756 lines — search SQL grepped, not fully read), `catalog/master.service.ts`,
  `catalog/moderation.service.ts`, `catalog/requests.service.ts`, `catalog/hinglish-aliases.ts`,
  `pricing/distance.service.ts`, `worker/jobs/enrichment.job.ts`, `services/{r2.service,image-pipeline,off-source,off-live}.ts`,
  `notifications/notification.templates.ts`, `shared/utils/{barcode,geo,idempotency,phone}.ts`,
  `shared/errors/app-errors.ts`, `shared/plugins/{prisma,redis,queue,event-bus}.plugin.ts`,
  `shared/observability/sentry.ts`, `shared/config/operating-hours.ts`, `config/env.ts`.
- **All `__tests__/` directories** (≈30 test files across modules/worker/services) — not read.
- **Frontend deep internals NOT read:** the bodies of all 39 customer-app screens (only
  `OrderTrackingScreen` socket section inspected), all seller-app & rider-app screen bodies
  beyond socket usage, all `components/*` and `theme/*`, customer `AuthContext`/`CartContext`/
  `AddressContext` bodies (sized, not read), `catalog.ts` service (215 lines), each app's
  `navigation/*`, `hooks/*`, `utils/*`, `notifications.ts`, `storage.service.ts`.
- **Prisma seeds:** `prisma/seeds/{shops,zones,riders,search-aliases,dev-images}.ts` and
  `prisma/backfill-barcode.ts` — `seed.ts` head only.
- **Migrations:** 26 migration directories listed but SQL not read individually.
- **Infra/config not opened:** `Dockerfile`, `.github/workflows/{ci,deploy}.yml`,
  `scripts/{deploy.sh,nginx/*,setup-postgis-indexes.sql,test-*.{sh,mjs},generate-dev-keys.mjs}`,
  root `tsconfig*.json`, `.eslintrc*`, `vitest.config.ts`, `ecosystem.config.js` (only grepped).
- **Documentation (not analyzed as system behavior, only listed):** `README.md`,
  `docs/BRINGLY_PRODUCTION_PLAN.md`, `docs/blinkit-redesign-plan*.md`, `docs/adr/*` (cited, not
  fully read), and the entire `docs/md file/` folder (≈38 prior analysis/plan/report markdowns).
- **Binary/asset:** `ss/1.jpeg`, `ss/2.jpeg` (screenshots), `node_modules/`, `pnpm-lock.yaml`.
- **Git working-tree note:** the repo is on branch `fix/order-rider-id-identity` with
  uncommitted modifications to several order/tracking files and many deleted root `*.md` docs
  (per `git status`); this inventory reflects the **working-tree source as read**, not any
  single commit.

No recommendations, fixes, or audits are included, per the discovery-mode scope.
