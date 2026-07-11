# SYSTEM_MAP.md — Chirawa Platform Architecture

> **Source of truth.** Every claim here is traced to code. Citations are `path:line`.
> Where the implementation and intent diverge, the **code** wins and the divergence is flagged.
>
> **Brand note:** the repo, DB role, and most identifiers say **Chirawa**; user-facing
> strings say both **Chirawa** and **Bringly** (e.g. `orders.service.ts:139`, `settlement.job.ts:209`).
> They are the same product. Treat "Bringly" in copy as the marketing name.

---

## 1. What this system is

A **single-town quick-commerce platform** (Chirawa, Rajasthan — a dense ~3 km town).
Customers order groceries/goods from local shops; shopkeepers accept and prepare;
salaried riders pick up and deliver. Three mobile apps over one backend.

Deliberately **flat and town-scoped**: flat delivery fees (no distance billing,
`pricing.service.ts`), one delivery zone model, rider **salary** not per-trip pay,
operating hours **9 AM – 8 PM IST** (`orders.service.ts:139`).

---

## 2. Components

### Apps (`apps/`)
| App | Stack | Actor | Entry screens |
|-----|-------|-------|---------------|
| `customer-app` | Expo / React Native | Customer | `screens/{home,categories,search,shop,product,orders,profile,auth}` |
| `seller-app` | Expo / React Native | Shopkeeper | `OrderQueueScreen`, `StockScreen`, `SettlementScreen` |
| `rider-app` | Expo / React Native | Delivery rider | `HomeScreen`, `delivery/DeliveryScreen`, `EarningsScreen` |
| `api` | Fastify v4 + Prisma v5 + Postgres + Redis + BullMQ v5 + Socket.IO v4 | — | `apps/api/src/app.ts` |

There is **no dedicated admin app in this repo** — admin/operations is a set of
authenticated REST endpoints (`modules/admin/admin.routes.ts`) consumed by founders'
tooling, plus the rider/seller apps for field ops.

### Shared packages (`packages/`)
- `api-client` — typed HTTP/socket client shared by all three apps.
- `i18n` — Hindi/English strings (`packages/i18n/src/translations.ts`).
- `types` — shared DTOs (`packages/types/src/dto/order.dto.ts`).

### Backend processes
The API and the **worker** are two **separate OS processes** (`apps/api/src/index.ts`
boots Fastify; `apps/api/src/worker/index.ts` boots BullMQ workers). This split is
the single most important architectural fact in the system — see §6.

---

## 3. Backend module map (`apps/api/src/modules`)

| Module | Owns | Key files |
|--------|------|-----------|
| `auth` | OTP login, JWT, PIN, refresh rotation | `auth.service.ts`, `otp.service.ts`, `token.service.ts` |
| `users` | Profiles, addresses, FCM token registration | `users/*` |
| `catalog` | Shops, products, variants, images, master catalog, moderation, search | `catalog.service.ts`, `moderation.service.ts`, `resolver.service.ts` (in orders) |
| `cart` | Redis-backed cart (per-item, multi-shop) | `cart.service.ts` |
| `pricing` | Flat delivery fee + fee-rule versioning | `pricing.service.ts` |
| `promotions` | Promo codes, auto-promo (FIRSTORDER) | `promotions.service.ts` |
| `orders` | **Order lifecycle, state machine, ETA, aggregation** | `orders.service.ts`, `order-status.ts`, `eta.service.ts`, `resolver.service.ts` |
| `payments` | Razorpay orders, webhooks, refunds, settlements payout | `payments.service.ts`, `razorpay.service.ts` |
| `delivery` | Zones, batching, dispatch, rider actions | `dispatch.service.ts`, `batching.service.ts` |
| `notifications` | FCM push + SMS, event→notification | `notifications.plugin.ts`, `fcm.service.ts`, `sms.service.ts` |
| `sellers` | Seller sales summary + settlement history | `sellers.service.ts` |
| `loyalty` | Wallet/loyalty (**HIDDEN for launch**, see §9) | `loyalty/*` |
| `admin` | Operations: dispatch view, moderation, imports | `admin.routes.ts` |
| `geo` | Geocoding helpers | `geo/*` |

Routes are registered under `/api/v1/*` in `app.ts:171-184`.

---

## 4. Data model (`apps/api/prisma/schema.prisma`, 1058 lines)

### Identity
- `User` (`:106`) — `phone` (unique), `role` ∈ {customer, seller, rider, admin}. One per phone.
- `CustomerProfile` / `SellerProfile` / `RiderProfile` / `AdminProfile` — 1:1 with User.
  PIN hash + fail-count/lockout live on seller/rider/admin profiles.

### Catalog
- `Shop` (`:220`) — 1:1 with seller. `isActive`, `isOpen`, `isFeatured` (Chirawa Special),
  `commissionRate` (defaults 0), `prepTimeMinutes` (ETA), lat/lng.
- `Category`, `Product` (`:281`), `ProductVariant`, `ProductImage`.
- `Product.stockQty` is **opt-in numeric stock** (null = untracked) — drives oversell
  protection (`:292`). `Product.stockStatus` ∈ {available, out_of_stock, hidden}.
- `MasterCatalog` (`:369`) — global barcode (GTIN) "dictionary" row; products reference it
  via `masterId`. Drives cross-shop aggregation. Not sellable.
- `ProductRequest`, `ImageReport` — demand capture + wrong-image moderation.

### Orders & money (all amounts **integer paise, never float**)
- `Order` (`:506`) — the core entity. **Address is snapshotted** at order time
  (`deliveryStreet…deliveryLng`, `:511`), never an FK, so the order is immutable.
  One Order = **one shop**. `groupId` ties per-shop children into one `OrderGroup`.
- `OrderItem` (`:612`) — snapshot of name/price/qty; `fulfillmentStatus` +
  `refundedPaise` carry the item-unavailable safety net.
- `OrderStatusHistory` (`:635`) — append-only audit of every transition.
- `Payment` (`:652`) — `razorpayOrderId`/`razorpayPaymentId`, status, `refundedPaise`.
- `PaymentWebhookEvent` (`:672`) — webhook idempotency (`eventId` unique).
- `Transaction` (`:795`) — append-only financial ledger.
- `Settlement` (`:809`) / `RiderSettlement` (`:838`) — seller daily / rider monthly payouts.

### Delivery
- `DeliveryAssignment` (`:684`) — rider↔order link; `isActive` is what makes an order
  appear in a rider's active list.
- `RiderLocation` (`:703`) — location pings (7-day retention).
- `RiderAvailability` (`:715`) — online/offline/on_delivery + last location.
- `DeliveryZone` (polygon), `Batch` (`:747`), `RiderZone`.

### Ops/security
- `FeeRule` (versioned pricing), `AuditLog`, `Notification`, `StockUpdateLog`,
  `AppConfig` (e.g. `support_phone`), `OtpAttempt`, `RefreshToken`, `SearchAlias`.

> **Two id systems to keep straight:** `Order.riderId` stores a **RiderProfile.id**
> (denormalized, no FK relation). JWT `sub` is a **User.id**. Several "BUG-1" fixes
> in the code exist because these were confused (`orders.service.ts:431`,
> `dispatch.service.ts:189`). The socket auth carries `profileId` for exactly this reason.

---

## 5. Realtime architecture

Three transport layers, fully decoupled from business logic:

```
 service (orders/payments/delivery)
        │  emitOrderStatusChanged(...)  ← typed helpers, shared/events/event-bus.ts
        ▼
 ┌─────────────────────────────────────────────┐
 │ event-bus (Node EventEmitter)               │  local, synchronous
 │   + dispatch() also PUBLISHES to Redis      │  cross-process fan-out
 │     channel "chirawa:events:v1"             │
 └─────────────────────────────────────────────┘
        │ local emit                    │ Redis pub/sub
        ▼                               ▼
 in-process listeners            other process's startEventBusBridge()
 (realtime.plugin,               re-emits onto its local bus
  notifications.plugin,          (skips its own echo via PROCESS_ID)
  dispatch.plugin,
  seller-timeout.plugin)
        │
        ├─► Socket.IO (realtime.plugin.ts) ── Redis adapter ──► customer/seller/rider sockets
        └─► FCM/SMS  (notifications.plugin.ts) ──────────────► push notifications
```

- **Event bus** (`shared/events/event-bus.ts`): every emit is delivered locally **and**
  published to Redis so the *other* process's listeners fire too (`:61-70`). The bridge
  is started once per process via `startEventBusBridge()` (`:76`).
- **Socket.IO** (`realtime.plugin.ts`): JWT-authenticated (`:63`), Redis-adapter for
  multi-instance broadcast (`:55-59`). Rooms: `user:{userId}`, `seller:{userId}`,
  `rider:{userId}`, `order:{orderId}`. `order:subscribe` is **IDOR-guarded** —
  only the order's customer/seller/rider/admin may join (`realtime.helpers.ts:30`).
- **Rider location**: client pushes `rider:location` ~every 8s → written to Redis
  (`rider:{userId}:location`, 30s TTL) + broadcast to the order room + persisted to DB
  (`realtime.plugin.ts:129-162`).

### Event catalogue (`event-bus.ts:111`)
| Event | Emitted by | Consumed by → effect |
|-------|-----------|----------------------|
| `ORDER_STATUS_CHANGED` | every status transition | socket `order:status`; notifications (FCM/SMS); **dispatch.plugin** (on `confirmed`) |
| `ORDER_ETA_CHANGED` | `computeAndPersistEta` | socket `order:eta` (sent as duration + serverNow, clock-skew safe) |
| `NEW_ORDER_FOR_SELLER` | checkout / `markOrderPaid` | socket `order:new` (alarm modal); FCM; **seller-timeout** auto-accept timer |
| `ORDER_CANCELLED_FOR_SELLER` | customer cancel | socket `order:cancelled` |
| `ORDER_ASSIGNED_TO_RIDER` | dispatch / batching | socket `order:assigned`; FCM |
| `ORDER_ITEM_UNAVAILABLE` | rider report | socket `order:item-unavailable` (+ substitute suggestion) |

---

## 6. The two-process model (critical)

Socket.IO and FCM listeners run **only in the API process**. Some emitters run in the
**worker process** (batching assigns a rider; reconciliation marks orders paid).

A plain `EventEmitter` is in-process only, so worker-emitted events would be silently
dropped. Two mechanisms close the gap:

1. **Redis pub/sub bridge** (`event-bus.ts`) — best-effort cross-process delivery.
   It is **fire-and-forget with no persistence or replay** — a hiccup drops the message.
2. **Durable direct effects** where loss is unacceptable. The payment-reconciliation
   job does **not** rely on the bridge: it directly enqueues the seller auto-accept
   BullMQ job and sends the seller FCM itself (`reconciliation.job.ts:81-125`), because
   reconciliation only runs for orders whose normal flow *already* failed.

> **Design rule:** anything that *must* happen goes through Postgres + BullMQ (durable);
> anything that's a live nicety (socket pushes) goes through the bus/bridge.

---

## 7. Background work (`worker/scheduler.ts`)

| Job | Cadence | Purpose |
|-----|---------|---------|
| `daily-settlement` | 11:00 IST | Pay sellers for yesterday's delivered orders |
| `payout-reconcile` | every 30 min | Finalize in-flight RazorpayX payouts |
| `payment-reconcile` | every 15 min | Rescue orders stuck in `pending_payment` >30 min |
| `location-cleanup` | 02:00 IST | Purge old `RiderLocation` |
| `otp-cleanup` | every 6 h | Purge `OtpAttempt` |
| `token-cleanup` | 03:00 IST | Purge expired refresh tokens |
| `cart-cleanup` | hourly | Expire stale carts |
| `catalog-enrich` | 01:00 IST | Image enrichment from OFF dump |
| `assign-batch` | on demand + retry 60s ×10 | Assign delivery batch to a rider, escalate by SMS |
| `auto-accept` | 3 min after new order | Auto-accept orders the seller ignored (runs in **API** process) |

---

## 8. Auth & security posture

- **Customers**: phone OTP only; auto-created on first verify (`auth.service.ts:65`).
- **Seller/Rider/Admin**: OTP **+ PIN** (bcrypt cost 12); 5 wrong PINs → 15-min lockout
  (`auth.service.ts:251-274`). `requiresPin` flag tells the app to run first-time PIN setup.
- **Tokens**: access JWT 15 min (`expiresIn: 900`), refresh token rotated on use
  (`token.service.ts`), hashed at rest (`RefreshToken.tokenHash`).
- **OTP rate limits** (`otp.service.ts:24-54`): 3/phone/hr, 10/phone/24h, 20/IP/hr; 5 wrong
  → 15-min lockout. Dev bypass `123456` only when `NODE_ENV=development` (`otp.service.ts:101`).
- **Role guards**: `requireRole(...)` preHandlers on every privileged route.
- **IDOR**: order access is ownership-checked in both REST (`orders.service.ts:369`) and
  sockets (`realtime.helpers.ts:30`). Rider PII (name/phone) is exposed to the customer
  **only** during active delivery (`orders.service.ts:385-403`).

> **Known seeding gotcha** (operational): seeded sellers store `+91`-prefixed phones while
> auth normalizes to 10 digits — seeded accounts can fail login. Dev OTP `123456` works.

---

## 9. Launch scoping

Per launch decisions, **growth loops are hidden**: referral, loyalty tiers, and wallet
exist in the schema (`ReferralCode`, `LoyaltyTier`, `WalletTransaction`,
`CustomerProfile.walletBalance`) and have partial backend, but are **not surfaced** in
the apps for launch (no budget). Treat them as dormant — present in data, off in product.

Commission is **0** at launch: `Shop.commissionRate` / `Category.commissionRate` default 0
and `Settlement.platformFeePaise` is hardcoded 0 (`settlement.job.ts:110`). The platform's
only revenue lever wired today is the **delivery fee**.

---

## 10. The four lifecycle documents

- **ORDER_LIFECYCLE.md** — checkout → payment → accept → prepare → dispatch → deliver → settle.
- **SELLER_LIFECYCLE.md** — onboarding → catalog → order queue → stock → settlement.
- **RIDER_LIFECYCLE.md** — onboarding → availability → assignment → pickup → delivery → COD → pay.
- **OPERATIONS_LIFECYCLE.md** — dispatch monitoring, moderation, settlements, escalations, cron.
