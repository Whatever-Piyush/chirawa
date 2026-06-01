# BRINGLY — Production Readiness Plan
## Claude Code Build Guide: Chirawa Launch

> **How to use this document:** Work through each Chunk in order. Each Chunk is self-contained and
> builds on the previous. Start a new Claude Code session for each Chunk, paste this full document
> as context, then say "Work on Chunk N". Do not skip Chunks — later Chunks depend on earlier ones.

---

## 1. Project Overview

Bringly is a hyperlocal 30-minute delivery app for **Chirawa, Rajasthan** (population ~80,000,
~3 km radius). It connects customers to local shops — kiranas, grocery stores, beauty shops, and
famous Chirawa Special sweet shops (Lalchand Pede Wala, Kanha Sweets, etc.) — and delivers to
their doorstep.

This is a **marketplace-first model**: Bringly lists local sellers and takes orders; sellers pack,
Bringly riders deliver. In a later phase, Bringly will also stock its own bulk-bought inventory
(own-store). The app must work for real paying customers and real shop owners in Chirawa from
Day 1. This is NOT a demo.

**Scope of this plan: Chirawa only.** No Pilani, no BITS campus, no villages, no other towns.
Everything is designed for one 3 km town.

---

## 2. What Is Already Built

The team has built a full-stack monorepo from scratch. Everything below exists and works in
development. The job of this plan is to fix gaps, wire up incomplete modules, and prepare for
production deployment — not to rebuild from scratch.

**Backend (Fastify + PostgreSQL + Prisma + Redis + BullMQ + Socket.io):**
- Auth module: OTP login + JWT tokens (working)
- Users module: profiles, saved addresses (working, but address UX needs improvement)
- Catalog module: shops, products, categories (working, but no real images)
- Search module: text search with recent + popular (working, no filters yet)
- Cart module: multi-shop cart, split at checkout (working)
- Pricing module: distance-based delivery fee bands (EXISTS but must be replaced with flat ₹10
  and ₹99 minimum order rule — this is Chunk 0)
- Orders module: order creation, status tracking (working)
- Payments module: Razorpay service coded — create order, verify signature, webhook, refunds —
  but NOT wired into customer checkout. Currently COD only in practice.
- Delivery module: route data only. Auto-assign and batching NOT built.
- Loyalty module: fee rules + bronze/silver/gold tiers seeded. Not wired to customer UI.
- Notifications module: FCM push + SMS (working)

**Customer App (React Native + Expo):**
- OTP login, profile setup (name + DOB) — working
- Home screen with live shops, products, categories from API — working
- Category browse, search — working
- Shop detail screen — working
- Multi-shop cart — working
- Checkout: COD only. "Pay online" button shows but is disabled ("coming soon")
- Order tracking: Socket.io live status + 15-second polling. Rider lat/lng is streamed to backend
  but shown only as a text badge — NO live map
- Order history + reorder — working
- Saved addresses — working but addresses are manual text only, no GPS pin
- App-wide dark mode (light/dark/system) — working
- "List Your Shop" screen (WhatsApp lead) — working
- "Chirawa Special" featured carousel — working

**Seller App (React Native + Expo):**
- OTP + PIN auth — working
- Order queue screen — working
- Stock management — working
- Settlement screen — working (basic)

**Rider App (React Native + Expo):**
- OTP + PIN auth — working
- Home screen — working
- Delivery screen — working
- Earnings screen — working (basic)

**Seeded data:** 10 shops, 12 categories, 60 products — real Chirawa-style businesses.

---

## 3. Non-Negotiable Business Rules

These rules must be reflected across the entire codebase — backend pricing logic, frontend display,
checkout flow, and admin configuration. Every Chunk must respect these rules.

**Delivery fee:**
- Flat ₹10 on every order, regardless of distance or order value
- No free delivery tiers at this stage (will be added in Phase 2 when own-store goes live)
- No surge pricing, 
- ₹10 applies to ALL categories
  15 rupee on Chirawa Special sweet shops

**Minimum order:**
- order value less than 100 customer have to pay 25 rupee delivery fee 
- This rule applies across all categories 


**Commission:**
- Currently 0% from all sellers — do NOT build commission deduction into the order flow yet
- Chirawa Special commission will be introduced manually by the team after 1–2 months; the
  backend should have a per-category commission rate field (defaulting to 0%) that can be
  configured from admin without a code change

**Payment methods:**
- COD must always be available
- UPI via Razorpay must be available (Chunk 3 wires this up)
- No card-only flows; UPI is the priority for small-town India

**Language:**
- All customer-facing text must support Hindi and English (i18n already exists — maintain it
  in every new screen and string added)

**Geography:**
- All delivery addresses are within Chirawa. No inter-city or long-distance logic needed.
- Default map center: Chirawa town center coordinates (lat: 28.2388, lng: 75.4247)

**Order timing:**
- App operates 8:00 AM to 9:00 PM
- Outside these hours, the app should show an "We're closed" banner but still allow browsing.
  Checkout should be blocked with message "We deliver 8 AM – 9 PM. Place your order tomorrow!"

---

## 4. Known Gaps — What Is Missing or Broken

This is the full list of things Claude Code must fix or build across all Chunks:

**Critical (blocks real use):**
- Pricing module has distance-based bands — must be replaced with flat ₹10 and of order less than 100 have to pay 25 rupee fee
- Online payments (Razorpay) are coded but not connected to checkout
- No real product/shop images (biggest trust gap — customers see color placeholders)
- Addresses are manual text with a fixed town lat/lng — no GPS or map pin
- No dispatch logic — orders have no way to be auto-assigned to a rider
- No analytics or crash reporting — flying blind in production

**High priority (needed soon after launch):**
- No Product Detail Page (PDP) — users add straight from card with no image, description, or
  pack size info
- Live map tracking shows text badge, not a map
- No first-order discount / coupon system
- Ratings are collected but never shown on shop or product cards
- Search has no filters or sort options
- No refund flow for COD (only possible manually; online refunds need to be automated)

**Medium priority (can be added post-launch):**
- Order batching logic for rider efficiency
- Loyalty rewards not wired to customer UI
- Seller settlement tracking is basic
- Admin dashboard is missing (no visibility into business metrics)
- No Sentry crash reporting in any app

---

## 5. Monorepo Structure

```
bringly/                         ← root (pnpm monorepo)
├── apps/
│   ├── customer/                ← Customer React Native app (Expo)
│   ├── seller/                  ← Seller React Native app (Expo)
│   └── rider/                   ← Rider React Native app (Expo)
├── api/                         ← Fastify backend
│   ├── src/
│   │   ├── modules/             ← auth, users, catalog, cart, orders, payments, delivery,
│   │   │                           pricing, loyalty, notifications, search, admin
│   │   ├── services/            ← Razorpay, FCM, SMS, etc.
│   │   └── workers/             ← BullMQ background jobs
│   └── prisma/
│       └── schema.prisma        ← Database schema
├── packages/
│   └── shared/                  ← Shared types, constants, i18n strings
└── package.json
```

When Claude Code references a file, it should use paths relative to this structure.

---

## 6. Build Chunks — Priority Order

| Chunk | Name | Priority | Estimated sessions |
|-------|------|----------|-------------------|
| 0 | Foundation & Configuration | CRITICAL — do first | 1–2 |
| 1 | Images & Product Detail Page | HIGH | 2–3 |
| 2 | Address & GPS Pin | HIGH | 1–2 |
| 3 | Payments — UPI via Razorpay | HIGH | 2–3 |
| 4 | Search Filters & Ratings | MEDIUM | 1–2 |
| 5 | Rider Dispatch & Auto-Assignment | HIGH | 2–3 |
| 6 | Live Map Tracking | MEDIUM | 1–2 |
| 7 | Promotions & First-Order Discount | MEDIUM | 1–2 |
| 8 | Seller Portal Improvements | MEDIUM | 1–2 |
| 9 | Admin Dashboard | MEDIUM | 2–3 |
| 10 | Analytics & Crash Reporting | HIGH (pre-launch) | 1 |
| 11 | Production Deployment | CRITICAL — do last | 2–3 |

---

## CHUNK 0 — Foundation & Configuration

**Goal:** Fix the pricing module and set up all configuration correctly before any other Chunk
touches the codebase. This Chunk has no visible UI changes — it is plumbing that everything else
depends on.

### Tasks:

**Task 0.1 — Replace pricing module with flat ₹10  if order less than 100 have to pay 25 rupee deivery fee
The current pricing module calculates delivery fee based on cart value bands
(under ₹100 → ₹20, ₹100–300 → ₹15, over ₹300 → ₹10). This must be completely replaced.

New pricing logic:
- If cart total (goods value) is below ₹99: order cannot be placed. Return a clear error.
- If cart total is ₹99 or above: delivery fee is exactly ₹10, regardless of anything else.
- No distance calculation. No basket-size tiers. Just flat ₹10.
- This logic lives in the pricing module and is called at checkout creation.


**Task 0.2 — Add commission rate field to category and shop schema**
In the Prisma schema, add a `commissionRate` field (decimal, default 0.00) to both the Category
model and the Shop model. The Shop-level rate overrides the Category-level rate. This field starts
at 0 for everyone. It will be set to 0.13 (13%) for Chirawa Special shops manually via admin
once we're ready — but the field must exist in the schema now so no migration is needed later.

**Task 0.3 — Add operating hours enforcement**
Add a configuration table in the database (or a simple constants file) for operating hours:
open time 08:00, close time 21:00, timezone Asia/Kolkata. At checkout, the API must check current
time and reject orders outside these hours with a clear error message. The customer app must also
show a banner on the home screen when the app is outside operating hours, and disable the checkout
button. Browsing (viewing products, shops) must still work outside hours.

**Task 0.4 — Standardise error responses across all API modules**
Do an audit of all API routes and ensure every error returns a consistent JSON structure:
`{ success: false, error: { code: string, message: string } }`. Any route returning raw errors,
unstructured text, or 500s with stack traces must be fixed. This is required before going live.

**Task 0.5 — Environment variable audit and .env.example creation**
Create a comprehensive `.env.example` file at the root listing every environment variable needed
across the entire monorepo — database URL, Redis URL, JWT secrets, Razorpay keys, FCM credentials,
SMS API key, app URLs, etc. Every variable must have a comment explaining what it is. No variable
should be hardcoded anywhere in the codebase.

**Task 0.6 — Database constraints and indexes**
Audit the Prisma schema for missing indexes on columns that are frequently queried:
- Orders: customerId, riderId, status, createdAt
- Products: shopId, categoryId, isAvailable
- Shops: isOpen, categoryId
Add any missing indexes. Ensure foreign key constraints are properly defined.

**Acceptance criteria for Chunk 0:**
- Creating a cart with goods value below ₹99 returns an error and checkout is blocked in the app
- Creating a cart with exactly ₹99 proceeds to checkout with ₹10 delivery fee shown
- Creating a cart with ₹500 goods value also shows exactly ₹10 delivery fee (no distance logic)
- Attempting to place an order at 10 PM shows "We deliver 8 AM – 9 PM" error
- All API error responses follow the consistent JSON structure
- `.env.example` exists and documents every required variable

---

## CHUNK 1 — Images & Product Detail Page (PDP)

**Goal:** Replace all color placeholder images with real images, and build a proper Product Detail
Page. This is the single biggest perceived quality gap — the app currently looks like a prototype.

### Tasks:

**Task 1.1 — Image storage setup**
Set up image storage using Cloudinary (free tier is sufficient for launch) or AWS S3. Create a
dedicated upload endpoint in the API (`POST /api/admin/upload-image`) that accepts a multipart
image file, validates it (max 5MB, jpg/png/webp only), optimizes it, and returns a URL. This
endpoint is admin-only. Images should be stored in organized folders: `/shops/`, `/products/`.

**Task 1.2 — Add image URL fields to Prisma schema**
Ensure the Product model has `imageUrl` and `thumbnailUrl` fields. Ensure the Shop model has
`logoUrl`, `bannerUrl`, and `coverImageUrl` fields. If these fields already exist but are unused,
wire them up. If they don't exist, add them with a migration.

**Task 1.3 — Admin image upload tool (basic)**
In the admin module, create simple endpoints to update a shop's images and a product's images
by passing the uploaded image URL. This does not need a full UI yet — these will be used via
API calls or Postman during the initial shop onboarding.

**Task 1.4 — Build the Product Detail Page (PDP) in the customer app**
When a customer taps on a product card anywhere in the app, navigate to a PDP screen instead
of directly adding to cart.

The PDP screen must include:
- Large product image (or placeholder if none uploaded yet)
- Product name, price, and "add to cart" button
- Short description field (1–3 sentences about the product)
- Pack size / variant selector — if a product has multiple variants (e.g., "Amul Milk 500ml /
  1L / 2L"), the customer must be able to select which variant before adding to cart. Each variant
  has its own price and stock status.
- Availability badge (in stock / out of stock)
- Shop name with a tap-through to the shop detail screen
- A "Frequently bought together" section — for now this can show 3 random products from the same
  shop. The recommendation logic can be improved later.

**Task 1.5 — Add variant/pack-size support to catalog**
In the Prisma schema, add a `ProductVariant` model linked to Product. A variant has: name
(e.g., "500ml"), price, stock quantity, and SKU. A product with no variants just has a single
default variant. Update the catalog API to return variants with each product. Update the cart to
track which variant was selected, not just which product.

**Task 1.6 — Update all product cards to reflect new image handling**
Product cards throughout the customer app (home screen, category browse, shop detail, search
results) should display the real product image if available, and a category-colored placeholder
with the first letter of the product name if not. Remove any hardcoded color logic that doesn't
fall back gracefully. Ensure all image loading has a loading skeleton and error fallback.

**Acceptance criteria for Chunk 1:**
- Tapping any product card opens the PDP screen
- PDP shows image, name, price, description, and add-to-cart button
- If a product has variants (e.g., 500ml, 1L), the customer can select one before adding to cart
- The add-to-cart button on PDP adds the correct variant to cart
- Out-of-stock variants show as disabled on PDP
- Product cards show real images where available, graceful placeholder where not

---

## CHUNK 2 — Address & GPS Pin

**Goal:** Replace the current manual text address with a proper address capture flow using GPS
and a map pin, restricted to Chirawa's boundaries.

### Tasks:

**Task 2.1 — Install and configure a map library**
Install `react-native-maps` in the customer app. Configure it for Android (Google Maps) and iOS.
The app's default map viewport must be centred on Chirawa (lat: 28.2388, lng: 75.4247) with a
zoom level that shows the full 3 km town. The map should not allow the user to pan far outside
Chirawa — implement a boundary check: if the selected pin is more than 5 km from Chirawa town
centre, show an error "We currently only deliver within Chirawa."

**Task 2.2 — Build the address add/edit screen**
Create a new `AddressScreen` in the customer app. The screen has two modes: add new address and
edit existing address.

The address capture flow:
1. First: a "Use my current location" button that requests GPS permission and drops a pin at the
   user's current location on the map.
2. The user can drag the pin to their exact house/door location.
3. Below the map, mandatory text fields: House/Flat number or name, Landmark (e.g., "near Shiv
   Mandir"), Mohalla/Area name.
4. Optional: Address label (Home / Work / Other).
5. A "Save Address" button that stores the pin coordinates plus the text fields as a complete
   address object.

The Prisma Address model must store: lat, lng, houseNumber, landmark, areaName, label,
isDefault (boolean).

**Task 2.3 — Update checkout to require a valid GPS address**
At checkout, if the customer has no saved address with GPS coordinates (only the old manual text
addresses), show a prompt to add a proper address before proceeding. Old manual-text-only
addresses should be flagged as "incomplete" in the UI with a prompt to update them.

**Task 2.4 — Show delivery address on order tracking screen**
On the order tracking screen, display the customer's delivery address (house number + landmark)
clearly at the top. This helps the rider confirm they're going to the right place.

**Task 2.5 — Show pin on rider app delivery screen**
On the rider app's active delivery screen, show the customer's delivery location on a small map
with a pin. The rider should be able to tap "Open in Google Maps" to get navigation directions.
This uses the customer's saved lat/lng coordinates.

**Acceptance criteria for Chunk 2:**
- Customer can get current GPS location and drop a pin on Chirawa map
- Customer can drag pin to exact location
- Customer must fill house number and landmark before saving
- Saved address shows in checkout with map thumbnail
- Pin coordinates outside 5 km of Chirawa centre are rejected with a clear message
- Rider app shows customer location on map with Google Maps launch option

---

## CHUNK 3 — Payments: UPI via Razorpay

**Goal:** Wire the existing Razorpay backend service into the customer checkout. UPI must work
end-to-end: customer pays → Razorpay confirms → order is created → seller and rider are notified.

### Background for Claude Code:
The Razorpay service already exists in `api/src/services/` with functions for: create order,
verify signature, handle webhook, and process refunds. These functions exist but are NOT called
from the checkout flow. The customer checkout currently creates orders with COD only.

### Tasks:

**Task 3.1 — Wire Razorpay order creation into checkout API**
When a customer selects "Pay online" at checkout, the checkout API must:
1. First create a Razorpay order using the existing service (amount in paise, ₹10 delivery fee
   included in the total).
2. Return the Razorpay order ID, amount, key, and other required data to the client.
3. Create a Bringly order in the database with status `PAYMENT_PENDING`.
4. Do NOT confirm the order until payment is verified.

**Task 3.2 — Integrate Razorpay SDK in customer app**
Install `react-native-razorpay` in the customer app. On the checkout screen, when "Pay with UPI"
is selected and the customer taps "Place Order":
1. Open the Razorpay payment sheet with UPI as the default/first payment method.
2. Pre-fill customer name, email (if available), and phone number.
3. On success: send the payment details (razorpay_payment_id, razorpay_order_id,
   razorpay_signature) to the backend verification endpoint.
4. On failure or dismissal: show an error and keep the order in `PAYMENT_PENDING` state so
   the customer can retry.

**Task 3.3 — Payment verification endpoint**
Create a `POST /api/orders/:orderId/verify-payment` endpoint that:
1. Accepts the three Razorpay payment fields.
2. Uses the existing Razorpay service to verify the signature.
3. If valid: updates the order status to `CONFIRMED`, triggers the seller and rider
   notification flow, and returns success.
4. If invalid: returns an error and does NOT confirm the order.

**Task 3.4 — Razorpay webhook handler**
Ensure the Razorpay webhook endpoint (already coded) is properly receiving and processing
`payment.captured` and `payment.failed` events. This is the backup confirmation mechanism in
case the client-side verification call fails (e.g., app crash after payment). The webhook must
also update order status and trigger notifications.

**Task 3.5 — Refund flow for prepaid cancelled orders**
When a prepaid order (paid via UPI) is cancelled by the seller or by the customer before dispatch:
1. Automatically trigger a Razorpay refund using the existing refund function.
2. Update the order status to `CANCELLED_REFUND_INITIATED`.
3. Send a push notification to the customer: "Your order was cancelled. ₹[X] will be refunded
   to your UPI account in 5–7 business days."
4. COD cancellations do not need a refund — just update status to `CANCELLED`.

**Task 3.6 — Update checkout screen UI**
The checkout screen must show two clear payment options:
- "Cash on Delivery" (always available)
- "Pay with UPI" (Razorpay — show UPI apps logos if possible)
Both options should be radio buttons. Selecting UPI shows a brief explanation: "Pay securely
via any UPI app." The "Place Order" button text changes to "Pay ₹[total]" when UPI is selected.

**Acceptance criteria for Chunk 3:**
- Customer can select UPI at checkout and successfully pay via Razorpay
- After payment, order status updates to CONFIRMED in real-time
- Seller and rider receive notifications after successful payment
- Failed payments leave the order in PAYMENT_PENDING with a retry option
- Cancelled prepaid orders trigger automatic Razorpay refund
- COD flow is completely unchanged from before

---

## CHUNK 4 — Search Filters & Ratings Display

**Goal:** Make search actually useful and show ratings on shop and product cards.

### Tasks:

**Task 4.1 — Add filters and sort to search API**
The search endpoint must accept optional query parameters:
- `category`: filter by category ID
- `minPrice` / `maxPrice`: filter products by price
- `inStock`: boolean — if true, only return products currently in stock
- `sort`: options are `relevance` (default), `priceLow`, `priceHigh`, `rating`
- `shopId`: filter products to a specific shop

The search results must also return the total count of results so the frontend can show
"Showing X results."

**Task 4.2 — Build filter UI in customer app search screen**
On the search screen, add a filter row below the search bar. This is a horizontally scrollable
set of filter chips: "All", "Grocery", "Kirana", "Sweets", "Beauty" (one chip per active
category). Selecting a chip filters results to that category. A separate "Filter" button opens a
bottom sheet with: price range slider, in-stock toggle, and sort options (radio buttons).

**Task 4.3 — Show ratings on shop cards**
Ratings are already being collected in the database but never displayed. On every shop card in the
app (home screen, category browse, search results, shop detail header), show the shop's average
rating as a star icon with the numeric value (e.g., ★ 4.3) and the total review count in brackets
(e.g., (28 reviews)). If a shop has fewer than 5 ratings, show "New" instead of a star rating.

**Task 4.4 — Show ratings on product cards**
Similarly, show product ratings on product cards where available. If a product has ratings, show
a small star + number below the product price. On the PDP built in Chunk 1, show the full rating
breakdown (5-star bar chart) and the most recent 3 written reviews.

**Task 4.5 — Post-order rating prompt**
After an order reaches status `DELIVERED`, send the customer a push notification: "How was your
order from [Shop Name]? Rate it in 2 taps." Tapping the notification opens a rating screen in
the app where the customer can give a star rating (1–5) and an optional text review for the
shop and for individual products in the order.

The rating submission must be validated: only customers who have a `DELIVERED` order from that
shop can submit a rating for that shop.

**Acceptance criteria for Chunk 4:**
- Search returns filtered, sorted results when filter parameters are passed
- Filter chips and bottom sheet filter UI work on the search screen
- Shop cards throughout the app show ★ rating and review count (or "New")
- Post-delivery push notification triggers for every delivered order
- Rating screen opens and submits successfully
- Submitted ratings update the shop's and product's average rating in real-time

---

## CHUNK 5 — Rider Dispatch & Auto-Assignment

**Goal:** Build the system that assigns orders to riders automatically, and add basic order
batching so a rider can carry 2–3 orders per trip. This is critical for rider efficiency —
without it, founders must manually dispatch every order.

### Background:
Chirawa is divided into 6 zones for delivery efficiency. Each zone has one or more riders
assigned to it. When an order comes in, it should go to the nearest available rider in the
correct zone. Order batching means: if 2 orders come in within the same zone within a
10-minute window, they get grouped and sent to the same rider as a single trip.

**Task 5.1 — Zone configuration in database**
Create a `Zone` model in Prisma: id, name (e.g., "Main Market Zone"), polygon coordinates
(array of lat/lng points defining the zone boundary), and isActive. Create a `RiderZone`
junction table linking riders to their primary zone. Seed the 6 Chirawa zones:

- Zone 1: Main Market / Central (around the main bazaar)
- Zone 2: Station Road area
- Zone 3: North residential (behind bus stand)
- Zone 4: South residential
- Zone 5: East (towards highway side)
- Zone 6: West outskirts

The coordinates for each zone should be approximate Chirawa boundaries — the founding team
should review and adjust these after the first week of operations based on real experience.

**Task 5.2 — Rider availability system**
Add an `isAvailable` boolean field to the Rider model (default true). Add a toggle in the rider
app home screen: "Go Online / Go Offline." When a rider goes offline, no orders are assigned to
them. The rider's current location (last known lat/lng) and availability status must be stored
in Redis (not the database) for fast lookup — database should only log significant status changes.

**Task 5.3 — Auto-assignment logic (BullMQ worker)**
Create a BullMQ worker called `OrderAssignmentWorker`. When an order is confirmed (status:
`CONFIRMED`), this worker runs:

1. Determine which zone the delivery address falls in (point-in-polygon check).
2. Find all online riders assigned to that zone.
3. If no rider in that zone is available, expand search to adjacent zones.
4. Among available riders, find the one with the fewest active deliveries currently assigned.
5. Assign the order to that rider by updating the order's `riderId` and status to `ASSIGNED`.
6. Send a push notification to the assigned rider with order details.
7. If no rider is available at all after 3 minutes, send an alert to the admin phone number
   via SMS and flag the order as `PENDING_RIDER`.

If assignment fails, retry every 60 seconds for up to 10 minutes before escalating.

**Task 5.4 — Basic order batching**
Extend the `OrderAssignmentWorker` with batching logic:

When an order comes in for Zone X, before immediately assigning it, wait up to 3 minutes (a
configurable delay stored in the constants file). During this window, check if any other orders
for Zone X have arrived. If yes, and if they are geographically close (within 800m of each other),
create a `Batch` record linking these orders together and assign the whole batch to one rider.

A batch should not exceed 3 orders. If a 4th order arrives for the same zone within the window,
start a new batch.

The rider app must display a batched delivery clearly: "3 orders — pick up from 2 shops, deliver
to 3 addresses." The pickup and drop-off sequence should be optimised to minimise total travel
distance (nearest-shop-first logic is sufficient for Chirawa's 3 km radius — no need for complex
routing algorithms).

**Task 5.5 — Rider app: batch delivery screen**
Update the rider app's delivery screen to handle batch deliveries:
- Show a list of pickups: each shop name, address, and the items to collect
- Show a list of drop-offs: each customer name, address, and their items
- Status buttons: "Picked up from [Shop Name]" for each pickup, "Delivered to [Customer Name]"
  for each drop-off
- Each status update triggers the order tracking update for the relevant customer
- Rider cannot mark a delivery complete if they haven't marked all pickups complete first

**Task 5.6 — Dispatch dashboard for admin (minimal)**
Create a simple real-time admin view (can be a web endpoint returning JSON initially) showing:
- All active orders and their current status
- All online riders and their current assignment
- Any unassigned orders flagged in red

This does not need a full UI in Chunk 5 — a clean JSON endpoint is enough. The full admin UI
is built in Chunk 9.

**Acceptance criteria for Chunk 5:**
- Rider can toggle online/offline in rider app
- When an order is confirmed, it is automatically assigned to the nearest available rider
  within 3 minutes
- Assigned rider receives a push notification
- If 2 orders come in for the same zone within 3 minutes, they are batched to one rider
- Rider app shows batch delivery with correct pickup and drop-off sequence
- Each pickup/delivery step can be individually marked complete
- Order tracking status updates in customer app at each rider step

---

## CHUNK 6 — Live Map Tracking

**Goal:** Replace the text badge ("Rider is on the way") with a real live map in the customer
app showing the rider's moving location. This is a major trust-builder.

### Tasks:

**Task 6.1 — Rider location streaming (backend)**
The rider app already sends location updates to the backend via Socket.io. Verify this is working
correctly. The backend must:
- Accept location updates from the rider's socket connection every 5 seconds while they have
  an active delivery
- Store the latest location in Redis (key: `rider:{riderId}:location`, value: `{lat, lng, timestamp}`)
- Broadcast the location to the customer's socket room (room: `order:{orderId}`) so the
  customer app receives updates in real-time without polling

**Task 6.2 — Customer app: replace text badge with map**
On the order tracking screen, replace the rider status text badge with a full-screen (or
half-screen) map view:
- The map shows the customer's delivery pin (static, green marker)
- The rider's current location (moving marker — a scooter or delivery icon)
- The rider marker moves in real-time as location updates arrive via Socket.io
- Below the map, show the order status timeline (Order Placed → Picked Up → Out for Delivery →
  Delivered) as a vertical step list
- Show an estimated time: "Arriving in ~X minutes" calculated from rider's current distance
  to delivery pin at an assumed 20 km/h average speed in Chirawa

**Task 6.3 — Fallback when rider location is unavailable**
If the rider's location has not been updated in the last 60 seconds (e.g., app closed or no
network), show a static message: "Rider is on the way — live location temporarily unavailable."
Do not show a stale location as if it were current.

**Task 6.4 — Rider app: background location permission**
Ensure the rider app correctly requests and handles background location permission on both
Android and iOS. The rider's location must continue to be sent even when the app is in
background. Use Expo Location with foreground service on Android.

**Acceptance criteria for Chunk 6:**
- Customer sees a live map with moving rider location during active delivery
- Map updates smoothly every 5 seconds
- Rider's scooter icon moves realistically across the map
- ETA is shown and updates as the rider moves
- If location is stale, a fallback message is shown (not a frozen marker)
- Background location works on both Android and iOS

---

## CHUNK 7 — Promotions & First-Order Discount

**Goal:** Build the coupons and promotions engine. The first use case is a "Free delivery on
your first order" promo. The engine must be generic enough to support future promotions without
code changes.

### Tasks:

**Task 7.1 — Promotions data model**
Create a `Promotion` model in Prisma with fields: code (unique string), type (enum:
`FREE_DELIVERY` | `FLAT_DISCOUNT` | `PERCENT_DISCOUNT`), value (number — meaning depends on
type), minimumOrderValue, maximumUsesTotal, usesPerCustomer, startDate, endDate, isActive,
and applicableCategories (optional — empty means all categories).

Create a `PromotionUse` table to log which customer used which promotion on which order.

**Task 7.2 — Seed the first-order promotion**
Seed one promotion: code `FIRSTORDER`, type `FREE_DELIVERY`, value 10 (the delivery fee
amount), minimumOrderValue 99, usesPerCustomer 1, no end date, isActive true. This gives
every new customer one free delivery. This code should be applied automatically at checkout
for first-time customers (no need to enter it manually) — detect if the customer has zero
previous orders and auto-apply the code.

**Task 7.3 — Promo code entry in checkout**
Add a "Have a promo code?" input field on the checkout screen. When the customer enters a code
and taps Apply:
- API validates the code (active, not expired, customer hasn't used it before, minimum order
  met)
- If valid: show the discount in the order summary and reduce the total
- If invalid: show a clear inline error (e.g., "Code expired" or "Already used")

**Task 7.4 — Apply promotion at order creation**
Update the order creation API to:
- Accept an optional `promotionCode` field
- Validate the code server-side (never trust client-side validation alone)
- Apply the discount to the final order total
- Record the promotion use in `PromotionUse`
- Include the original delivery fee and discount amount in the order record for accounting

**Task 7.5 — Wire loyalty rewards display**
The loyalty backend (bronze/silver/gold tiers) already exists but is not visible in the customer
app. Wire it up:
- On the customer profile screen, show a loyalty status card: tier name, points balance, and
  progress to the next tier
- After every delivered order, update the customer's loyalty points (1 point per ₹10 spent,
  configurable)
- Tier thresholds: Bronze (0–499 points), Silver (500–1999 points), Gold (2000+ points)
- For now, loyalty points are informational only — no redemption flow yet. Just show them.
  Redemption (e.g., points = delivery credit) can be Phase 2.

**Acceptance criteria for Chunk 7:**
- First-time customers automatically get free delivery (FIRSTORDER code applied without
  them having to enter it)
- Manual promo code entry works for other promotions
- Invalid or expired codes show clear error messages
- Discount is correctly reflected in order total and stored in the order record
- Customer profile screen shows loyalty tier and points balance
- Points increase correctly after each delivered order

---

## CHUNK 8 — Seller Portal Improvements

**Goal:** Make the seller app genuinely useful for daily operations. Sellers need to accept
orders, manage stock, see their sales, and understand what Bringly owes them.

### Tasks:

**Task 8.1 — Real-time order notifications for sellers**
When a new order is assigned to a seller's shop (because it contains items from their shop),
the seller app must receive a push notification AND an in-app sound alert immediately. The
notification must show: customer name, items ordered from their shop, and total value. The
seller must not need to refresh the app to see new orders.

**Task 8.2 — Order accept / reject with reason**
Currently sellers may not have an explicit accept/reject flow. Add this:
- When a new order appears in the seller's order queue, it shows as `PENDING_ACCEPTANCE`
- The seller has a 3-minute window to accept or reject
- Reject requires selecting a reason: "Item out of stock" / "Shop closing early" / "Too busy"
- If the seller does not respond in 3 minutes, the order is auto-accepted (with a count
  tracked so sellers who repeatedly miss responses can be flagged)
- When rejected, the customer is notified and the order is refunded if prepaid

**Task 8.3 — Stock management improvements**
The stock management screen already exists. Improve it:
- Add a "Quick stock update" flow: seller can swipe left on any product to toggle it
  in-stock / out-of-stock without entering the full edit screen
- When a product goes out of stock, it must immediately stop appearing as available in the
  customer app catalog for that shop
- Add a low stock alert: if a product's stock quantity falls below 5 units (if quantity
  tracking is enabled), show a warning badge in the seller app

**Task 8.4 — Sales summary for sellers**
On the seller app's home screen, add a simple daily summary card:
- Today's orders: count and total value
- This week's orders: count and total value
- This month's orders: count and total value
- Best-selling product this week

This data comes from a dedicated seller analytics endpoint that filters orders by shopId and
date range.

**Task 8.5 — Settlement tracking**
Create a `Settlement` model in Prisma: id, shopId, periodStart, periodEnd, totalOrdersValue,
commissionDeducted (0 for all shops currently), amountPayable, status (PENDING / PAID),
paidAt, paymentMethod, transactionReference.

Create an endpoint that generates a weekly settlement summary per shop (Monday to Sunday).
In the seller app's settlement screen, show the last 8 weeks of settlements with amounts and
status. The current week shows a running total.

Note: Commission is currently 0% for all shops. The commissionDeducted field should always
calculate as 0 until the admin manually sets a commission rate for Chirawa Special shops
via the admin panel (Chunk 9).

**Acceptance criteria for Chunk 8:**
- Seller receives real-time push notification when a new order arrives for their shop
- Seller can accept or reject an order within the 3-minute window
- Rejected orders trigger customer notification and refund
- Toggling a product out-of-stock immediately removes it from customer-facing catalog
- Seller can see daily / weekly / monthly sales summary in the app
- Settlement screen shows weekly summaries with correct totals

---

## CHUNK 9 — Admin Dashboard

**Goal:** Build a web-based admin dashboard that gives the two founders full visibility and
control over the Bringly operation in Chirawa. This is a web app (not mobile) since the
founders will use it from a laptop.

### Implementation note:
Build this as a simple, clean web dashboard using React (can be a new `apps/admin` package
in the monorepo). It should call the existing Fastify API using admin-auth JWT tokens. Design
should be functional and clear — not beautiful, just usable. Use a component library like
shadcn/ui or simple Tailwind to avoid spending time on styling.

### Tasks:

**Task 9.1 — Admin authentication**
The admin module already exists in the API. Ensure it has a secure login endpoint
(`POST /api/admin/login`) with email + password (bcrypt-hashed). Create the first admin account
via a seed script. Admin JWT tokens should have a separate secret from customer tokens and a
24-hour expiry. All admin routes must be protected.

**Task 9.2 — Live operations view**
The main page of the admin dashboard shows the current operational state:
- A table of all orders from the last 24 hours, sortable by status and time
- For each order: order ID, customer name, shop(s), total, status, assigned rider, and time
- Orders in `PENDING_RIDER` (unassigned) shown in red with a manual assign button
- A rider status sidebar: all riders, their current status (online/offline), zone, and number
  of active orders
- Auto-refreshes every 30 seconds

**Task 9.3 — Order management**
Admin must be able to:
- View full order details (items, customer address, payment method, timeline of status changes)
- Manually assign an unassigned order to a specific rider
- Cancel an order and trigger refund if prepaid
- Mark an order as delivered manually (for edge cases)

**Task 9.4 — Rider management**
Admin can:
- View all registered riders with their contact details, zone, and total orders delivered
- Add or deactivate a rider account
- Change a rider's assigned zone
- View a rider's earnings for the current week

**Task 9.5 — Seller management**
Admin can:
- View all registered shops with their owner contact, category, and status (active/inactive)
- Set a shop's commission rate (this is how the 13% Chirawa Special commission will be activated
  — admin taps the shop, enters 0.13 in the commission rate field, saves)
- Deactivate a shop (removes it from customer app immediately)
- View a shop's order history and settlement history

**Task 9.6 — Financial overview**
A "Financials" page showing:
- Daily revenue chart: delivery fees + commission for the last 30 days
- Total GMV (gross merchandise value) this month
- Number of orders this month, this week, today
- Average order value
- Top 5 shops by GMV this month
- Delivery fee total vs commission total breakdown

**Task 9.7 — Promotion management**
Admin can:
- View all promotions and their usage stats (how many times used, total discount given)
- Create a new promotion (fill in the Promotion fields from Chunk 7)
- Deactivate a promotion

**Acceptance criteria for Chunk 9:**
- Admin login works with email + password
- Live operations view shows all recent orders and rider statuses
- Admin can manually assign a PENDING_RIDER order to a specific rider
- Admin can set Chirawa Special shop commission to 13% from the seller management screen
- Financial overview shows correct daily revenue for the last 30 days
- Admin can create and deactivate promotions

---

## CHUNK 10 — Analytics & Crash Reporting

**Goal:** Add observability to the production app so the team knows what's breaking and how
customers are actually using the app.

### Tasks:

**Task 10.1 — Sentry crash reporting (all 3 apps + backend)**
Install Sentry in the customer app, seller app, rider app, and the Fastify backend. Configure:
- Error boundary in all React Native apps so crashes are caught and reported rather than
  silently disappearing
- Source maps uploaded for all Expo builds so stack traces are readable
- Sentry alerts: any new error type should trigger a Sentry notification immediately
- The Fastify backend should log all unhandled errors to Sentry with request context
- Sentry free tier is sufficient for launch volume

**Task 10.2 — Key event tracking (customer app)**
Install PostHog (self-hosted on your own server is free) or use Mixpanel free tier. Track
these events in the customer app:

Acquisition events: `app_open`, `otp_requested`, `otp_verified`, `profile_completed`
Browse events: `home_viewed`, `category_browsed`, `shop_viewed`, `product_viewed` (with
product and shop IDs)
Conversion events: `add_to_cart`, `cart_viewed`, `checkout_started`, `checkout_completed`
(with payment method), `order_placed`
Retention events: `reorder_tapped`, `search_performed` (with query), `rating_submitted`
Support events: `order_cancelled`, `refund_requested`

These events are used to calculate the funnel: how many users who open the app actually place
an order, and how many who place one order come back for a second.

**Task 10.3 — Backend API performance logging**
Add request logging to the Fastify backend using the built-in Fastify logger or Pino. Log:
- All API endpoints hit with response time in milliseconds
- Any request taking longer than 2 seconds flagged as a warning
- Database query times (Prisma has query logging support)

Log output should be structured JSON suitable for a log aggregator. For early launch, simply
writing to files and reviewing manually is fine.

**Task 10.4 — Weekly metrics email to founders**
Create a cron job (using BullMQ scheduled jobs) that runs every Monday at 8 AM and sends an
email to both founders with the previous week's key metrics:
- Total orders and GMV
- New customers vs returning customers
- Most ordered products and shops
- Rider utilisation rate (average orders per rider per day)
- Any orders that were cancelled or had issues

This can use any transactional email service (Resend, SendGrid free tier, or Nodemailer
with Gmail).

**Acceptance criteria for Chunk 10:**
- Sentry dashboard shows errors from all 3 apps and the backend
- A test crash in the customer app appears in Sentry within 60 seconds
- PostHog or equivalent shows the conversion funnel from app_open to order_placed
- API request logs show response times for all endpoints
- Weekly metrics email sends correctly on Monday morning

---

## CHUNK 11 — Production Deployment

**Goal:** Deploy the entire Bringly stack to a production server and make it accessible
via a proper domain. Both founders must be able to deploy a new version confidently.

### Infrastructure choice:
Use a single Hetzner Cloud server (CX21: 2 vCPU, 4GB RAM, 40GB SSD — approximately ₹1,200/month)
running Ubuntu 22.04. This is sufficient for up to 500 orders/day. Docker Compose manages all
services on one machine. This is simple to manage for a two-person team and can be scaled later
if needed.

### Tasks:

**Task 11.1 — Dockerise the backend**
Create a `Dockerfile` for the Fastify API and a `docker-compose.yml` at the root that
orchestrates:
- `api`: the Fastify backend
- `postgres`: PostgreSQL database with a named volume for data persistence
- `redis`: Redis instance
- `worker`: the BullMQ worker process (separate container from the API)
- `nginx`: reverse proxy handling SSL termination and routing

Each service must have proper health checks and restart policies (`restart: unless-stopped`).
Sensitive values (database password, JWT secret, Razorpay keys) must come from environment
variables, never hardcoded in the compose file.

**Task 11.2 — Database backup automation**
Create a script that runs daily at 3 AM (via cron) to:
- Run `pg_dump` on the PostgreSQL database
- Compress the dump
- Upload it to an S3 bucket or Backblaze B2 (very cheap)
- Keep the last 30 backups and delete older ones

The founding team must test a full restore from backup before going live.

**Task 11.3 — Nginx configuration**
Configure Nginx as a reverse proxy:
- `api.bringly.in` (or your actual domain) routes to the Fastify API on port 3000
- SSL certificate from Let's Encrypt via Certbot (free)
- HTTP to HTTPS redirect
- WebSocket upgrade headers correctly set for Socket.io
- Rate limiting: max 100 requests per minute per IP on API routes to prevent abuse

**Task 11.4 — EAS production builds for all 3 apps**
Configure Expo Application Services (EAS) for production builds:
- Create `eas.json` with `production` build profile for Android (APK or AAB) and iOS
- Production builds must use production API URL (`https://api.bringly.in`)
- App icons and splash screens must be finalised before building
- For the Chirawa launch, Android APK distributed directly via WhatsApp (no Play Store
  needed immediately) — this removes Play Store review delays and is common for early
  hyperlocal apps in India
- Customer app, Seller app, and Rider app each need their own build

**Task 11.5 — Zero-downtime deployment script**
Create a `deploy.sh` script that:
- Pulls the latest code from the main branch on GitHub
- Runs `pnpm install`
- Runs Prisma migrations (`prisma migrate deploy` — non-interactive)
- Rebuilds Docker containers
- Uses `docker-compose up -d --no-deps --build api worker` to restart only changed
  services without downtime
- Sends a Slack or WhatsApp message to the founders confirming successful deployment

**Task 11.6 — Production environment variables**
Create a production `.env` file on the server (not committed to git). Document every variable
in the `.env.example` from Chunk 0. The production `.env` includes:
- Real Razorpay production keys (not test keys)
- Real FCM credentials
- Real SMS API key
- Strong JWT secrets (minimum 64-character random strings)
- Production database credentials
- Sentry DSN for each app

**Task 11.7 — Launch checklist verification**
Before going live, verify every item in the Launch Checklist at the end of this document.

**Acceptance criteria for Chunk 11:**
- All services start correctly with `docker-compose up -d`
- API is accessible at `https://api.bringly.in` with a valid SSL certificate
- WebSocket (Socket.io) connections work through the Nginx proxy
- A full end-to-end test order can be placed on a real Android device using the production APK
- Database backup runs successfully and a test restore works
- `deploy.sh` deploys a code change without downtime

---

## 7. Standing Business Rules (Reference for Every Chunk)

When Claude Code is working on any Chunk, these rules must always be respected:

| Rule | Value | Notes |
|------|-------|-------|
| Delivery fee | ₹10 flat | No exceptions, no distance logic |
| Minimum order | ₹99 | Hard block at checkout |
| Operating hours | 8:00 AM – 9:00 PM IST | Block orders outside these hours |
| Commission (regular shops) | 0% | Will be changed manually via admin |
| Commission (Chirawa Special) | 0% now → 13% later | Set via admin panel, not code |
| Payment methods | COD + UPI (Razorpay) | UPI is priority; COD always available |
| Language | English + Hindi | All new strings must have both |
| Geography | Chirawa only | 5 km from centre boundary check |
| Refunds | Auto-trigger for prepaid cancellations | Manual for COD (not applicable) |
| Analytics events | Track every key action | Never skip instrumentation |
| Crash reporting | Sentry in all 4 codebases | Non-negotiable before launch |

---

## 8. Launch Readiness Checklist

Complete every item before the first real customer order:

**Business rules:**
- [ ] Delivery fee is ₹10 flat on all test orders
- [ ] Cart below ₹99 blocks checkout with a clear message
- [ ] Orders placed at 9:01 PM are rejected with an operating hours message
- [ ] First-order coupon (FIRSTORDER) applies automatically for new customers

**Payments:**
- [ ] UPI payment completes successfully on a real device with a real ₹1 test order
- [ ] Razorpay is in production mode (not test mode)
- [ ] Failed payment shows correct error message and order stays as PAYMENT_PENDING
- [ ] Cancelled prepaid order triggers automatic refund within 60 seconds

**Rider operations:**
- [ ] Rider can go online and offline from the rider app
- [ ] A confirmed order is auto-assigned to an online rider within 3 minutes
- [ ] Rider receives push notification when assigned
- [ ] Customer sees live map with rider location
- [ ] Order status updates (Picked Up, Out for Delivery, Delivered) update in real-time

**Seller operations:**
- [ ] Seller receives push notification within 5 seconds of a new order
- [ ] Seller can accept or reject order
- [ ] Rejected order triggers customer notification and refund
- [ ] Out-of-stock toggle immediately removes product from customer catalog

**Images and catalog:**
- [ ] All 10 seeded shops have real cover images uploaded
- [ ] All 60 seeded products have real images uploaded
- [ ] PDP screen works for all products
- [ ] Chirawa Special carousel shows correct shops on home screen

**Infrastructure:**
- [ ] SSL certificate valid (HTTPS working on API)
- [ ] WebSocket connections stable (test tracking screen for 10 minutes)
- [ ] Database backup ran successfully yesterday (verify the file exists)
- [ ] Sentry shows test error from each app
- [ ] Server memory usage under 70% with all services running

**Address and location:**
- [ ] GPS address pin works on Android
- [ ] Address outside 5 km is rejected
- [ ] Rider app shows customer pin on map

**Final end-to-end test:**
- [ ] Place a UPI order on customer app → seller accepts → rider assigned → rider picks up →
      rider delivers → order marked delivered → rating prompt appears → rating submitted
- [ ] Place a COD order through the same flow
- [ ] Check admin dashboard shows both orders with correct revenue figures

---

## 9. Things Claude Code Must Never Break

When working on any Chunk, the following must remain working:

- Multi-shop cart (customer adding items from different shops in one order)
- OTP authentication flow (customer, seller, rider)
- Hindi language strings (do not remove i18n keys — add new ones for new features)
- Dark mode (all new screens and components must respect the dark mode theme)
- Reorder flow (customer tapping "Reorder" on a past order)
- The "List Your Shop" WhatsApp lead screen
- BullMQ worker process (do not break the queue setup when adding new workers)
- Existing Prisma schema relationships (adding fields is fine, removing is not)

---

## 10. Development Notes for Claude Code

**Monorepo commands:**
- `pnpm install` at root installs all workspace dependencies
- `pnpm --filter api dev` starts the backend
- `pnpm --filter customer start` starts the customer app via Expo
- `pnpm --filter api db:migrate` runs Prisma migrations
- `pnpm --filter api db:seed` runs the seed file

**When adding new Prisma models:**
Always run `pnpm --filter api db:generate` after schema changes to regenerate the Prisma client.
For production, use `prisma migrate deploy` (not `migrate dev`).

**Socket.io rooms convention:**
- Order tracking room: `order:{orderId}`
- Rider location room: `rider:{riderId}`
- Admin operations room: `admin:ops`

**BullMQ queues naming convention:**
- `order-assignment` — for Chunk 5 auto-assign worker
- `notifications` — existing notification queue
- `settlements` — for weekly settlement generation (Chunk 8)
- `analytics` — for weekly metrics email (Chunk 10)

**Error code convention (established in Chunk 0):**
Use `SCREAMING_SNAKE_CASE` error codes. Examples: `CART_BELOW_MINIMUM`, `SHOP_CLOSED`,
`INVALID_PROMO_CODE`, `RIDER_NOT_AVAILABLE`, `PAYMENT_VERIFICATION_FAILED`.

**Image URLs:**
Store full Cloudinary or S3 URLs in the database. Never store relative paths or local
filesystem paths. In development, use real placeholder image URLs from Unsplash
(category-appropriate) so the UI looks realistic during testing.

---

*This document is the single source of truth for the Bringly production build.
Last updated: June 2026. Questions or decisions not covered here should be raised with
the founding team before proceeding.*
