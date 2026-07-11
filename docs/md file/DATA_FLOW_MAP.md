# DATA_FLOW_MAP.md

> Major end-to-end flows. For each: **Trigger · Services · Tables · Redis · Events · External APIs**.
> Derived from actual code; citations are exact files. No recommendations.

**Event names** (`shared/events/event-bus.ts`): `ORDER_STATUS_CHANGED`, `NEW_ORDER_FOR_SELLER`,
`ORDER_CANCELLED_FOR_SELLER`, `ORDER_ASSIGNED_TO_RIDER`, `ORDER_ITEM_UNAVAILABLE`,
`ORDER_ETA_CHANGED`. Every emit is delivered locally **and** published to Redis channel
`chirawa:events:v1` for cross-process listeners.

---

## 1. Customer Signup
- **Trigger:** `POST /auth/send-otp` then `POST /auth/verify-otp` (new phone). Screens: `auth/OtpLoginScreen` → `VerifyOtpScreen` → `SetupProfileScreen`.
- **Services:** `auth.service.sendOtp/verifyOtp`, `otp.service`, `token.service`
- **Tables:** `OtpAttempt` (audit), `User` (created, role=`customer`), `CustomerProfile` (empty, created), `ReferralCode` (auto-generated 6-char), `ReferralRedemption` (only if a referral code was passed — `processReferral`), `RefreshToken`
- **Redis:** `otp:data:{phone}` (5-min), rate counters `otp:rate:phone1h|phone24h|ip1h`, lockout `otp:lockout:{phone}`
- **Events:** none
- **External:** Fast2SMS (OTP send); dev: console log + bypass `123456`

## 2. Login (returning user) & token refresh
- **Trigger:** `POST /auth/verify-otp` (existing phone); silent `POST /auth/refresh` on any 401.
- **Services:** `auth.service.verifyOtp/refresh`, `token.service.signAccessToken/rotateRefreshToken`
- **Tables:** `User`, role profile (`customer/seller/rider/admin`), `RefreshToken` (rotate; reuse → revoke all sessions)
- **Redis:** OTP keys (as above)
- **Events:** none · **External:** Fast2SMS
- **Notes:** seller/rider/admin get `requiresPin` if no `pinHash`; PIN verify via `auth.service.verifyPin`. Access JWT = `{sub, role, profileId}`, RS256, 15 min.

## 3. Address Creation
- **Trigger:** `POST /users/me/addresses` (after map-pin + reverse geocode). Screens: `AddressMapScreen` → `AddressDetailsScreen`.
- **Services:** `users.service.createAddress`; `geo.service.reverseGeocode/autocompletePlaces/placeDetails` (via `/geo/*`)
- **Tables:** `Address` (first address forced default; one default at a time)
- **Redis:** Mappls OAuth token cache (module-level, ~24h) in `geo.service`
- **Events:** none
- **External:** **Mappls** (reverse geocode + autocomplete); `placeDetails` returns null on free tier → map opens at Chirawa centre

## 4. Cart
- **Trigger:** `POST /cart/items`, `PUT /cart/items/:productId`, `GET /cart`, `DELETE /cart`. Screen: `CartContext`.
- **Services:** `cart.service.addItem/updateItem/getCart/clearCart`
- **Tables:** `Product`, `ProductVariant`, `ProductImage`, `Shop`, `MasterCatalog` (read for `aggregated` flag); `Cart` upserted as recovery copy
- **Redis:** **primary store** `cart:{userId}` (24h TTL); subtotal + `requiresPricingRefresh` (fee-band crossing) computed in-memory
- **Events:** none · **External:** none
- **Notes:** multi-shop carts allowed; each line stamped with `shopId`, `masterId`, `aggregated` (true iff master approved).

## 5. Checkout (pricing preview)
- **Trigger:** `POST /pricing/preview` on address select/change. Screen: `CheckoutScreen`.
- **Services:** `pricing.service.calculateDeliveryFee/getActiveFeeRuleVersion`, `promotions.service.validatePromo/resolveAutoPromo`
- **Tables:** `Address`, `Shop` (featured check), `FeeRule` (active version), `PromoCode`, `PromoRedemption`, `Order` (count for first-time check)
- **Redis:** reads `cart:{userId}`
- **Events:** none · **External:** none
- **Notes:** flat fee (₹25 if <₹100, else ₹15 special / ₹10 standard); promo preview single-shop only; FIRSTORDER auto free-delivery for first-time customers.

## 6. Order Creation (`POST /orders`)
- **Trigger:** "Place Order". Service: `orders.service.placeOrder`.
- **Services:** `orders.service`, `resolver.service.resolveCart` (aggregated lines → concrete shop, fewest-shops greedy set-cover + re-validate stock/price), `pricing.service`, `promotions.service`, `eta.service.computeAndPersistEta`, `orders.service.decrementStockOrThrow`
- **Tables (in one `$transaction`):** `OrderGroup` (if multi-shop), `Order` (1 per shop), `OrderItem`, `OrderStatusHistory`, `Product` (atomic `stockQty` decrement / `out_of_stock` flip), `PromoRedemption` + `PromoCode.currentUses`
- **Redis:** reads + **deletes** `cart:{userId}`; `Cart` row deleted
- **Events:** `NEW_ORDER_FOR_SELLER` (per shop, COD only — online waits for payment), `ORDER_STATUS_CHANGED` (init status), `ORDER_ETA_CHANGED` (initial ETA)
- **External:** none directly (ETA uses stored coords, **zero** map calls)
- **Notes:** COD → status `confirmed` immediately; online → `pending_payment`. Operating-hours gate 9 AM–8 PM (`SHOP_CLOSED`). Aggregated lines nobody has in stock → `droppedLines`.

## 7. Payment (online / Razorpay)
- **Trigger:** `POST /payments/orders/:orderId` (create), Razorpay sheet, then `POST /payments/verify/:orderId`; async `POST /payments/webhook/razorpay`.
- **Services:** `payments.service.createPaymentOrder/createCartPaymentOrder/verifyClientPayment/processWebhook`, `razorpay.service` (`createRazorpayOrder`, `verifyPaymentSignature`, `verifyWebhookSignature`), `payments.service.markOrderPaid`
- **Tables:** `Payment` (one row per child order, shared `razorpayOrderId`), `PaymentWebhookEvent` (idempotency), `Order` (→ `paid`), `OrderStatusHistory`, `Transaction` (`customer_payment`)
- **Redis:** (none direct; FCM token lookup downstream)
- **Events:** `ORDER_STATUS_CHANGED (paid)` (→ customer FCM), `NEW_ORDER_FOR_SELLER` (→ seller FCM + auto-accept timer)
- **External:** **Razorpay** (mock when unconfigured; signature/webhook checks skipped in dev)
- **Notes:** one Razorpay order for multi-shop grand total; webhook is process-then-record idempotent; reconciliation safety-net job covers dropped webhooks (flow §16).

## 8. Order Assignment (auto-dispatch)
- **Trigger:** `ORDER_STATUS_CHANGED` with status `confirmed` → `dispatch.plugin`.
- **Services:** `batching.service.addConfirmedOrderToBatch` → schedule `assign-batch` job → `worker/jobs/assignment.job.processAssignBatch` → `batching.service.assignBatch` (or single-order `dispatch.service.assignOrder` for admin manual)
- **Tables:** `Batch` (open/assigned/cancelled), `DeliveryZone`, `RiderZone`, `RiderAvailability` (online riders), `RiderProfile`, `DeliveryAssignment` (created), `Order` (`riderId`, `batchId` set), `AppConfig` (`support_phone` for escalation)
- **Redis:** BullMQ `chirawa-order-assignment` queue (delay = batch window or 0 if full); rider availability fast-path `rider:{id}:availability`
- **Events:** `ORDER_ASSIGNED_TO_RIDER` (→ rider socket + FCM), `ORDER_ETA_CHANGED` (recompute)
- **External:** Fast2SMS (escalation after 10 failed attempts @60s)
- **Notes:** zone chosen by point-in-polygon (centroid fallback); rider = fewest active deliveries; ≤3 orders / 800m / same zone / 3-min window per batch.

## 9. Rider Flow (availability → pickup → out-for-delivery)
- **Trigger:** `PATCH /delivery/availability`; socket `rider:availability`/`rider:location`; `POST /delivery/orders/:id/pickup`; `POST /delivery/orders/:id/start-delivery`; `GET /delivery/active`.
- **Services:** `dispatch.service.setAvailability/getActiveDelivery/markPickedUp/startDelivery/riderAdvance`, `eta.service.computeAndPersistEta`
- **Tables:** `RiderAvailability`, `RiderLocation` (socket writes, 7-day retention), `DeliveryAssignment`, `Order` (`pickedUpAt`/`outForDeliveryAt`), `OrderStatusHistory`, `Batch`, `Shop`, `Customer`/`OrderItem` (for stops)
- **Redis:** `rider:{userId}:location` (30s TTL, written on each `rider:location` socket event), `rider:{id}:availability`
- **Events:** `ORDER_STATUS_CHANGED (picked_up / out_for_delivery)`, `ORDER_ETA_CHANGED`; socket `order:location` broadcast to order room
- **External:** none (location is device GPS)
- **Notes:** can't start delivery until every batch order is picked up.

## 10. Delivery Completion
- **Trigger:** COD → `POST /orders/:id/cod-collected` (`{amountPaise}`); prepaid → `POST /orders/:id/delivered`.
- **Services:** `orders.service.codCollected/markDelivered`
- **Tables:** `Order` (→ `delivered`, `deliveredAt`, `codCollectedPaise`), `OrderStatusHistory`, `RiderProfile.codBalancePaise` (COD only)
- **Redis:** FCM token lookup downstream
- **Events:** `ORDER_STATUS_CHANGED (delivered)` → customer FCM **+ SMS**, seller FCM
- **External:** Fast2SMS (delivered SMS), FCM
- **Notes:** COD path rejects non-COD and vice-versa; uses `RiderProfile.id` (BUG-1 fix). Referral unlock is **not** enqueued here (`enqueueReferralUnlock` only logs — see DATA below / FEATURE E8).

## 11. Refunds
- **Trigger paths:** customer cancel (`DELETE /orders/:id`), seller reject (`POST /orders/:id/reject`), admin refund (`POST /payments/refund/:orderId`), rider item-unavailable (`POST /delivery/orders/:id/items/:itemId/unavailable`).
- **Services:** `payments.service.refundCapturedOrderPayment` (full), `refundOrderLine` (partial line), `initiateRefund` (admin full)
- **Tables:** `Payment` (`status: refunded` or `refundedPaise` increment), `Transaction` (`refund`), `Order` (status/`cancelReason` via `updateOrderStatus`), `OrderStatusHistory`, `OrderItem` (`fulfillmentStatus: unavailable_refunded`, `refundedPaise`)
- **Redis:** none direct
- **Events:** `ORDER_STATUS_CHANGED (cancelled, refundedPaise)` (→ refund-specific FCM + SMS), `ORDER_CANCELLED_FOR_SELLER`, `ORDER_ITEM_UNAVAILABLE`
- **External:** **Razorpay** `createRefund` (only when configured; COD/unpaid refund nothing — COD line reduces cash due instead)
- **Notes:** rider/customer cancel also frees rider+batch via `releaseOrderAssignment`.

## 12. Notifications
- **Trigger:** any emitted event (above). Listeners: `notifications.plugin` (FCM/SMS) + `realtime.plugin` (Socket.IO).
- **Services:** `fcm.service.sendPush`, `sms.service.sendSms`, notification templates (`notification.templates.ts`, `SmsTemplates`)
- **Tables:** `Notification` (logged per send; also queryable via `GET /notifications`)
- **Redis:** `fcm:token:{userId}` (90-day TTL; registered via `POST /notifications/register-token`)
- **Events consumed:** `ORDER_STATUS_CHANGED` (confirmed/out_for_delivery/picked_up/delivered/cancelled/paid), `NEW_ORDER_FOR_SELLER`, `ORDER_ASSIGNED_TO_RIDER`
- **External:** **FCM** (push; console-only in dev), **Fast2SMS** (delivered/cancelled/refund only)
- **Notes:** worker-originated paid orders also push the seller directly (`reconciliation.job.progressReconciledOrder`) since the worker has no in-process socket/FCM listeners.

## 13. Tracking (live)
- **Trigger:** open `OrderTrackingScreen`; socket connect + `order:subscribe`; `GET /orders/:id`, `GET /orders/group/:groupId`, `GET /delivery/orders/:orderId/rider-location` (fallback paint).
- **Services:** `orders.service.getOrder/getOrderGroup`, `dispatch.service.getRiderLocationForOrder`, `realtime.plugin`
- **Tables:** `Order`, `OrderItem`, `OrderStatusHistory`, `Payment`, `RiderProfile` (name/phone only during `picked_up`/`out_for_delivery`, only to customer/rider/admin — `orders.service.ts:390-408`)
- **Redis:** `rider:{userId}:location` (read for initial paint + stale fallback)
- **Events/socket:** receives `order:status`, `order:location`, `order:eta`, `order:item-unavailable`
- **External:** Google Maps (client render only)
- **Notes:** refund block + ETA hero derived in `getOrder`; map gated on rider-location freshness.

## 14. ETA
- **Trigger:** recomputed at order placement and every status transition (`computeAndPersistEta` called from `placeOrder`, `updateOrderStatus`, `dispatch.service.assignOrder/riderAdvance`).
- **Services:** `eta.service.computeEta/computeAndPersistEta/etaResponse`
- **Tables:** `Order` (`estimatedDeliveryAt`, `etaSpreadSeconds`, `etaComputedAt`, `etaSource`); reads `Shop.prepTimeMinutes` + coords
- **Redis:** none
- **Events:** `ORDER_ETA_CHANGED` → socket `order:eta` (sent as `secondsRemaining` + `serverNow` for clock-skew safety)
- **External:** **none** — travel leg = Haversine(shop, drop) × road-factor 1.3 at 14 km/h + dwell + handover; fallback wide range only when coords missing.

## 15. Ratings
- **Trigger:** `POST /orders/:id/rating` (`{rating, comment?}`) after delivery. Screen: `OrderTrackingScreen`/`OrderHistoryScreen`.
- **Services:** `orders.service.rateOrder`
- **Tables:** `Order` (`rating`, `ratingComment`, `ratedAt`)
- **Redis:** none · **Events:** none · **External:** none
- **Notes:** only when `status = delivered` and not already rated.

---

## 16. (Supporting) Background sweeps
| Flow | Trigger | Services | Tables | External |
|---|---|---|---|---|
| **Payment reconcile** | every 15 min | `reconciliation.job` → `payments.service.markOrderPaid` | `Order`, `Payment`, `Transaction` | Razorpay (poll) |
| **Seller settlement** | daily 05:30 UTC | `settlement.job.runDailySettlement` + `initiatePayout` | `Settlement`, `Transaction`, `SellerProfile` | RazorpayX (payout) |
| **Payout reconcile** | every 30 min | `settlement.job.runPayoutReconciliation` | `Settlement`, `Transaction` | RazorpayX (poll) |
| **Catalog enrich** | nightly 19:30 UTC | `enrichment.job.runCatalogEnrichment` | `MasterCatalog`, `ProductImage` | OFF dump → R2 |
| **Cleanup** | hourly/6h/daily | `cleanup.job` | `RiderLocation`, `OtpAttempt`, `RefreshToken`, `Cart` | — |
| **Restock notify** | stock flip to available | `requests.service.notifyRestock` | `ProductRequest`, `Product` | FCM |
| **Referral unlock** | (none — producer disconnected) | `referral.job` | `ReferralRedemption`, `CustomerProfile`, `WalletTransaction`, `Transaction` | — |

## 17. Cross-cutting Redis key map
| Key | Owner | TTL | Purpose |
|---|---|---|---|
| `cart:{userId}` | `cart.service` | 24h | Cart primary store |
| `otp:data:{phone}` | `otp.service` | 5 min | OTP code + attempts |
| `otp:rate:*`, `otp:lockout:{phone}` | `otp.service` | 1h/24h/15min | Rate limit + lockout |
| `fcm:token:{userId}` | `notifications` | 90d | Device push token |
| `rider:{userId}:location` | `realtime.plugin` | 30s | Live rider GPS |
| `rider:{id}:availability` | `dispatch.service` | — | Online fast-path |
| `catalog:agg:all` (+ `:lock`) | `aggregation.service` | 120s+jitter | Aggregated feed cache |
| `catalog:shop:{id}:full`, `catalog:shops:active` | `catalog.service` | — | Shop catalog cache |
| `search:aliases:expanded:*` | `catalog`/`admin` | 1h | Alias expansion cache |
| `chirawa:events:v1` | `event-bus` | (pub/sub) | Cross-process event bridge |
| Socket.IO adapter keys | `realtime.plugin` | (pub/sub) | Cross-instance broadcast |
| BullMQ keys | `worker`/`queue.plugin` | — | Job queues |
