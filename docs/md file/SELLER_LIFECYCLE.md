# SELLER_LIFECYCLE.md

> The seller (shopkeeper) lifecycle: onboarding → catalog → live order queue → stock →
> daily settlement. Traced to code; citations `path:line`.
> App: `apps/seller-app` — screens `OrderQueueScreen`, `StockScreen`, `SettlementScreen`,
> `ProfileScreen`, plus `auth/{OtpLoginScreen,VerifyOtpScreen,SetPinScreen}`.

---

## 1. Actors & ownership

| Actor | Responsibility |
|-------|----------------|
| Seller (shopkeeper) | Runs the shop: accepts/prepares orders, manages stock, gets paid |
| Admin / Ops | Creates the seller + shop, onboards catalog, uploads images, sets UPI |
| System | Auto-accepts ignored orders; runs daily settlement payout |

**Ownership rule:** a seller owns exactly **one** `Shop` (`Shop.sellerId` is unique,
`schema.prisma:222`). Every seller action resolves the shop from the JWT user
(`sellers.service.ts:12`, `orders.service.ts` seller methods check
`order.shop.seller.userId === sellerUserId`).

---

## 2. Onboarding & identity

**Account creation is admin/ops-driven, not self-serve.** There is no seller signup flow in
the API; a `User(role='seller')` + `SellerProfile` + `Shop` are provisioned out of band
(seed/admin). The seller then logs in.

**Login** (`auth.service.ts`):
1. Phone OTP (`POST /auth/send-otp`, `/auth/verify-otp`). The user already exists with
   `role='seller'`, so `isNewUser=false`.
2. Because sellers carry a PIN, `verifyOtp` returns `requiresPin=true` when no `pinHash` is
   set yet (`auth.service.ts:114`) → app routes to `SetPinScreen`.
3. **Set PIN** (`setPin`, `:198`): bcrypt cost 12, stored on `SellerProfile.pinHash`.
4. Thereafter the PIN gates the app; 5 wrong PINs → 15-min lockout
   (`SellerProfile.pinFailCount` / `pinLockedUntil`, `:251-274`).

**State on `SellerProfile`** (`schema.prisma:149`): `ownerName`, `upiId`, `bankAccount`,
`bankIfsc`, `gstin`, RazorpayX `razorpayContactId`/`razorpayFundAccountId` (cached after first
payout), `pinHash`, `missedAcceptances`.

> **Launch gotcha (operational):** seed data stores `+91`-prefixed phones while auth
> normalizes to 10 digits — a seeded seller can fail OTP login. Dev OTP `123456` works in
> `NODE_ENV=development`.

---

## 3. Shop & catalog

**Shop** (`schema.prisma:220`) — gating flags decide visibility/fulfillment:
- `isActive` — shop can receive orders. Checkout rejects orders for inactive shops
  (`orders.service.ts:205`). **Defaults false** — a shop must be activated.
- `isOpen` — currently taking orders (open/closed toggle).
- `isFeatured` — "Chirawa Special": raises the cart's delivery fee band to ₹15 and makes
  this shop the fee-carrier in multi-shop carts (`orders.service.ts:221-228`).
- `prepTimeMinutes` (default 8) — feeds the server ETA (`eta.service.ts`).
- `commissionRate` (default **0**) — overrides category rate; unused at launch (commission 0).

**Catalog model:** `Category` → `Product` → `ProductVariant` / `ProductImage`
(`schema.prisma:259-364`). Products may link to a global `MasterCatalog` row via `masterId`
(barcode/GTIN), which is what enables cross-shop aggregation at checkout.

**Catalog is loaded by Ops, not the seller** (no seller-facing product CRUD in the API today):
- `POST /admin/products/import` — bulk create/update, **idempotent on (shopId, name)**,
  up to 500 rows, with price/mrp/unit/category/attributes/images/variants
  (`admin.routes.ts:390`).
- `POST /admin/upload-image`, `PUT /admin/products/:id/images`, `PATCH /admin/shops/:id/images`
  — image management (R2 + image pipeline) (`admin.routes.ts:259-381`).

**Catalog cache:** product/shop reads are Redis-cached (`catalog:shop:{id}:full`,
`catalog:shops:active`); writes bust the relevant keys (`admin.routes.ts:310,341,378,504`).

**State transitions (shop/product):**
```
Shop:    created(isActive=false) ──admin activate──► isActive=true ──toggle──► isOpen on/off
Product: active/available ──seller stock toggle──► out_of_stock/hidden  (StockUpdateLog)
                          ──checkout decrement (stockQty→0)──► out_of_stock
                          ──rider item-unavailable──► out_of_stock
```

---

## 4. Live order queue (the seller's core loop)

Screen: `OrderQueueScreen`. The seller is the **owner** of the `paid/confirmed → preparing →
ready_for_pickup` segment of the order state machine (see ORDER_LIFECYCLE.md §0).

**New order arrives:**
- Event `NEW_ORDER_FOR_SELLER` (`event-bus.ts:134`) → socket `order:new` to room
  `seller:{userId}` (full-screen **alarm** modal, `realtime.plugin.ts:226-239`) **and** FCM
  on the high-priority `chirawa_alerts` channel (alarm sound, `notifications.plugin.ts:195`).
- Emitted at COD checkout immediately, and for prepaid on `markOrderPaid` (`payments.service.ts:428`).

**Seller actions** (`orders.routes.ts:82-116`, all `requireRole('seller')`, ownership-checked):
| Action | Endpoint | Transition |
|--------|----------|------------|
| Accept | `POST /orders/:id/accept` | `paid → confirmed` (stamps `sellerAcceptedAt`) |
| Reject | `POST /orders/:id/reject` | `→ cancelled` (refund-first; frees rider) |
| Start preparing | `POST /orders/:id/preparing` | `confirmed → preparing` |
| Mark ready | `POST /orders/:id/ready` | `preparing → ready_for_pickup` |

**Auto-accept (the critical safety net):** every `NEW_ORDER_FOR_SELLER` schedules a **3-min**
BullMQ `auto-accept` job (`seller-timeout.plugin.ts:19-26`, `SELLER_ACCEPT_MS`). If the seller
never taps Accept, `autoAcceptOrder` (`orders.service.ts:543`) forces `paid → confirmed` and
increments `SellerProfile.missedAcceptances` — so an order **never stalls** on an absent
seller, and chronically unresponsive sellers are flagged. Runs in the **API** process so the
resulting `confirmed` emit reaches dispatch + notifications. A stable `jobId` dedupes the
API-tier timer against the worker's reconciliation path.

**Cancellation reaching the seller:** a customer cancel emits `ORDER_CANCELLED_FOR_SELLER` →
socket `order:cancelled` to `seller:{userId}` so the queue updates and the alarm closes
(`realtime.plugin.ts:241-250`); also FCM (`notifications.plugin.ts:147-154`).

**Once ready:** the seller's job is done; the **rider** (already dispatched at `confirmed`,
possibly already waiting) picks up. Pickup is **not** a seller action.

---

## 5. Stock management

Screen: `StockScreen`. The seller toggles product availability; numeric stock is opt-in.

- `Product.stockStatus` ∈ {available, out_of_stock, hidden} — the visibility lever.
- `Product.stockQty` (nullable) — opt-in numeric tracking. When set, checkout atomically
  decrements it and flips to `out_of_stock` at 0 (`decrementStockOrThrow`,
  `orders.service.ts:50`). When null, only `stockStatus` matters (no oversell math).
- Every status change is logged to `StockUpdateLog` (`schema.prisma:1023`) with from/to + actor.
- Out-of-stock is also forced by the system: checkout zero-out and the rider's
  item-unavailable report both flip `Product → out_of_stock` and bust the catalog cache
  (`orders.service.ts:768`).

**Sales summary** (`sellers.service.ts:26`, `GET /sellers/...`): today / this week (Mon-anchored)
/ this month order counts + goods value, plus the best-selling product this week. "Sold"
excludes `pending_payment` and `cancelled` (`SOLD_STATUSES`, `:5`). Value is
`cartSubtotalAtPricing` (goods only — delivery fee is the platform's).

---

## 6. Settlement (getting paid)

**Model.** Sellers are paid **per day** for the previous day's **delivered** orders. There is
**no per-order payout** and **no commission at launch** (`platformFeePaise` hardcoded 0,
`settlement.job.ts:110`).

**Daily settlement job** (`runDailySettlement`, `settlement.job.ts:49`) — 11:00 AM IST:
1. For each active shop, find `delivered` orders with `deliveredAt` in yesterday's window.
2. **Goods value = Σ(unitPrice×quantity − refundedPaise)** over order items
   (`settlementGoodsPaise`, `:41`) — uses **snapshot** values, never `Product.price`, and
   **subtracts per-line refunds** so a refunded item-unavailable line isn't paid out (P0-1).
3. Create a `Settlement` row (`status=pending`, unique on `(sellerId, periodDate)` →
   idempotent, `:88-96`).
4. `initiatePayout` → RazorpayX UPI payout to the seller's `upiId`.

**Payout state machine** (`initiatePayout`, `:129`):
```
no upiId          → Settlement.status=pending, needsAttention=true   (admin must add UPI)
RazorpayX off     → pending, failureReason set (never fakes a paid payout)  ── non-prod guard
payout processed  → status=paid + paidAt + ledger Transaction(seller_settlement)  (atomic)
payout in-flight  → status=processing, payoutId recorded, NO ledger yet
payout rejected…  → status=failed, needsAttention=true               (admin intervention)
API/network error → status=failed, needsAttention=true               (retry-safe via idempotencyKey)
```

**Payout reconcile** (`runPayoutReconciliation`, `:253`) — every 30 min: fetches each
`processing` payout's status and finalizes it (processed → paid + ledger **once**; terminal
failure → failed + needsAttention). The ledger `Transaction` is written **only when money
actually moved** — the settlement is never marked paid optimistically.

**Idempotency of money:** `createPayout` uses `settlementId` as the idempotency key, and
`initiatePayout` refuses to re-pay a settlement already paid/processing/with a payoutId
(`:137-145`). RazorpayX contact + fund-account ids are cached on `SellerProfile` after first
payout (`:177-182`).

**Seller-facing settlement view** (`getSettlements`, `sellers.service.ts:72`,
`SettlementScreen`): last 8 settlement periods + a live **current** running total = goods
value of `delivered` orders newer than the last settled period (i.e. owed-but-not-yet-paid).

**DB records:** `Settlement` (one per seller per day), `Transaction(type=seller_settlement)`
(written only on real payout), `SellerProfile.razorpay*Id` (cached).

---

## 7. Realtime events the seller depends on

| Event | Socket / channel | Seller effect |
|-------|------------------|---------------|
| `NEW_ORDER_FOR_SELLER` | `order:new` → `seller:{userId}` + FCM `chirawa_alerts` | Alarm modal; new queue card |
| `ORDER_CANCELLED_FOR_SELLER` | `order:cancelled` → `seller:{userId}` + FCM | Card removed; alarm closes |
| `ORDER_STATUS_CHANGED(delivered)` | FCM | "Order delivered — settlement kal milega" |

---

## 8. Failure modes & launch-critical requirements

| Failure | Guard | Result |
|---------|-------|--------|
| Seller never accepts | 3-min auto-accept + `missedAcceptances` | Order progresses; bad sellers flagged |
| Seller PIN brute-force | 5-fail → 15-min lockout (bcrypt) | Account protected |
| No UPI on file at settlement | `needsAttention=true`, stays pending | Admin adds UPI, re-runs; seller not paid blindly |
| RazorpayX unconfigured in prod | hard guard, never marks paid | No fake payouts |
| Payout fails mid-flight | failed + needsAttention; idempotency key | Safe retry, no double pay |
| Refunded item still paid out | `settlementGoodsPaise` subtracts refunds | Seller paid only for fulfilled goods |
| Double settlement same day | unique `(sellerId, periodDate)` | Idempotent |
| Stale stock causes oversell | numeric `stockQty` opt-in + rider unavailable net | Order corrected/refunded |

**Launch-critical:**
1. Auto-accept watcher running in the **API** process (orders must not stall).
2. Settlement idempotency + "ledger only when money moved" (no double/fake payouts).
3. `needsAttention` surfaced to ops (sellers with no UPI never silently go unpaid).
4. Stock toggle + oversell protection (don't sell what isn't there).
5. Seller alarm path (socket + FCM `chirawa_alerts`) actually firing on the device.
