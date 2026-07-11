# FEATURE_INVENTORY.md

> Per-feature inventory grouped by surface. Status legend:
> **✅ Implemented** · **🟡 Partial** · **⚪ Stub/Disconnected** · **🧪 Experimental** · **💀 Dead/Hidden**
> Citations are exact files. No recommendations or fixes — description only.

---

## A. Customer App (`apps/customer-app`)

### A1. Phone OTP login & signup — ✅ Implemented
- **Screens:** `auth/OtpLoginScreen.tsx`, `auth/VerifyOtpScreen.tsx`, `auth/SetupProfileScreen.tsx`, `context/AuthContext.tsx`
- **Endpoints:** `POST /auth/send-otp`, `POST /auth/verify-otp`, `POST /auth/refresh`, `POST /auth/logout`
- **Tables:** `User`, `CustomerProfile`, `OtpAttempt`, `RefreshToken`, `ReferralCode`
- **External:** Fast2SMS (OTP); dev bypass `123456`
- **Events/Jobs:** none
- **Notes:** new phone → role `customer` + empty `CustomerProfile` + referral code auto-created (`auth.service.ts:65-94`).

### A2. Profile & language — ✅ Implemented
- **Screens:** `profile/ProfileScreen.tsx`, `LanguagePickerScreen.tsx`, `profile/AccountPrivacyScreen.tsx`
- **Endpoints:** `GET /users/me`, `PUT /users/me`
- **Tables:** `User`, `CustomerProfile`
- **External:** none · **Events/Jobs:** none

### A3. Address book + map pin + reverse geocode — ✅ Implemented
- **Screens:** `profile/AddressListScreen.tsx`, `AddressDetailsScreen.tsx`, `AddressMapScreen.tsx`, `ReceiveAddressScreen.tsx`, `ShareAddressScreen.tsx`, `components/location/*`, `context/AddressContext.tsx`
- **Endpoints:** `GET/POST /users/me/addresses`, `PUT/DELETE /users/me/addresses/:id`, `PATCH /users/me/addresses/:id/default`, `POST /geo/reverse`, `POST /geo/autocomplete`, `POST /geo/place`
- **Tables:** `Address` · **External:** Mappls (geo proxy)
- **Notes:** soft delete (`isDeleted`); one default at a time; receiver-contact fields + `mapsLink`. `placeDetails` returns null on free Mappls tier → map opens at Chirawa centre (`geo.service.ts:157-162`).

### A4. Home feed — Daily Essentials, Bestsellers, Categories, Specials, Shops-nearby — ✅ Implemented
- **Screens:** `home/HomeScreen.tsx` + sections (`DailyEssentialsShelf`, `BestsellersSection`, `CategoryGrid`, `CategorySections`, `ChirawaSpecialSection`, `ShopsNearbySection`, `PopularProductsSection`, `ForYouFeedShelf`, animated night theme: `Starfield`, `Moon`, `Planet`)
- **Endpoints:** `GET /catalog/daily-essentials`, `GET /catalog/bestsellers`, `GET /catalog/categories`, `GET /catalog/category-images`, `GET /catalog/specials`, `GET /catalog/shops`, `GET /catalog/feed`
- **Tables:** `Product`, `MasterCatalog`, `Shop`, `Category`, `ProductImage`
- **Redis:** aggregated feed cache `catalog:agg:all` (`aggregation.service.ts:16`)
- **Notes:** "Daily Essentials" is a curated VIEW over the aggregated feed (`aggregation.service.ts:101-152`, honest real-SKU list, not a sales rank).

### A5. Aggregated "one store" catalog (Catalog Engine Phase 4) — ✅ Implemented
- **Endpoints:** `GET /catalog/feed`
- **Tables:** `Product`, `MasterCatalog` (`status = approved` gate)
- **Code:** `catalog/aggregation.service.ts` — one tile per master at lowest in-stock price, shop identity hidden; unapproved-master products pass through as own tiles.
- **Redis:** single-flight lock `catalog:agg:lock` + TTL jitter.
- **Notes:** `shopBrowsing: false` flag hides per-shop pages (`config/features.ts`).

### A6. Search + autocomplete (pg_trgm + Hinglish aliases) — ✅ Implemented
- **Screens:** `search/SearchScreen.tsx`, `home/SearchBar.tsx`
- **Endpoints:** `GET /search`, `GET /search/suggest`, `GET /catalog/search`
- **Tables:** `Product`, `Shop`, `SearchAlias` · **Code:** `catalog/catalog.service.ts` (raw `$queryRaw` `word_similarity`/`similarity`/`ILIKE`), `catalog/hinglish-aliases.ts`
- **Redis:** suggest + alias-expansion caches

### A7. Product detail + variants — ✅ Implemented
- **Screens:** `product/ProductDetailScreen.tsx`, `components/product/ProductCard.tsx`
- **Endpoints:** `GET /catalog/products/:id`, `GET /catalog/products`
- **Tables:** `Product`, `ProductVariant`, `ProductImage`, `Category`, `MasterCatalog`

### A8. Cart (multi-shop, Redis-backed) — ✅ Implemented
- **Screens:** `context/CartContext.tsx`, `components/CartDockPill.tsx`, `CartThumbs.tsx`, `cart/FlyToCart.tsx`
- **Endpoints:** `GET /cart`, `POST /cart/items`, `PUT /cart/items/:productId`, `DELETE /cart`
- **Tables:** `Cart`, `CartItem` (Redis primary `cart:{userId}`) · **Code:** `cart/cart.service.ts`
- **Notes:** multi-shop carts allowed; lines carry `masterId`/`aggregated` for the checkout resolver; fee-band crossing flagged via `requiresPricingRefresh`.

### A9. Checkout, pricing preview & promo — ✅ Implemented
- **Screens:** `orders/CheckoutScreen.tsx`
- **Endpoints:** `POST /pricing/preview`, `POST /orders`
- **Tables:** `Order`, `OrderItem`, `OrderGroup`, `Address`, `FeeRule`, `PromoCode`, `PromoRedemption`, `Product`
- **Code:** `pricing/pricing.service.ts` (flat fee: ₹25 <₹100, else ₹15 if Special shop, else ₹10), `promotions/promotions.service.ts` (FIRSTORDER auto free-delivery for first-time customers), `orders/orders.service.ts:placeOrder`, `orders/resolver.service.ts` (aggregated-line → shop resolution)
- **Events:** `NEW_ORDER_FOR_SELLER`, `ORDER_STATUS_CHANGED`, `ORDER_ETA_CHANGED`
- **Notes:** multi-shop cart splits into 1 child order per shop under one `OrderGroup`; one combined delivery fee carried by one order.

### A10. Payment (Razorpay) — ✅ Implemented
- **Screens:** `components/payment/RazorpayCheckout.tsx`, `orders/OrderPlacedScreen.tsx`
- **Endpoints:** `POST /payments/orders/:orderId`, `POST /payments/verify/:orderId`, `POST /payments/webhook/razorpay`
- **Tables:** `Payment`, `PaymentWebhookEvent`, `Order`, `Transaction`
- **External:** Razorpay (mock in dev) · **Events:** `ORDER_STATUS_CHANGED (paid)`, `NEW_ORDER_FOR_SELLER`
- **Notes:** one Razorpay order for the multi-shop grand total; webhook idempotent (process-then-record, `payments.service.ts:103-146`).

### A11. Order tracking (live, Tracking V2) — ✅ Implemented
- **Screens:** `orders/OrderTrackingScreen.tsx`, `components/tracking/TrackingMap.tsx`
- **Endpoints:** `GET /orders/:id`, `GET /orders/group/:groupId`, `GET /delivery/orders/:orderId/rider-location`
- **Realtime:** socket `order:subscribe`; receives `order:status`, `order:location`, `order:eta`, `order:item-unavailable`
- **Tables:** `Order`, `OrderItem`, `OrderStatusHistory`, `Payment`, `RiderProfile` (name/phone exposed only during active delivery — `orders.service.ts:390-408`)
- **External:** Google Maps (client render) · **Notes:** refund block + ETA hero + item-unavailable banner; map gated on rider location freshness.

### A12. Server-computed ETA (ETA MVP Phase 1) — ✅ Implemented
- **Endpoints:** surfaced in `GET /orders/:id`; pushed via `order:eta`
- **Tables:** `Order` (`estimatedDeliveryAt`, `etaSpreadSeconds`, `etaSource`, `etaComputedAt`)
- **Code:** `orders/eta.service.ts` — prep + Haversine road-factor travel + dwell + handover, recomputed per status transition; **zero map-provider calls**
- **Events:** `ORDER_ETA_CHANGED`

### A13. Order history, cancel, rate, edit address/receiver — ✅ Implemented
- **Screens:** `orders/OrderHistoryScreen.tsx`, `orders/OrderTrackingScreen.tsx`
- **Endpoints:** `GET /orders`, `DELETE /orders/:id` (cancel), `POST /orders/:id/rating`, `PATCH /orders/:id/delivery-address`, `PATCH /orders/:id/receiver`
- **Tables:** `Order`, `OrderStatusHistory`, `Payment`, `Transaction`
- **Notes:** cancel only while `pending_payment|paid|confirmed`; prepaid cancel auto-refunds via Razorpay; address/receiver editable only pre-pickup (`EDITABLE_STATUSES`).

### A14. Item-unavailable live update + substitute suggestion — ✅ Implemented
- **Realtime:** `order:item-unavailable` (suggestion to tap)
- **Code:** emitted by `orders.service.ts:riderReportItemUnavailable`; `event-bus.ts` `OrderItemUnavailablePayload`

### A15. "Request this item" + restock notify (Phase 6) — ✅ Implemented (notify path live)
- **Endpoints:** `POST /catalog/requests`
- **Tables:** `ProductRequest` (`notifyOnRestock`, `notifiedAt`)
- **Events/Jobs:** FCM restock fan-out on stock flip (`catalog.routes.ts:180`, `requests.service.notifyRestock`)

### A16. Push notifications — ✅ Implemented
- **Screens:** `components/NotificationsBootstrap.tsx`, `services/notifications.ts`
- **Endpoints:** `POST /notifications/register-token`, `DELETE /notifications/register-token`, `GET /notifications`, `PATCH /notifications/:id/read`
- **Tables:** `Notification` (+ Redis `fcm:token:{userId}`) · **External:** FCM

### A17. Referral / Loyalty / Wallet — 💀 Hidden (Dead in v1)
- **Screens:** gated off by `config/features.ts` → `growthLoops: false`
- **Endpoints:** `GET /users/me/loyalty` (works), `GET /loyalty` (**⚪ stub**, `loyalty.routes.ts`)
- **Tables:** `WalletTransaction`, `LoyaltyTier`, `ReferralCode`, `ReferralRedemption`
- **Notes:** Loyalty tier computation exists (`users.service.getLoyalty`) but the UI is hidden. Wallet/referral credits are never granted in the live flow — see Backend Platform §E8. Memory: "referral/loyalty/wallet HIDDEN for launch."

---

## B. Seller App (`apps/seller-app`)

### B1. OTP + PIN login — ✅ Implemented
- **Screens:** `auth/{OtpLogin,VerifyOtp,SetPin}Screen.tsx`, `context/AuthContext.tsx`
- **Endpoints:** `POST /auth/send-otp`, `POST /auth/verify-otp`, `POST /auth/set-pin`
- **Tables:** `User`, `SellerProfile` (`pinHash`, `pinFailCount`, `pinLockedUntil`)
- **Notes:** seeded sellers may have a `+91` phone mismatch vs 10-digit auth (per project memory `seeded-sellers-cant-login`).

### B2. Order queue + accept/reject/prepare/ready — ✅ Implemented
- **Screens:** `orders/OrderQueueScreen.tsx`
- **Endpoints:** `GET /orders`, `POST /orders/:id/accept`, `POST /orders/:id/reject`, `POST /orders/:id/preparing`, `POST /orders/:id/ready`
- **Tables:** `Order`, `OrderStatusHistory`, `SellerProfile` (`missedAcceptances`), `Payment` (refund on reject)
- **Realtime:** `order:new`, `order:status`, `order:cancelled` · **Events:** `ORDER_STATUS_CHANGED`
- **Notes:** seller reject of prepaid order auto-refunds + frees rider/batch.

### B3. Auto-accept on seller timeout — ✅ Implemented (background)
- **Code:** `orders/seller-timeout.plugin.ts` (BullMQ `auto-accept`, 3-min window), `orders.service.autoAcceptOrder`
- **Tables:** `Order`, `SellerProfile.missedAcceptances` · **Queue:** `chirawa-seller-accept`

### B4. Stock management (status toggle + numeric qty + CRUD + variants + CSV import) — ✅ Implemented
- **Screens:** `stock/StockScreen.tsx`
- **Endpoints:** `PATCH /catalog/products/:id/stock`, `PATCH /catalog/products/:id/stock-qty`, `POST/PATCH/DELETE /catalog/products[/:id]`, `POST/PATCH/DELETE /catalog/categories[/:id]`, `POST/PATCH/DELETE /catalog/products/:id/variants` + `/variants/:id`, `POST /catalog/products/import` (CSV), `POST /catalog/upload-image`
- **Tables:** `Product`, `ProductVariant`, `Category`, `ProductImage`, `StockUpdateLog`
- **External:** R2 (image pipeline) · **Redis:** per-shop cache invalidation
- **Code:** `catalog/inventory.service.ts`

### B5. Barcode scan → "I stock this" (Catalog Engine Phase 3) + offline queue — ✅ Implemented
- **Screens:** `stock/BarcodeScannerModal.tsx`, `services/offline-queue.ts`
- **Endpoints:** `GET /catalog/master/:barcode`, `POST /catalog/products/stock-this`
- **Tables:** `Product`, `MasterCatalog` · **External:** OFF live (single lookup) · **Code:** `catalog/master.service.ts`, `inventory.service.upsertProductByBarcode`
- **Notes:** idempotent upsert by `(shopId, barcode)`; offline ops persisted to AsyncStorage and replayed.

### B6. Report wrong image — ✅ Implemented
- **Endpoints:** `POST /catalog/products/:id/report-image`
- **Tables:** `ImageReport`, `MasterCatalog` (re-gated to `needs_review`)

### B7. Sales summary & settlement history — ✅ Implemented
- **Screens:** `settlement/SettlementScreen.tsx`
- **Endpoints:** `GET /sellers/me/sales-summary`, `GET /sellers/me/settlements`
- **Tables:** `Order`, `OrderItem`, `Settlement` · **Code:** `sellers/sellers.service.ts`
- **Notes:** commission is 0 in v1 (`platformFeePaise: 0`).

### B8. Seller push notifications — ✅ Implemented
- **Endpoints:** `POST /notifications/register-token`
- **Tables:** `Notification` · **External:** FCM (`chirawa_alerts` channel for new-order alarm)

---

## C. Rider App (`apps/rider-app`)

### C1. OTP + PIN login — ✅ Implemented
- **Screens:** `auth/{OtpLogin,VerifyOtp,SetPin}Screen.tsx`, `context/AuthContext.tsx`
- **Endpoints:** `POST /auth/send-otp`, `POST /auth/verify-otp`, `POST /auth/set-pin`
- **Tables:** `User`, `RiderProfile`

### C2. Online/offline availability + live location push — ✅ Implemented
- **Screens:** `home/HomeScreen.tsx`
- **Endpoints:** `GET /delivery/availability`, `PATCH /delivery/availability`; socket `rider:availability`, `rider:location`
- **Tables:** `RiderAvailability`, `RiderLocation` (+ Redis `rider:{userId}:location` 30s TTL, `rider:{id}:availability`)
- **Code:** `delivery/dispatch.service.ts`, `shared/plugins/realtime.plugin.ts:108-158`

### C3. Incoming-order assignment alert — ✅ Implemented
- **Screens:** `home/HomeScreen.tsx` (socket `order:assigned`)
- **Events:** `ORDER_ASSIGNED_TO_RIDER` · **External:** FCM
- **Tables:** `DeliveryAssignment`, `Order`

### C4. Active delivery / batch (pickup → out-for-delivery) — ✅ Implemented
- **Screens:** `delivery/DeliveryScreen.tsx`
- **Endpoints:** `GET /delivery/active`, `POST /delivery/orders/:orderId/pickup`, `POST /delivery/orders/:orderId/start-delivery`
- **Tables:** `DeliveryAssignment`, `Order`, `Batch`, `Shop`, `OrderItem`
- **Notes:** can't go out-for-delivery until all batch orders are picked up (`dispatch.service.ts:198-204`).

### C5. Delivery completion (prepaid + COD) — ✅ Implemented
- **Endpoints:** `POST /orders/:id/delivered` (prepaid), `POST /orders/:id/cod-collected` (COD)
- **Tables:** `Order`, `OrderStatusHistory`, `RiderProfile.codBalancePaise`
- **Events:** `ORDER_STATUS_CHANGED (delivered)` → customer FCM + SMS, seller FCM
- **Notes:** COD increments rider cash ledger (`codBalancePaise`); BUG-1 fix uses `RiderProfile.id`.

### C6. Report item unavailable at pickup (Phase 5 safety net) — ✅ Implemented
- **Endpoints:** `POST /delivery/orders/:orderId/items/:itemId/unavailable`
- **Tables:** `OrderItem` (`fulfillmentStatus`, `refundedPaise`), `Order`, `Payment`, `Product`, `Transaction`
- **Events:** `ORDER_ITEM_UNAVAILABLE` · **External:** Razorpay (line refund)

### C7. Earnings — ✅ Implemented (UI) / data partly static
- **Screens:** `earnings/EarningsScreen.tsx`
- **Tables:** `RiderProfile` (`monthlySalaryPaise`, `codBalancePaise`), `RiderSettlement`
- **Notes:** rider salary model is fixed-monthly (`RiderSettlement`); no rider-self settlement endpoint in `delivery.routes.ts` (earnings shown from profile/COD balance).

---

## D. Admin (API-only — no admin frontend app in repo)

> All under `/api/v1/admin` (`modules/admin/admin.routes.ts`), guarded by `requireRole('admin')`.
> `FRONTEND_URLS` references `localhost:3001/3002` admin dashboards, but no admin web app exists in the repo.

### D1. Search-alias management — ✅ Implemented
- **Endpoints:** `POST /admin/search-aliases`, `PATCH /admin/search-aliases/:term/add`, `GET /admin/search-aliases`
- **Tables:** `SearchAlias` · **Redis:** alias cache invalidation

### D2. Dispatch live-ops snapshot — ✅ Implemented
- **Endpoints:** `GET /admin/dispatch` (JSON only)
- **Tables:** `Order`, `RiderProfile`, `RiderAvailability`, `DeliveryAssignment`, `Shop`

### D3. Demand dashboard — ✅ Implemented
- **Endpoints:** `GET /admin/product-requests`
- **Tables:** `ProductRequest` · **Code:** `catalog/requests.service.getDemand`

### D4. Catalog moderation, coverage & metrics (Phase 7) — ✅ Implemented
- **Endpoints:** `GET /admin/moderation/masters`, `PATCH /admin/masters/:id/status`, `GET /admin/moderation/image-reports`, `POST /admin/image-reports/:id/resolve`, `POST /admin/masters/:id/takedown`, `GET /admin/moderation/price-outliers`, `GET /admin/coverage`, `GET /admin/metrics`
- **Tables:** `MasterCatalog`, `ImageReport`, `Product`, `ProductImage`
- **Code:** `catalog/moderation.service.ts`

### D5. Image upload & shop/product image management — ✅ Implemented
- **Endpoints:** `POST /admin/upload-image`, `PATCH /admin/shops/:id/images`, `PUT /admin/products/:id/image`, `PUT /admin/products/:id/images`
- **Tables:** `Shop`, `Product`, `ProductImage` · **External:** R2 + image pipeline

### D6. Bulk product import (JSON) — ✅ Implemented
- **Endpoints:** `POST /admin/products/import` (≤500 rows)
- **Tables:** `Product`, `ProductImage`, `ProductVariant`, `Category`

### D7. Manual rider assignment + refund — ✅ Implemented
- **Endpoints:** `POST /delivery/orders/:orderId/assign` (admin), `POST /payments/refund/:orderId` (admin)
- **Tables:** `DeliveryAssignment`, `Order`, `Payment`, `Transaction`, `OrderStatusHistory`

---

## E. Backend Platform (cross-cutting / background)

### E1. Order state machine — ✅ Implemented
- **Code:** `orders/orders.service.ts:78-98` (`ORDER_TRANSITIONS`, `assertTransition`) — 9 statuses, illegal jumps rejected.

### E2. Auto-dispatch via delivery batching — ✅ Implemented
- **Code:** `delivery/dispatch.plugin.ts` (on `confirmed` → batch), `delivery/batching.service.ts` (≤3 orders / 800m / same zone / 3-min window), `worker/jobs/assignment.job.ts` (assign + retry 10× @60s → SMS escalation)
- **Tables:** `Batch`, `DeliveryAssignment`, `Order`, `DeliveryZone`, `RiderZone`, `RiderAvailability`
- **Queue:** `chirawa-order-assignment` · **Events:** `ORDER_ASSIGNED_TO_RIDER`
- **External:** Fast2SMS (escalation to `support_phone` from `AppConfig`)

### E3. Payment webhook + reconciliation — ✅ Implemented
- **Code:** `payments/payments.service.ts` (webhook), `worker/jobs/reconciliation.job.ts` (every 15 min, polls Razorpay for stuck `pending_payment` >30 min)
- **Tables:** `Payment`, `PaymentWebhookEvent`, `Order`, `Transaction`
- **Queue:** `chirawa-reconciliation` · **External:** Razorpay

### E4. Seller daily settlement + RazorpayX payouts — ✅ Implemented
- **Code:** `worker/jobs/settlement.job.ts` (`runDailySettlement`, `initiatePayout`, `runPayoutReconciliation`)
- **Tables:** `Settlement`, `Transaction`, `SellerProfile` (`razorpayContactId`/`razorpayFundAccountId`), `Order`, `OrderItem`, `Shop`
- **Queue:** `chirawa-settlement` (daily 05:30 UTC; payout-reconcile every 30 min)
- **External:** RazorpayX (payouts) · **🟡 TODO:** seller FCM+SMS settlement notification not done (`settlement.job.ts:17`)

### E5. Notifications fan-out (event-bus → FCM/SMS + Socket.IO) — ✅ Implemented
- **Code:** `notifications/notifications.plugin.ts` (FCM/SMS per `ORDER_STATUS_CHANGED`/`NEW_ORDER_FOR_SELLER`/`ORDER_ASSIGNED_TO_RIDER`), `shared/plugins/realtime.plugin.ts` (socket broadcasts)
- **Tables:** `Notification` · **External:** FCM, Fast2SMS

### E6. Cross-process event bus (Redis pub/sub bridge) — ✅ Implemented
- **Code:** `shared/events/event-bus.ts` (`startEventBusBridge`, channel `chirawa:events:v1`)
- **Notes:** fixes worker-emitted events not reaching API socket/FCM listeners (memory `cross-process-eventbus-gap`, fixed).

### E7. Catalog image enrichment (OFF) — ✅ Implemented (gated on dump)
- **Code:** `worker/jobs/enrichment.job.ts`, `services/off-source.ts`, `services/image-pipeline.ts`, `services/r2.service.ts`
- **Tables:** `MasterCatalog` (`enrichmentStatus`/`enrichmentAttemptedAt`/`enrichmentNote`)
- **Queue:** `chirawa-enrichment` (nightly) · **External:** OFF bulk dump → R2
- **Notes:** with no `OFF_DUMP_PATH`, items are marked `needs_manual`.

### E8. Referral credit unlock — ⚪ Disconnected (effectively dead)
- **Code:** worker `processUnlockReferral` + queue `chirawa-referral` are **fully implemented** (`worker/jobs/referral.job.ts`), but the only producer `enqueueReferralUnlock` (`orders.service.ts:894-905`) **only `console.log`s and never enqueues** the job. No code path adds `UNLOCK_REFERRAL` to the queue.
- **Tables (would touch):** `ReferralRedemption`, `CustomerProfile.walletBalance`, `WalletTransaction`, `Transaction`, `ReferralCode`
- **Net effect:** referral/wallet credits never actually granted in the live flow (also UI-hidden by `growthLoops: false`).

### E9. Maintenance cleanup jobs — ✅ Implemented
- **Code:** `worker/jobs/cleanup.job.ts` — rider locations >7d, OTP >24h, expired/revoked tokens, expired carts (Redis + DB)
- **Queue:** `chirawa-cleanup`

### E10. Audit log — 🟡 Partial (table only)
- **Tables:** `AuditLog`, `AuditAction` enum exist; no write call sites found in `apps/api/src` outside the schema. Defined but not actively populated by the modules reviewed.

### E11. Fee rules / pricing engine — ✅ Implemented (flat-fee path active)
- **Code:** `pricing/pricing.service.ts` (flat fee active), `pricing/distance.service.ts` (distance helpers — present but flat path stamps `distanceKm: 0`, `distanceSource: 'flat'`)
- **Tables:** `FeeRule` (v1 seeded with distance bands that the flat path doesn't use)
- **Notes:** the seeded `FeeRule.ruleDefinition` contains distance bands (legacy); live checkout uses the flat-fee function, not the bands — 🧪 distance-based pricing is dormant.

### E12. Promotions — ✅ Implemented
- **Code:** `promotions/promotions.service.ts` (flat/percent/free_delivery; `FIRSTORDER` auto-applied to first-time customers)
- **Tables:** `PromoCode`, `PromoRedemption`

### E13. COD float cap — 🟡 Partial (config only)
- **Config:** `COD_FLOAT_CAP_PAISE` (₹2000) in env; `RiderProfile.codBalancePaise` tracked, but no enforcement/block on cap found in the rider COD path reviewed.

---

## Status Roll-up

- **💀 Hidden (Dead in v1):** Referral / Loyalty UI / Wallet (`growthLoops: false`).
- **⚪ Stub/Disconnected:** `GET /loyalty` route (stub); referral unlock producer (E8).
- **🟡 Partial / config-only:** seller settlement notification (E4 TODO), audit-log writes (E10), COD float-cap enforcement (E13).
- **🧪 Dormant/experimental:** distance-based fee bands (E11 — code + seed exist, flat path used); `chirawa-notification` queue names declared but push/SMS sent inline.
- Everything else above is **✅ Implemented** in code (device/live-DB verification status is out of scope for this discovery).
