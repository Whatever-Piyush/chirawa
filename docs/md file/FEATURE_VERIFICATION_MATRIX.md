# FEATURE_VERIFICATION_MATRIX.md

> Verification matrix for every feature in `FEATURE_INVENTORY.md` (52 features).
> This is a **test/verification specification + status snapshot** — not fixes, not a security
> review, not new features. Test cases are verification specs, not findings.

## Conventions

**Priority**
- **P0** — money/data critical (moves/refunds money, settlements, COD, pricing, stock decrement, identity/tokens, order record-of-truth).
- **P1** — core operations (fulfilment, dispatch, catalog, tracking, notifications, stock state).
- **P2** — secondary (discovery, presentation, reporting niceties, hidden/dead surfaces).

**Current Status** — `Implemented` · `Partial` · `Dead` · `Experimental` (carried from `FEATURE_INVENTORY.md`).

**Verification Status** — current state of *this* verification effort:
- **Runtime Verified** — exercised against a running system with observed behaviour. **None yet** — this matrix is the pre-execution baseline; reaching Runtime Verified is the goal of `PHASED_VERIFICATION_PLAN.md`.
- **Code Verified Only** — implementation read end-to-end in discovery; contract understood and internally consistent. The app-UI binding for the feature is generally still unverified at runtime.
- **Not Verified** — only enumerated by name/usage/signature in discovery; behaviour not confirmed from source.

**Risk Level** (production blast radius if the feature is wrong): `Critical` · `High` · `Medium` · `Low`.

**Estimated Verification Effort** — `S` ≤0.5 day · `M` ≈1 day · `L` ≈2 days · `XL` ≈3+ days (one engineer; includes harness/fixture setup noted per item).

---

# A. Customer App

### A1. Phone OTP Login & Signup
- **Priority:** P0 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** High · **Effort:** M
- **Roles:** customer (shared OTP/JWT engine with all roles)
- **Screens:** `auth/OtpLoginScreen`, `auth/VerifyOtpScreen`, `auth/SetupProfileScreen`
- **APIs:** `POST /auth/send-otp`, `/verify-otp`, `/refresh`, `/logout`
- **Tables:** `User`, `CustomerProfile`, `OtpAttempt`, `RefreshToken`, `ReferralCode`
- **External:** Fast2SMS (dev bypass `123456`)
- **Happy:** new phone → user+profile+referral code created, tokens issued; existing phone → login.
- **Edge:** phone normalization (`+91`/10-digit), OTP expiry (5 min), referral code on signup, `requiresPin` for non-customer.
- **Failure:** wrong OTP ≤5 then 15-min lockout; SMS send failure must not block; expired/garbage refresh token.
- **Concurrency:** two parallel `send-otp` (rate counters), simultaneous refresh of same token (single-flight + reuse-detection revokes all sessions).
- **Recovery:** access expiry → silent refresh → retry once; full session loss → re-login.
- **Permission:** unauth call to `/logout`/`/set-pin` → 401; dev-bypass `123456` must be non-production only.

### A2. Profile & Language
- **Priority:** P2 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Low · **Effort:** S
- **Roles:** customer · **Screens:** `profile/ProfileScreen`, `LanguagePickerScreen`, `AccountPrivacyScreen` · **APIs:** `GET/PUT /users/me` · **Tables:** `User`, `CustomerProfile` · **External:** none
- **Happy:** update first/last name; language switch persists.
- **Edge:** empty/very long names; role-specific fields ignored for customer.
- **Failure:** invalid payload → validation error.
- **Concurrency:** — (last-write-wins, single user).
- **Recovery:** language persisted locally across restart.
- **Permission:** unauth → 401; cannot edit another user's profile (scoped by token).

### A3. Address Book + Map Pin + Reverse Geocode
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** High (delivery accuracy/data integrity) · **Effort:** M
- **Roles:** customer · **Screens:** `profile/{AddressList,AddressDetails,AddressMap,ReceiveAddress,ShareAddress}Screen`, `components/location/*`, `context/AddressContext` · **APIs:** `GET/POST /users/me/addresses`, `PUT/DELETE /:id`, `PATCH /:id/default`, `POST /geo/reverse|autocomplete|place` · **Tables:** `Address` · **External:** Mappls
- **Happy:** create address from map pin → reverse-geocoded fields; first address auto-default.
- **Edge:** Plus-Code stripping; `placeDetails` null → map opens at Chirawa centre; receiver-contact + `mapsLink`.
- **Failure:** Mappls placeholder/timeout → on-device geocoder fallback (never throws); invalid lat/lng.
- **Concurrency:** two addresses set default near-simultaneously (only one default invariant).
- **Recovery:** delete default → newest becomes default; soft-delete keeps order history resolvable.
- **Permission:** cannot read/update/delete another user's address → 403.

### A4. Home Feed (Daily Essentials / Bestsellers / Categories / Specials / Shops)
- **Priority:** P2 · **Status:** Implemented · **Verification:** Code Verified Only (UI Not Verified) · **Risk:** Low · **Effort:** S
- **Roles:** customer · **Screens:** `home/HomeScreen` + section components · **APIs:** `GET /catalog/{daily-essentials,bestsellers,categories,category-images,specials,shops,feed}` · **Tables:** `Product`, `MasterCatalog`, `Shop`, `Category`, `ProductImage` · **External:** none
- **Happy:** each rail renders in-stock items; Daily Essentials in curated order.
- **Edge:** empty catalog; out-of-stock items skipped; eggs excluded from bestsellers.
- **Failure:** Redis cache miss → DB rebuild; null images → native placeholder.
- **Concurrency:** cache stampede on invalidation (single-flight lock).
- **Recovery:** stale cache served within TTL+jitter after writes.
- **Permission:** all public (no auth).

### A5. Aggregated "One Store" Catalog (Phase 4)
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Medium · **Effort:** M
- **Roles:** customer · **Screens:** feed shelves · **APIs:** `GET /catalog/feed` · **Tables:** `Product`, `MasterCatalog` (approved gate) · **External:** none · **Redis:** `catalog:agg:all`
- **Happy:** one tile per approved master at lowest in-stock price; shopCount surfaced.
- **Edge:** unapproved master → passthrough tile; price tie; single-shop master.
- **Failure:** lock-holder busy → fresh build served uncached.
- **Concurrency:** concurrent first-requests → single rebuild, others wait.
- **Recovery:** invalidation on stock/price change reflected within TTL.
- **Permission:** public.

### A6. Search + Autocomplete (pg_trgm + Hinglish aliases)
- **Priority:** P1 · **Status:** Implemented (catalog.service body partially read) · **Verification:** Code Verified Only · **Risk:** Medium · **Effort:** M
- **Roles:** customer · **Screens:** `search/SearchScreen`, `home/SearchBar` · **APIs:** `GET /search`, `/search/suggest`, `/catalog/search` · **Tables:** `Product`, `Shop`, `SearchAlias` · **External:** none
- **Happy:** query ≥2 chars → ranked products+shops; suggest returns ≤8.
- **Edge:** query <2 chars rejected/empty; Hinglish alias expansion; filters (category/shop/price/inStock/sort).
- **Failure:** alias cache miss; no results.
- **Concurrency:** suggest under rate limit (90/min prod).
- **Recovery:** alias cache rebuild after admin edit.
- **Permission:** public.

### A7. Product Detail + Variants
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Medium (variant price → cart) · **Effort:** S
- **Roles:** customer · **Screens:** `product/ProductDetailScreen`, `components/product/ProductCard` · **APIs:** `GET /catalog/products/:id`, `/catalog/products` · **Tables:** `Product`, `ProductVariant`, `ProductImage`, `MasterCatalog`
- **Happy:** detail renders images/attributes/variants; variant price overrides base.
- **Edge:** no variants (base unit); out-of-stock/hidden product; MRP vs price.
- **Failure:** missing product → 404; broken image URL.
- **Concurrency:** — (read-only).
- **Recovery:** — .
- **Permission:** public.

### A8. Cart (multi-shop, Redis-backed)
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** High (price/qty integrity; prior YMAL race history) · **Effort:** M
- **Roles:** customer · **Screens:** `context/CartContext`, `CartDockPill`, `cart/FlyToCart` · **APIs:** `GET /cart`, `POST /cart/items`, `PUT /cart/items/:productId`, `DELETE /cart` · **Tables:** `Cart`, `CartItem` (Redis `cart:{userId}`) · **External:** none
- **Happy:** add/update/remove; multi-shop lines coexist; subtotal correct.
- **Edge:** variant vs base line identity; qty 0 removes; fee-band crossing → `requiresPricingRefresh`; `masterId`/`aggregated` stamping.
- **Failure:** out-of-stock/hidden add rejected; shop inactive.
- **Concurrency:** rapid add + qty change of same line (YMAL race — last-write integrity); parallel adds from two devices.
- **Recovery:** Redis loss → DB cart row recovery; 24h TTL expiry.
- **Permission:** cart scoped to token user only.

### A9. Checkout, Pricing Preview & Order Creation
- **Priority:** P0 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Critical · **Effort:** L
- **Roles:** customer · **Screens:** `orders/CheckoutScreen` · **APIs:** `POST /pricing/preview`, `POST /orders` · **Tables:** `Order`, `OrderItem`, `OrderGroup`, `Address`, `FeeRule`, `PromoCode`, `PromoRedemption`, `Product` · **External:** none (ETA uses stored coords)
- **Happy:** single + multi-shop checkout → 1 order/shop under one group; correct fee/discount/total; cart cleared.
- **Edge:** operating-hours gate (`SHOP_CLOSED`); aggregated line re-resolution; dropped lines (sold out everywhere); FIRSTORDER auto-promo.
- **Failure:** empty cart; deleted/foreign address; inactive shop; oversell → whole order rolls back (`decrementStockOrThrow`).
- **Concurrency:** two checkouts racing last unit (stock decrement atomicity); duplicate "Place Order" taps (duplicate-order protection).
- **Recovery:** transaction rollback leaves no partial order; cart preserved on failure.
- **Permission:** cannot order against another user's address → 403.

### A10. Payment (Razorpay)
- **Priority:** P0 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Critical · **Effort:** L (needs Razorpay sandbox + webhook tunnel)
- **Roles:** customer · **Screens:** `components/payment/RazorpayCheckout`, `orders/OrderPlacedScreen` · **APIs:** `POST /payments/orders/:orderId`, `/payments/verify/:orderId`, `/payments/webhook/razorpay` · **Tables:** `Payment`, `PaymentWebhookEvent`, `Order`, `Transaction` · **External:** Razorpay
- **Happy:** create order → pay → verify → order `paid`; seller alerted; multi-shop = one payment settles all child orders.
- **Edge:** dev-mock mode (placeholder keys); already-paid idempotent verify.
- **Failure:** bad signature → reject; `payment.failed` webhook; webhook for unknown order.
- **Concurrency:** verify + webhook arriving together (both idempotent on order status); duplicate webhook delivery (unique `eventId`).
- **Recovery:** dropped webhook → reconciliation job marks paid (see E3).
- **Permission:** cannot pay another user's order → 403; webhook requires valid signature.

### A11. Order Tracking (live, Tracking V2)
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Medium · **Effort:** M
- **Roles:** customer (rider/admin view via getOrder) · **Screens:** `orders/OrderTrackingScreen`, `components/tracking/TrackingMap` · **APIs:** `GET /orders/:id`, `/orders/group/:groupId`, `/delivery/orders/:orderId/rider-location`; socket `order:subscribe` · **Tables:** `Order`, `OrderItem`, `OrderStatusHistory`, `Payment`, `RiderProfile` · **External:** Google Maps (client)
- **Happy:** live status + rider location + ETA + refund block render; group view aggregates children.
- **Edge:** rider PII shown only during `picked_up`/`out_for_delivery` to customer/rider/admin; map gated on location freshness; terminal order hides ETA.
- **Failure:** socket drop → REST poll fallback; stale/no rider location.
- **Concurrency:** multiple subscribers per order room; reconnect re-subscribe.
- **Recovery:** missed socket event → `GET /orders/:id` reconciles.
- **Permission:** non-owner customer cannot view order → 403; seller never sees rider phone.

### A12. Server-Computed ETA (Phase 1)
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Medium · **Effort:** S
- **Roles:** customer · **Screens:** tracking (ETA hero) · **APIs:** in `GET /orders/:id`; socket `order:eta` · **Tables:** `Order` (eta fields) · **External:** none
- **Happy:** ETA = prep+travel+dwell+handover; recomputed each transition; sent as `secondsRemaining`+`serverNow`.
- **Edge:** leg=0 valid vs missing coords → wide fallback; floor 5 min; spread by phase.
- **Failure:** ETA computation throws → swallowed, order flow unaffected.
- **Concurrency:** transition + recompute ordering (ETA persisted before status event).
- **Recovery:** terminal state leaves stale value but display gated.
- **Permission:** same as order read.

### A13. Order History, Cancel, Rate, Edit Address/Receiver
- **Priority:** P0 (cancel→refund) · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Critical · **Effort:** M (Razorpay refund sandbox)
- **Roles:** customer · **Screens:** `orders/OrderHistoryScreen`, `OrderTrackingScreen` · **APIs:** `GET /orders`, `DELETE /orders/:id`, `POST /orders/:id/rating`, `PATCH /orders/:id/delivery-address`, `/receiver` · **Tables:** `Order`, `OrderStatusHistory`, `Payment`, `Transaction` · **External:** Razorpay (refund)
- **Happy:** cancel while cancellable → prepaid auto-refund + rider/batch freed; rate after delivery; edit address/receiver pre-pickup.
- **Edge:** cancel blocked past `confirmed`; COD cancel refunds nothing; rate once only; edit blocked post-pickup.
- **Failure:** refund API failure path; rate on non-delivered → reject.
- **Concurrency:** customer cancel racing rider pickup / status advance.
- **Recovery:** refund recorded even in dev-mock; status transition owns state.
- **Permission:** cannot cancel/rate/edit another user's order → 403.

### A14. Item-Unavailable Live Update + Substitute (customer side)
- **Priority:** P0 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Critical (refund) · **Effort:** M (shared flow with C6)
- **Roles:** customer · **Screens:** `OrderTrackingScreen` (socket `order:item-unavailable`) · **APIs:** (triggered by rider C6) · **Tables:** `OrderItem`, `Order`, `Payment` · **External:** Razorpay
- **Happy:** live banner shows refunded line + tappable substitute; whole-order cancel if only line.
- **Edge:** COD = cash-due reduction (no Razorpay); no substitute available.
- **Failure:** socket missed → refund still reflected in `GET /orders/:id`.
- **Concurrency:** see C6.
- **Recovery:** refund persisted regardless of socket delivery.
- **Permission:** event only to the order's customer room.

### A15. "Request This Item" + Restock Notify (Phase 6)
- **Priority:** P2 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Low · **Effort:** S
- **Roles:** customer · **Screens:** request entry points · **APIs:** `POST /catalog/requests` · **Tables:** `ProductRequest` · **External:** FCM (restock)
- **Happy:** request captured (pincode only); restock flip → FCM once.
- **Edge:** valid barcode links master; anonymous vs auth; `notifiedAt` makes fan-out at-most-once.
- **Failure:** notify hiccup non-blocking to stock toggle.
- **Concurrency:** restock flip racing duplicate requests (dedupe by notifiedAt).
- **Recovery:** —.
- **Permission:** request requires auth.

### A16. Push Notifications (customer)
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Medium · **Effort:** M (FCM project or dev console)
- **Roles:** customer · **Screens:** `components/NotificationsBootstrap`, `services/notifications` · **APIs:** `POST/DELETE /notifications/register-token`, `GET /notifications`, `PATCH /:id/read` · **Tables:** `Notification` (Redis `fcm:token:{userId}`) · **External:** FCM
- **Happy:** token registered; status pushes delivered; history + mark-read.
- **Edge:** token refresh re-register; 90-day TTL; dev console mode.
- **Failure:** invalid/expired token (logged, not fatal); FCM unconfigured.
- **Concurrency:** multiple devices same user (only one token key — last wins).
- **Recovery:** logout unregisters; re-register on relaunch.
- **Permission:** history scoped to token user.

### A17. Referral / Loyalty / Wallet UI
- **Priority:** P2 · **Status:** Dead/Hidden (`growthLoops:false`) · **Verification:** Code Verified Only · **Risk:** Low · **Effort:** S
- **Roles:** customer · **Screens:** gated off · **APIs:** `GET /users/me/loyalty` (works), `GET /loyalty` (stub) · **Tables:** `WalletTransaction`, `LoyaltyTier`, `ReferralCode`, `ReferralRedemption`
- **Happy:** verify UI hidden behind flag; `GET /users/me/loyalty` returns tier when called.
- **Edge:** flag on → UI appears (manual).
- **Failure:** `GET /loyalty` returns stub string.
- **Concurrency:** —. **Recovery:** —.
- **Permission:** loyalty scoped to token user.

---

# B. Seller App

### B1. Seller OTP + PIN Login
- **Priority:** P0 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** High · **Effort:** S (delta over A1)
- **Roles:** seller · **Screens:** `auth/{OtpLogin,VerifyOtp,SetPin}Screen` · **APIs:** `POST /auth/send-otp`, `/verify-otp`, `/set-pin` · **Tables:** `User`, `SellerProfile` (`pinHash`,`pinFailCount`,`pinLockedUntil`)
- **Happy:** OTP → `requiresPin` → set PIN → PIN verify.
- **Edge:** seeded seller `+91` vs 10-digit phone mismatch (known); PIN reset on set.
- **Failure:** 5 PIN fails → 15-min lock; PIN before set → error.
- **Concurrency:** parallel PIN attempts incrementing fail count.
- **Recovery:** lock auto-expires; refresh rotation.
- **Permission:** PIN endpoints seller/rider/admin only.

### B2. Order Queue + Accept / Reject / Prepare / Ready
- **Priority:** P0 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Critical (reject→refund + state) · **Effort:** M
- **Roles:** seller · **Screens:** `orders/OrderQueueScreen` · **APIs:** `GET /orders`, `POST /orders/:id/{accept,reject,preparing,ready}` · **Tables:** `Order`, `OrderStatusHistory`, `SellerProfile.missedAcceptances`, `Payment` · **External:** Razorpay (refund on reject) · **Realtime:** `order:new/status/cancelled`
- **Happy:** accept (paid→confirmed / COD stays confirmed) → preparing → ready; reject → cancel+refund+free rider.
- **Edge:** accept only from `paid|confirmed`; idempotent same-status; `sellerAcceptedAt` stamp.
- **Failure:** accept/reject of non-pending order → BusinessRule error; refund failure on reject.
- **Concurrency:** seller accept racing auto-accept timer (B3); reject racing customer cancel.
- **Recovery:** socket missed → `GET /orders` reload.
- **Permission:** seller acting on another shop's order → 403.

### B3. Auto-Accept on Seller Timeout
- **Priority:** P0 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** High · **Effort:** M (time control via `SELLER_ACCEPT_MS`)
- **Roles:** system (seller) · **Screens:** — · **APIs:** internal (`seller-timeout.plugin` worker) · **Tables:** `Order`, `SellerProfile.missedAcceptances` · **Queue:** `chirawa-seller-accept`
- **Happy:** no seller action in 3 min → auto-accept (paid→confirmed), miss counted.
- **Edge:** COD already confirmed (no transition); already-accepted → no-op.
- **Failure:** order not found / not pending → skip.
- **Concurrency:** stable `jobId` dedupes API-timer vs worker-reconcile producers; seller accepts just before timer fires.
- **Recovery:** job persisted in BullMQ (survives restart); fires in API process so events propagate.
- **Permission:** no ownership check (system actor) — verify it only fires for awaiting-acceptance orders.

### B4. Stock Management (status + qty + CRUD + variants + CSV)
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** High (drives oversell/feed) · **Effort:** M
- **Roles:** seller (admin bypass) · **Screens:** `stock/StockScreen` · **APIs:** `PATCH /catalog/products/:id/stock`, `/stock-qty`, `POST/PATCH/DELETE products|categories|variants`, `POST /catalog/products/import`, `/upload-image` · **Tables:** `Product`, `ProductVariant`, `Category`, `ProductImage`, `StockUpdateLog` · **External:** R2
- **Happy:** toggle status; set qty (0→out_of_stock); create/update/delete product/category/variant; CSV import.
- **Edge:** MRP≥price; opt-in numeric stock; category-in-shop; soft-delete; CSV barcode GS1 validation.
- **Failure:** invalid paise; foreign shop/product; CSV bad rows reported per-row.
- **Concurrency:** re-import same CSV (idempotent by shopId+name/barcode); stock toggle vs in-flight checkout.
- **Recovery:** cache invalidation propagates within seconds; soft-delete preserves order history.
- **Permission:** seller editing another shop's product/category → 403.

### B5. Barcode Scan → "I Stock This" + Offline Queue
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Medium · **Effort:** M (device scanner)
- **Roles:** seller · **Screens:** `stock/BarcodeScannerModal`, `services/offline-queue` · **APIs:** `GET /catalog/master/:barcode`, `POST /catalog/products/stock-this` · **Tables:** `Product`, `MasterCatalog` · **External:** OFF live
- **Happy:** scan → master prefill → stock-this upsert (201 create / 200 update).
- **Edge:** unknown barcode → OFF live bootstrap; invalid GS1 → reject; re-scan updates not duplicates.
- **Failure:** OFF unreachable; invalid barcode.
- **Concurrency:** offline queue replay (idempotent by shopId+barcode; latest-wins local dedupe).
- **Recovery:** network down → queued in AsyncStorage → replayed; permanent failures dropped.
- **Permission:** stock-this for another shop → 403.

### B6. Report Wrong Image (seller)
- **Priority:** P2 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Low · **Effort:** S
- **Roles:** seller (any auth) · **APIs:** `POST /catalog/products/:id/report-image` · **Tables:** `ImageReport`, `MasterCatalog` (re-gated)
- **Happy:** report → record + master→`needs_review` (leaves public pool).
- **Edge:** product without master (record only); reason truncation.
- **Failure:** non-existent product → 404.
- **Concurrency:** duplicate reports same product.
- **Recovery:** admin resolve re-approves (D4).
- **Permission:** any authenticated user.

### B7. Sales Summary & Settlement History
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Medium (money display, read-only) · **Effort:** S
- **Roles:** seller · **Screens:** `settlement/SettlementScreen` · **APIs:** `GET /sellers/me/sales-summary`, `/me/settlements` · **Tables:** `Order`, `OrderItem`, `Settlement`
- **Happy:** today/week/month counts+value; best-seller; last 8 settlements + live pending.
- **Edge:** Monday-anchored week; commission 0; no orders.
- **Failure:** no shop → 404/empty.
- **Concurrency:** — (aggregate read).
- **Recovery:** —.
- **Permission:** seller sees only own shop's figures.

### B8. Seller Push Notifications
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Medium · **Effort:** S
- **Roles:** seller · **APIs:** `POST /notifications/register-token` · **Tables:** `Notification` · **External:** FCM (`chirawa_alerts`)
- **Happy:** new-order high-priority alarm push; delivered/cancelled pushes.
- **Edge:** alarm channel sound; token TTL.
- **Failure:** no token → silent skip; invalid token logged.
- **Concurrency:** new-order push from both event-bus and worker-reconcile path.
- **Recovery:** re-register on relaunch.
- **Permission:** scoped to seller token.

---

# C. Rider App

### C1. Rider OTP + PIN Login
- **Priority:** P0 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** High · **Effort:** S
- **Roles:** rider · **Screens:** `auth/{OtpLogin,VerifyOtp,SetPin}Screen` · **APIs:** `POST /auth/send-otp`, `/verify-otp`, `/set-pin` · **Tables:** `User`, `RiderProfile`
- **Happy/Edge/Failure/Concurrency/Recovery/Permission:** same engine as B1 (PIN gates COD/delivery actions).

### C2. Online/Offline Availability + Live Location
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Medium · **Effort:** M (device GPS)
- **Roles:** rider · **Screens:** `home/HomeScreen` · **APIs:** `GET/PATCH /delivery/availability`; socket `rider:availability`,`rider:location` · **Tables:** `RiderAvailability`, `RiderLocation` (Redis `rider:{userId}:location` 30s)
- **Happy:** go online → eligible for dispatch; location push every ~8s broadcast to order room.
- **Edge:** offline removes from candidate pool; lat/lng bounds; 30s TTL expiry.
- **Failure:** Redis write fail non-blocking; socket non-rider ignored.
- **Concurrency:** rapid online/offline toggles; location vs availability ordering.
- **Recovery:** disconnect → TTL expiry → location stale; reconnect re-push.
- **Permission:** only riders may send location/availability.

### C3. Incoming-Order Assignment Alert
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Medium · **Effort:** S
- **Roles:** rider · **Screens:** `home/HomeScreen` (socket `order:assigned`) · **APIs:** event-driven · **Tables:** `DeliveryAssignment`, `Order` · **External:** FCM
- **Happy:** assignment → socket + FCM alert with shop/locality/amount.
- **Edge:** batch headline `+N`; COD vs prepaid.
- **Failure:** no token → FCM skip (socket still fires).
- **Concurrency:** assignment while app backgrounded (FCM) vs foregrounded (socket).
- **Recovery:** `GET /delivery/active` reconciles missed alert.
- **Permission:** alert only to assigned rider's room.

### C4. Active Delivery / Batch (pickup → out-for-delivery)
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** High (batch gating) · **Effort:** M
- **Roles:** rider · **Screens:** `delivery/DeliveryScreen` · **APIs:** `GET /delivery/active`, `POST /delivery/orders/:id/pickup`, `/start-delivery` · **Tables:** `DeliveryAssignment`, `Order`, `Batch`, `Shop`, `OrderItem`
- **Happy:** see all stops; pickup each; out-for-delivery once all picked up.
- **Edge:** receiver contact vs account owner; multi-shop batch stops; `allPickedUp` gate.
- **Failure:** start-delivery before all picked up → BusinessRule error.
- **Concurrency:** two riders' assignments isolation; batch order cancelled mid-trip.
- **Recovery:** cancelled order leaves active list (assignment deactivated).
- **Permission:** advancing another rider's order → 403.

### C5. Delivery Completion (prepaid + COD)
- **Priority:** P0 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Critical (cash ledger, terminal state) · **Effort:** M
- **Roles:** rider · **Screens:** `delivery/DeliveryScreen` · **APIs:** `POST /orders/:id/delivered` (prepaid), `/cod-collected` (COD) · **Tables:** `Order`, `OrderStatusHistory`, `RiderProfile.codBalancePaise`
- **Happy:** prepaid → delivered; COD → delivered + cash recorded; customer FCM+SMS, seller FCM.
- **Edge:** COD path rejects non-COD and vice-versa; `RiderProfile.id` keying (BUG-1).
- **Failure:** non-owner rider → 403; wrong payment method → BusinessRule error.
- **Concurrency:** double-submit delivered; deliver racing customer cancel.
- **Recovery:** idempotent terminal state.
- **Permission:** rider completing another rider's delivery → 403.

### C6. Rider Report Item Unavailable (Phase 5)
- **Priority:** P0 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Critical (refund) · **Effort:** M
- **Roles:** rider · **APIs:** `POST /delivery/orders/:orderId/items/:itemId/unavailable` · **Tables:** `OrderItem`, `Order`, `Payment`, `Product`, `Transaction` · **External:** Razorpay
- **Happy:** flag line → product out_of_stock + refund line (or cancel whole order if only line) + substitute suggestion + customer live update.
- **Edge:** COD = totals decrement (no Razorpay); only-line → full cancel + free rider; multi-line → partial.
- **Failure:** order past `ready_for_pickup` → reject; line already reported → reject.
- **Concurrency:** two unavailable reports on same/different lines; report racing customer cancel.
- **Recovery:** refund + status persisted independent of socket.
- **Permission:** rider without active assignment on order → 403.

### C7. Earnings
- **Priority:** P2 · **Status:** Partial (display from profile/COD; no settlement endpoint) · **Verification:** Code Verified Only · **Risk:** Low · **Effort:** S
- **Roles:** rider · **Screens:** `earnings/EarningsScreen` · **Tables:** `RiderProfile` (`monthlySalaryPaise`,`codBalancePaise`), `RiderSettlement`
- **Happy:** show salary + COD balance.
- **Edge:** verify what data source backs the screen (profile vs settlement).
- **Failure:** no rider-self settlement API in `delivery.routes`.
- **Concurrency:** —. **Recovery:** —.
- **Permission:** rider sees only own figures.

---

# D. Admin (API-only)

### D1. Search-Alias Management
- **Priority:** P2 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Low · **Effort:** S
- **Roles:** admin · **APIs:** `POST/GET /admin/search-aliases`, `PATCH /:term/add` · **Tables:** `SearchAlias`
- **Happy:** create/merge aliases; list; cache invalidated.
- **Edge:** dedupe/normalize; merge existing.
- **Failure:** missing term on PATCH → 404.
- **Concurrency:** concurrent merges same term.
- **Recovery:** cache rebuild.
- **Permission:** non-admin → 403.

### D2. Dispatch Live-Ops Snapshot
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Low (read-only) · **Effort:** S
- **Roles:** admin · **APIs:** `GET /admin/dispatch` · **Tables:** `Order`, `RiderProfile`, `RiderAvailability`, `DeliveryAssignment`, `Shop`
- **Happy:** active orders (24h) + unassigned flag + online riders with load.
- **Edge:** rider name resolution; NEEDS_RIDER set.
- **Failure:** —. **Concurrency:** snapshot consistency under churn.
- **Recovery:** —. **Permission:** non-admin → 403.

### D3. Demand Dashboard
- **Priority:** P2 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Low · **Effort:** S
- **Roles:** admin · **APIs:** `GET /admin/product-requests` · **Tables:** `ProductRequest`
- **Happy:** ranked demand by master/barcode/text. **Edge:** grouping. **Permission:** non-admin → 403.

### D4. Catalog Moderation, Coverage & Metrics (Phase 7)
- **Priority:** P1 · **Status:** Implemented (moderation.service partially read) · **Verification:** Code Verified Only · **Risk:** Medium · **Effort:** M
- **Roles:** admin · **APIs:** `GET /admin/moderation/masters`, `PATCH /masters/:id/status`, `GET /moderation/image-reports`, `POST /image-reports/:id/resolve`, `POST /masters/:id/takedown`, `GET /moderation/price-outliers`, `/coverage`, `/metrics` · **Tables:** `MasterCatalog`, `ImageReport`, `Product`, `ProductImage`
- **Happy:** review queue; approve/reject; resolve report; takedown (replace/remove); coverage + metrics.
- **Edge:** UUID validation; re-approve flag; price-outlier detection.
- **Failure:** invalid id → 404. **Concurrency:** two admins moderating same master.
- **Recovery:** takedown re-gates image. **Permission:** non-admin → 403.

### D5. Image Upload & Shop/Product Image Management
- **Priority:** P1 · **Status:** Implemented (pipeline/r2 partially read) · **Verification:** Code Verified Only · **Risk:** Medium · **Effort:** M (R2 creds)
- **Roles:** admin · **APIs:** `POST /admin/upload-image`, `PATCH /shops/:id/images`, `PUT /products/:id/image`, `/images` · **Tables:** `Shop`, `Product`, `ProductImage` · **External:** R2
- **Happy:** upload → normalize (products) → R2 URL; set shop/product images.
- **Edge:** MIME allowlist; 5MB cap; multi-image order; product pipeline vs raw shop path.
- **Failure:** oversize/truncated; bad MIME → 400.
- **Concurrency:** replace-all images vs read. **Recovery:** cache invalidation. **Permission:** non-admin → 403.

### D6. Bulk Product Import (JSON)
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Medium · **Effort:** S
- **Roles:** admin · **APIs:** `POST /admin/products/import` (≤500) · **Tables:** `Product`, `ProductImage`, `ProductVariant`, `Category`
- **Happy:** create/update by (shopId,name); per-row report.
- **Edge:** category find-or-create; variant/image replace; batch cap 500.
- **Failure:** invalid rows reported, not fatal. **Concurrency:** re-run idempotent. **Permission:** non-admin → 403.

### D7. Manual Rider Assignment + Refund (admin)
- **Priority:** P0 (refund moves money) · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** High · **Effort:** S
- **Roles:** admin · **APIs:** `POST /delivery/orders/:orderId/assign`, `POST /payments/refund/:orderId` · **Tables:** `DeliveryAssignment`, `Order`, `Payment`, `Transaction`, `OrderStatusHistory` · **External:** Razorpay
- **Happy:** manual assign to best rider; admin full refund → cancel + ledger.
- **Edge:** already assigned; no captured payment → reject.
- **Failure:** refund API failure. **Concurrency:** manual assign racing auto-dispatch. **Recovery:** ledger transaction recorded. **Permission:** non-admin → 403.

---

# E. Backend Platform

### E1. Order State Machine
- **Priority:** P0 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Critical · **Effort:** S (unit-testable)
- **Roles:** system · **Code:** `orders.service.ts:78-98` · **Tables:** `Order`, `OrderStatusHistory`
- **Happy:** each legal transition allowed; history row written.
- **Edge:** same-status idempotent no-op; timestamp stamping per status.
- **Failure:** illegal jump → BusinessRule error.
- **Concurrency:** two transitions racing same order.
- **Recovery:** —. **Permission:** transitions invoked only by authorized service paths.

### E2. Auto-Dispatch via Delivery Batching
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** High · **Effort:** L (multi-rider/zone; time control)
- **Roles:** system · **Code:** `dispatch.plugin`, `batching.service`, `assignment.job` · **Tables:** `Batch`, `DeliveryAssignment`, `Order`, `DeliveryZone`, `RiderZone`, `RiderAvailability`, `AppConfig` · **Queue:** `chirawa-order-assignment` · **External:** Fast2SMS (escalation)
- **Happy:** confirmed → join/open batch → assign best rider after window/full.
- **Edge:** zone point-in-polygon + centroid fallback; ≤3/800m/3-min; fewest-active-deliveries pick.
- **Failure:** no rider → retry 10×@60s → SMS escalate to `support_phone`.
- **Concurrency:** two confirmed orders racing into same batch; batch full vs window; assign job vs cancel.
- **Recovery:** batch job persisted; empty/handled batch skipped; cancelled order frees batch.
- **Permission:** system actor; manual override admin-only (D7).

### E3. Payment Webhook + Reconciliation
- **Priority:** P0 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Critical · **Effort:** L (idempotency + dropped-webhook sim)
- **Roles:** system · **Code:** `payments.service.processWebhook`, `reconciliation.job` · **Tables:** `Payment`, `PaymentWebhookEvent`, `Order`, `Transaction` · **External:** Razorpay
- **Happy:** captured webhook → all linked orders paid; reconcile sweep catches stuck>30min.
- **Edge:** process-then-record idempotency; multi-shop single razorpayOrder.
- **Failure:** transient handler error → event NOT recorded → Razorpay retry re-runs; bad signature → reject.
- **Concurrency:** duplicate webhook delivery (unique eventId); webhook + verify + reconcile all settling same order.
- **Recovery:** reconcile is the safety net for dropped webhooks; worker-process pushes seller directly.
- **Permission:** webhook requires valid signature (dev skip on placeholder).

### E4. Seller Daily Settlement + RazorpayX Payouts
- **Priority:** P0 · **Status:** Implemented (seller-notify TODO) · **Verification:** Code Verified Only · **Risk:** Critical · **Effort:** L (RazorpayX sandbox)
- **Roles:** system · **Code:** `settlement.job` (`runDailySettlement`,`initiatePayout`,`runPayoutReconciliation`) · **Tables:** `Settlement`, `Transaction`, `SellerProfile`, `Order`, `OrderItem`, `Shop` · **External:** RazorpayX
- **Happy:** daily delivered-order sum → settlement → payout; ledger only when `processed`.
- **Edge:** no UPI → pending+needsAttention (not failed); unconfigured → pending (never faked); in-flight states.
- **Failure:** payout rejected/failed → flagged; API error → failed+retryable (idempotency key).
- **Concurrency:** re-run idempotent (`sellerId_periodDate` unique + payoutId guard); reconcile writes ledger once.
- **Recovery:** payout-reconcile sweep finalizes queued/processing payouts.
- **Permission:** system actor; settlement figures readable only by owning seller (B7).

### E5. Notifications Fan-out (event-bus → FCM/SMS + Socket.IO)
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Medium · **Effort:** M
- **Roles:** system · **Code:** `notifications.plugin`, `realtime.plugin` · **Tables:** `Notification` · **External:** FCM, Fast2SMS
- **Happy:** each event → correct channel(s) + Notification row + socket broadcast.
- **Edge:** delivered = FCM+SMS; cancelled refund-specific message; seller alarm channel.
- **Failure:** notification errors never crash order flow; missing token skip.
- **Concurrency:** multiple listeners per event; cross-instance socket via Redis adapter.
- **Recovery:** worker-origin events reach API via Redis bridge (E6).
- **Permission:** events routed to correct user/role rooms only.

### E6. Cross-Process Event Bus (Redis pub/sub bridge)
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** High (silent loss → missed notif/dispatch) · **Effort:** M (multi-process)
- **Roles:** system · **Code:** `shared/events/event-bus.ts` · **External:** Redis pub/sub `chirawa:events:v1`
- **Happy:** worker emit → API listeners fire (socket/FCM/dispatch).
- **Edge:** self-echo suppression by PROCESS_ID; local delivery unchanged.
- **Failure:** publish failure fire-and-forget (must not block emitter); subscriber reconnect.
- **Concurrency:** multi-instance API each receiving; ordering across processes.
- **Recovery:** bridge idempotent re-subscribe; (no replay — verify behaviour on Redis blip).
- **Permission:** internal channel.

### E7. Catalog Image Enrichment (OFF)
- **Priority:** P1 · **Status:** Implemented (gated on dump) · **Verification:** Code Verified Only (job body partially read) · **Risk:** Low · **Effort:** S
- **Roles:** system · **Code:** `enrichment.job`, `off-source`, `image-pipeline`, `r2.service` · **Tables:** `MasterCatalog` · **External:** OFF dump → R2 · **Queue:** `chirawa-enrichment`
- **Happy:** nightly sweep enriches un-imaged masters from dump.
- **Edge:** no dump → `needs_manual`; resumable via enrichmentStatus; never hits live OFF for bulk.
- **Failure:** transient error → `error` status, retried.
- **Concurrency:** concurrency 1 (paced); re-run idempotent.
- **Recovery:** status-driven resume. **Permission:** internal.

### E8. Referral Credit Unlock
- **Priority:** P0 (money by nature) · **Status:** Dead/Disconnected · **Verification:** Code Verified Only · **Risk:** Low (currently inert) · **Effort:** S
- **Roles:** system · **Code:** `referral.job` (built) + `enqueueReferralUnlock` (only logs — `orders.service.ts:894`) · **Tables (would touch):** `ReferralRedemption`, `CustomerProfile`, `WalletTransaction`, `Transaction`, `ReferralCode`
- **Happy:** **verify inert** — confirm no credits granted on first delivery (producer never enqueues).
- **Edge:** worker logic correct IF reconnected (first-delivery once, dedupe).
- **Failure:** —. **Concurrency:** —. **Recovery:** —.
- **Permission:** internal.

### E9. Maintenance Cleanup Jobs
- **Priority:** P1 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** Low · **Effort:** S
- **Roles:** system · **Code:** `cleanup.job` · **Tables:** `RiderLocation`, `OtpAttempt`, `RefreshToken`, `Cart` · **Queue:** `chirawa-cleanup`
- **Happy:** purge locations>7d, OTP>24h, expired tokens, expired carts (Redis+DB).
- **Edge:** revoked/used token windows; cart Redis+DB consistency.
- **Failure:** partial deletes. **Concurrency:** runs vs live writes. **Recovery:** idempotent re-run. **Permission:** internal.

### E10. Audit Log
- **Priority:** P2 · **Status:** Partial (table only — no writers found) · **Verification:** Code Verified Only · **Risk:** Low · **Effort:** S
- **Roles:** system · **Tables:** `AuditLog`, `AuditAction`
- **Happy:** **verify whether any path writes audit rows** (none found in discovery).
- **Edge:** confirm schema vs intended actions. **Failure/Concurrency/Recovery:** —. **Permission:** —.

### E11. Fee Rules / Pricing Engine
- **Priority:** P0 · **Status:** Implemented (flat active; distance bands dormant) · **Verification:** Code Verified Only · **Risk:** Critical · **Effort:** S (pure function)
- **Roles:** system · **Code:** `pricing.service` (flat), `distance.service` (dormant) · **Tables:** `FeeRule`
- **Happy:** ₹25 <₹100 / ₹15 special / ₹10 standard; active version stamped.
- **Edge:** non-integer/negative paise rejected; multi-shop single combined fee; special-shop carrier.
- **Failure:** no active fee rule → error.
- **Concurrency:** fee-rule version change mid-checkout.
- **Recovery:** version stamped on order for audit. **Permission:** internal.

### E12. Promotions
- **Priority:** P0 · **Status:** Implemented · **Verification:** Code Verified Only · **Risk:** High · **Effort:** M
- **Roles:** system/customer · **Code:** `promotions.service` · **Tables:** `PromoCode`, `PromoRedemption`
- **Happy:** flat/percent/free_delivery applied; FIRSTORDER auto for first-time.
- **Edge:** discount clamp [0, subtotal+fee]; min-cart; per-user/total caps; expiry; group-level apply.
- **Failure:** invalid/expired/exhausted code → customer-facing error; auto-promo soft-fail.
- **Concurrency:** same code redeemed twice by one user (unique constraint); total-uses race.
- **Recovery:** redemption recorded with order. **Permission:** per-user usage enforced.

### E13. COD Float Cap
- **Priority:** P0 (money risk control) · **Status:** Partial (config only — no enforcement found) · **Verification:** Code Verified Only · **Risk:** High (latent) · **Effort:** S
- **Roles:** system/rider · **Config:** `COD_FLOAT_CAP_PAISE` (₹2000); `RiderProfile.codBalancePaise`
- **Happy:** **verify whether cap is enforced anywhere** (none found in discovery).
- **Edge:** rider COD balance accumulation past cap.
- **Failure:** confirm no block exists on COD order beyond cap.
- **Concurrency/Recovery:** —. **Permission:** —.

---

## Consolidated Matrix (52 features)

| Feature | Priority | Verification Status | Risk Level | Est. Verification Effort |
|---|---|---|---|---|
| A1 OTP Login & Signup | P0 | Code Verified Only | High | M (OTP/JWT harness) |
| A9 Checkout & Order Creation | P0 | Code Verified Only | Critical | L (seeded catalog+addr) |
| A10 Payment (Razorpay) | P0 | Code Verified Only | Critical | L (Razorpay sandbox) |
| A13 Cancel / Refund / Rate / Edit | P0 | Code Verified Only | Critical | M (refund sandbox) |
| A14 Item-Unavailable Live (customer) | P0 | Code Verified Only | Critical | M (shared w/ C6) |
| B1 Seller OTP+PIN Login | P0 | Code Verified Only | High | S |
| B2 Seller Accept/Reject/Prepare/Ready | P0 | Code Verified Only | Critical | M |
| B3 Auto-Accept on Timeout | P0 | Code Verified Only | High | M (time control) |
| C1 Rider OTP+PIN Login | P0 | Code Verified Only | High | S |
| C5 Delivery Completion + COD | P0 | Code Verified Only | Critical | M |
| C6 Rider Report Item Unavailable | P0 | Code Verified Only | Critical | M |
| D7 Admin Manual Assign + Refund | P0 | Code Verified Only | High | S |
| E1 Order State Machine | P0 | Code Verified Only | Critical | S (unit) |
| E3 Payment Webhook + Reconciliation | P0 | Code Verified Only | Critical | L |
| E4 Seller Settlement + Payouts | P0 | Code Verified Only | Critical | L (RazorpayX) |
| E8 Referral Credit Unlock | P0 | Code Verified Only | Low (inert) | S (verify inert) |
| E11 Fee / Pricing Engine | P0 | Code Verified Only | Critical | S (pure fn) |
| E12 Promotions | P0 | Code Verified Only | High | M |
| E13 COD Float Cap | P0 | Code Verified Only | High (latent) | S (verify enforcement) |
| A3 Address Book + Geocode | P1 | Code Verified Only | High | M (Mappls/map) |
| A5 Aggregated Catalog Feed | P1 | Code Verified Only | Medium | M |
| A6 Search + Autocomplete | P1 | Code Verified Only | Medium | M |
| A7 Product Detail + Variants | P1 | Code Verified Only | Medium | S |
| A8 Cart (multi-shop) | P1 | Code Verified Only | High | M (race) |
| A11 Order Tracking (live) | P1 | Code Verified Only | Medium | M (socket/map) |
| A12 Server ETA | P1 | Code Verified Only | Medium | S |
| A16 Push Notifications (customer) | P1 | Code Verified Only | Medium | M (FCM) |
| B4 Stock Management | P1 | Code Verified Only | High | M |
| B5 Barcode Scan / Stock-This + Offline | P1 | Code Verified Only | Medium | M (device) |
| B7 Sales & Settlement Reporting | P1 | Code Verified Only | Medium | S |
| B8 Seller Push | P1 | Code Verified Only | Medium | S |
| C2 Availability + Live Location | P1 | Code Verified Only | Medium | M (GPS) |
| C3 Assignment Alert | P1 | Code Verified Only | Medium | S |
| C4 Active Delivery / Batch | P1 | Code Verified Only | High | M |
| D2 Dispatch Live-Ops Snapshot | P1 | Code Verified Only | Low | S |
| D4 Catalog Moderation / Coverage / Metrics | P1 | Code Verified Only | Medium | M |
| D5 Image Upload & Management | P1 | Code Verified Only | Medium | M (R2) |
| D6 Bulk Product Import (JSON) | P1 | Code Verified Only | Medium | S |
| E2 Auto-Dispatch Batching | P1 | Code Verified Only | High | L |
| E5 Notifications Fan-out | P1 | Code Verified Only | Medium | M |
| E6 Cross-Process Event Bus | P1 | Code Verified Only | High | M (multi-proc) |
| E7 Catalog Enrichment (OFF) | P1 | Code Verified Only | Low | S |
| E9 Maintenance Cleanup Jobs | P1 | Code Verified Only | Low | S |
| A2 Profile & Language | P2 | Code Verified Only | Low | S |
| A4 Home Feed | P2 | Code Verified Only | Low | S |
| A15 Request Item + Restock Notify | P2 | Code Verified Only | Low | S |
| A17 Referral/Loyalty/Wallet UI (hidden) | P2 | Code Verified Only | Low | S |
| B6 Report Wrong Image | P2 | Code Verified Only | Low | S |
| C7 Earnings | P2 | Code Verified Only | Low | S |
| D1 Search-Alias Management | P2 | Code Verified Only | Low | S |
| D3 Demand Dashboard | P2 | Code Verified Only | Low | S |
| E10 Audit Log (partial) | P2 | Code Verified Only | Low | S (verify writers) |

**Roll-up:** 19 × P0 · 24 × P1 · 9 × P2 = 52. Verification baseline: **0 Runtime Verified**,
**52 Code Verified Only**, 0 Not Verified (every feature's core was read in discovery; several
service bodies and most app-UI bindings remain to be exercised at runtime — itemized per feature).
