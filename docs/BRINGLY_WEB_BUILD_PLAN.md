# Bringly Web — Build Plan & Task Backlog

> Single source of truth for building **`apps/web`** (customer storefront) in this pnpm monorepo.
> Work **ONE task at a time, in order**. After each task: verify, report, wait for confirmation,
> then tick its box in the checklist below.

---

## 0. Builder protocol (read first)

1. **Before writing any code**, read the ground-truth files in §2. Never guess an API shape — reuse `@chirawa/*`.
2. **One task per turn.** Implement exactly one numbered task from §7, then **STOP** and report:
   - what you created/changed, (b) each acceptance criterion + pass/fail, (c) how to verify manually.
   Wait for "continue"/"next" before starting the following task.
3. **Verification gate:** web-only tasks → `pnpm --filter @chirawa/web typecheck`. Tasks touching a shared package (`packages/*`) → `pnpm --filter='!@chirawa/api' -r typecheck` (checks web + all 3 RN apps; `apps/api` is pre-broken on this branch and excluded). Plus `next build` where a task says so, and the task's own "Verify" steps. See [[web-typecheck-gate-reality]].
4. **On pass**, tick the task's box in §7 and add a one-line note (what shipped / commit ref).
5. **Backend is off-limits** except **Task 16**. If you touch `apps/api`, follow `apps/api/CLAUDE.md` (consult Context7 for the pinned lib version first).
6. **If blocked or ambiguous** (e.g. the S3 image host, §8), ask — do not guess.

---

## 1. Scope & non-negotiables

- **Product:** a full customer ordering storefront mirroring `apps/customer-app`: browse shops/products → search → cart → phone-OTP login → place order → live tracking.
- **Payment: CASH ON DELIVERY ONLY.** Checkout sends `paymentMethod: 'cod'` to `POST /orders` and receives the order directly. **No Razorpay, no web payment SDK, no payment-verify, and NO UI referencing cards/UPI/wallets/online payment anywhere.** After a successful COD order → straight to tracking.
- **Brand:** customer-facing name is **Bringly** (infra/domain is "Chirawa" / `chirawa.in`).
- **Auth model (decided):** **httpOnly cookies + a same-origin Next BFF.** Tokens never touch JS.
- **Cart model (decided):** **guest cart in localStorage**, replayed into the server cart on login.
- **Reuse:** `@chirawa/api-client`, `@chirawa/types`, `@chirawa/i18n`. Do not re-implement API calls or DTOs.
- **Excluded for launch:** wallet, loyalty, referral, seller/rider surfaces, and all online-payment UI.

---

## 2. Ground truth (repo facts you must build on)

### `packages/api-client/src/index.ts` — the backend client
- Framework-agnostic (`fetch`, no RN/DOM). Auth is mediated by two injected seams:
  - `TokenStorage = { getAccessToken, getRefreshToken, setTokens, clearTokens }` (all async).
  - `onAuthFailure: (() => void) | null` — fired after refresh fails / retry still 401.
- **Built-in 401 handling:** reads `getRefreshToken()` → `POST /auth/refresh` → `setTokens()` → retries once; on failure `clearTokens()` + `onAuthFailure()`.
- Public reads pass `requiresAuth=false` (catalog, search, `send-otp`, `verify-otp`, `refresh`). `baseUrl` **includes `/api/v1`**.
- **Catalog list/detail methods return `unknown`** (no DTOs yet) — you must add typed shapes (Task 3). Cart/order/auth/pricing/address/geo/search **are** typed.

### Endpoints & methods (auth = requires JWT)
| Area | Method(s) | Path | Auth |
|---|---|---|---|
| Auth | `sendOtp` | `POST /auth/send-otp` | public |
| Auth | `verifyOtp` | `POST /auth/verify-otp` | public |
| Auth | `logout` | `POST /auth/logout` | auth |
| Catalog | `getShops/getShop/getProducts/getProduct` | `GET /catalog/...` | public |
| Catalog | `getFeed/getDailyEssentials/getSpecials/getCategories/getBestsellers/getCategoryImages` | `GET /catalog/...` | public |
| Search | `search/suggest` | `GET /search`, `/search/suggest` | public |
| Cart | `getCart/addToCart/updateCartItem/clearCart` | `/cart`, `/cart/items...` | auth |
| Geo | `reverseGeocode/autocompletePlaces/placeDetails` | `POST /geo/reverse|autocomplete|place` | **auth** |
| Pricing | `getPricingPreview` | `POST /pricing/preview` | auth |
| Addresses | `get/create/update/delete/setDefaultAddress` | `/users/me/addresses...` | auth |
| Orders | `placeOrder` | `POST /orders` | auth |
| Orders | `getOrder/getMyOrders/getOrderGroup/cancelOrder/rateOrder/updateOrderAddress/updateOrderReceiver` | `/orders...` | auth |
| Delivery | `getRiderLocation` | `GET /delivery/orders/:id/rider-location` | auth |

### DTOs to reuse (`@chirawa/types`)
`AuthTokens`, `SendOtp*`, `VerifyOtpResponse` (`{ tokens, isNewUser, requiresPin, role }`), `CartResponse`/`CartItem`/`AddToCartRequest`, `PlaceOrderRequest` (`{ cartId, addressId, paymentMethod, promoCode?, useWalletCredit? }`), `PlaceOrderResponse` (`{ orderId, orderIds?, groupId?, shops?, status, totalAmount }`), `OrderDetailResponse`, `OrderStatus` (enum), `PaymentMethod` (enum — **use `COD` only**), `PricingPreviewRequest/Response` (`breakdownText` is Hindi), `AddressResponse`/`CreateAddressRequest`, `ReverseGeocodeResult`/`PlacePrediction`/`PlaceDetailsResult`, `SearchResponse`/`SearchFilters`/`SearchSuggestResponse`, `Paise` (money is **paise**; display `paise/100` as ₹).

### Auth specifics
- `verify-otp` → access JWT (15m) + opaque refresh (7d). **JWT payload has `sub` (userId) + `role`** — decode server-side for the session probe. **There is no `/users/me`.**
- 10-digit Indian phone. **Dev OTP bypass: `123456`** (any seeded customer).
- For `customer` role, `requiresPin` is false (PIN is seller/rider only).

### COD order (`apps/api/.../orders.routes.ts:30-37`)
- `paymentMethod !== 'cod'` → Razorpay branch. **`paymentMethod === 'cod'` → returns the created order directly (201).** Send an `Idempotency-Key` header (double-tap protection).

### Realtime tracking (`OrderTrackingScreen.tsx`)
- `SOCKET_URL` = backend origin (**no `/api/v1`**). Connect: `io(SOCKET_URL, { auth: { token }, transports: ['websocket'] })`.
- On connect: `socket.emit('order:subscribe', orderId)`. On cleanup: `emit('order:unsubscribe', orderId)`.
- Listen: `order:status {orderId,status}`, `order:location {orderId,lat,lng}`, `order:eta {orderId,secondsRemaining,spreadSeconds,serverNow,source}`, `order:item-unavailable {orderId,productName,refundedPaise,cancelled,suggestion?}`.
- Fallbacks: 15s poll via `getOrder`; initial `getRiderLocation`.

### Theme (`apps/customer-app/src/theme/index.ts`)
Port tokens verbatim. Key values: primary `#FF6B35`, primaryLight `#FFF0E9`, page bg `#FFF5EE` (warm cream), surface `#FFF`, text `#1A1A2E`/`#6B7280`, success `#00C48C`, border `#F0E0D6`, special accent `#C4383A`. `Radius` xs4→xxl32/full999, `Spacing` 2→48, `FontSize` xs12→hero38, `FontWeight` 400–900. **Hindi-default** (`language: 'hi'`).

### i18n (`packages/i18n`)
`translations.ts` is pure en/hi data (reusable). **`LanguageContext.tsx` imports `@react-native-async-storage/async-storage` (RN-only)** and `useT` depends on it → refactor needed (Task 2) so web reuses `translations` without pulling RN.

### Cart
The server cart (`getCart`/`addToCart`) is **auth-required**; the mobile app has no guest cart. The web guest cart (localStorage) is a deliberate web addition, synced to the server on login.

---

## 3. Stack
Next.js 15 App Router + React 19 + TypeScript · Tailwind (ported theme tokens) · TanStack Query (client/authed data via BFF) + RSC `fetch` (SSR browse) · `socket.io-client` (root dep) · `@chirawa/{api-client,types,i18n}`. Node ≥20.

---

## 4. Architecture spec

### Folder layout
```
apps/web/
  next.config.mjs      # transpilePackages:[@chirawa/*]; images.remotePatterns:[S3 host]
  middleware.ts        # gated routes → /login?next= when no auth cookie
  .env.example         # BACKEND_ORIGIN, BACKEND_API_BASE, SOCKET_URL, COOKIE_* flags
  src/
    app/
      layout.tsx                        # Providers: Query, Language, Location, GuestCart
      page.tsx                          # Home            (ISR)
      shop/[shopId]/page.tsx            # Shop            (ISR + metadata + staticParams)
      product/[productId]/page.tsx      # Product         (ISR + metadata + JSON-LD)
      category/[slug]/page.tsx          # Category        (ISR)
      search/page.tsx                   # Search          (CSR, noindex)
      cart/page.tsx                     # Cart            (CSR, guest)
      login/page.tsx                    # OTP             (CSR)
      checkout/page.tsx                 # COD checkout    (CSR, gated)
      order/[orderId]/page.tsx          # Confirm + track (CSR, gated)
      orders/page.tsx                   # History         (CSR, gated)
      account/**                        # Profile/address (CSR, gated)
      api/
        bff/[...path]/route.ts          # generic proxy: Bearer-from-cookie + refresh-on-401
        auth/verify-otp/route.ts        # serverApi.verifyOtp → Set-Cookie httpOnly
        auth/logout/route.ts            # backend logout + clear cookies
        auth/session/route.ts           # decode JWT from cookie → {authed,userId,role}
        auth/socket-token/route.ts      # return access token for the socket handshake
    lib/api/{server.ts,browser.ts,cookies.ts}
    lib/{catalog-types.ts,serviceArea.ts,format.ts,query.ts}
    components/{ui,layout,product,cart,location,tracking,home,search,checkout}/
    context/{GuestCartContext,LocationContext,AuthState}.tsx
    i18n/{provider.tsx}
```

### Data-fetching
- **SSR/ISR (RSC):** `serverApi.*` directly (public catalog needs no token). `export const revalidate = ...`.
- **Interactive/authed (client):** TanStack Query → `browserApi.*` → `/api/bff/...` (same-origin, cookies auto-attach).

### Auth flow
1. `/login` phone → `browserApi.sendOtp`.
2. otp → `POST /api/auth/verify-otp` → `serverApi.verifyOtp()` sets httpOnly `bl_at`(15m)/`bl_rt`(7d); body returns only `{ isNewUser, role }`.
3. On success → **replay guest cart** (localStorage → `addToCart` each → `getCart` reconcile → clear local) → redirect to `next` or `/`.
4. Header state via `GET /api/auth/session` (decodes JWT server-side).
5. `browserApi.onAuthFailure` → `/login`. Logout → `POST /api/auth/logout`.

### api-client mapping (the injected seams)
| Seam | serverApi (RSC + handlers) | browserApi (client) |
|---|---|---|
| baseUrl | `BACKEND_API_BASE` | `/api/bff` |
| getAccessToken / getRefreshToken | read `bl_at` / `bl_rt` cookie | `null` (BFF injects/refreshes) |
| setTokens / clearTokens | write / delete httpOnly cookies | no-op / `POST /api/auth/logout` |
| onAuthFailure | clear cookies | redirect `/login` |

Refresh runs **server-side** in the BFF (reads `bl_rt` → `/auth/refresh` → rotate cookies → retry once). Because the browser only talks to same-origin Next, **no backend REST CORS change is needed**.

---

## 5. UI / design-system spec
- **Brand Bringly**; port tokens (§2) into `tailwind.config.ts`. Warm gradient headers, rounded cards, emoji status, Hindi-default, ₹ pricing, WhatsApp "need help".
- **Pages** mirror app screens: Home (CategoryGrid, Nearby Shops, Daily Essentials shelf, Chirawa Specials, Bestsellers, For-You feed), Shop, Product, Search, Cart, Login, Checkout, Tracking, Orders, Account.
- **Components:** `ui/` Button, Card, Sheet/Modal, Input, OtpInput, QtyStepper, Chip, Skeleton, Toast, EmptyState · `layout/` Header, LocationPill, SearchLauncher, Footer, mobile BottomNav · `product/` ProductCard, PriceBlock, StockBadge · `cart/` CartCapsule, CartLine · `location/` LocationGate · `tracking/` StatusStepper, EtaHero, RiderCard, TrackingMap.
- **Excluded UI:** wallet, loyalty, referral, and any online-payment element.

---

## 6. Rendering map
| Route | Rendering | Auth | Notes |
|---|---|---|---|
| `/` | ISR ~120s | public | town-wide catalog; location/cart hydrate client-side |
| `/shop/[id]` | ISR 60s + staticParams + metadata | public | Store/ItemList JSON-LD |
| `/product/[id]` | ISR 60s + metadata | public | Product JSON-LD; client stock re-check |
| `/category/[slug]`, `/categories` | ISR | public | |
| `/search` | CSR, noindex | public | suggest + filters |
| `/cart` | CSR | guest | localStorage cart |
| `/login` | CSR | — | OTP |
| `/checkout` | CSR | gated | address → pricing preview → COD order |
| `/order/[id]`, `/orders`, `/account/**` | CSR | gated | socket + poll |

`middleware.ts` guards gated routes on cookie presence. Location is a **soft** gate (overlay) so crawlers aren't blocked.

---

## 7. Task backlog

**Status**
- [x] 1 — Scaffold `apps/web` — Next 15 + React 19 + Tailwind v3 (ported theme tokens), QueryClientProvider, Bringly header/footer + static home shell. `typecheck` ✅, dev serves `/` (HTTP 200, cream bg, no errors).
- [x] 2 — Make `@chirawa/i18n` web-safe — headless `core.tsx` (context + `useT`/`useLanguage` + injectable `LanguageStorage` seam, no AsyncStorage); RN `LanguageProvider` rebuilt on it (AsyncStorage seam, API unchanged); new `@chirawa/i18n/core` subpath export; web `provider.tsx` (localStorage+cookie, default `hi`) + `<T>` island wired into layout. Verified: i18n/web/types/api-client + all 3 RN apps `tsc` ✅; async-storage absent from `.next` ✅; Hindi prerendered ✅. (Note: RN apps have no `typecheck` script → `pnpm -r` skips them, checked directly; `apps/api` has pre-existing unrelated `tsc` errors.)
- [x] 3 — Wire api-client + BFF passthrough proxy + catalog types — `serverApi()` (request-scoped, cookie storage) + `browserApi` (singleton, `/api/bff`, no-op storage) + generic `[...path]` proxy (Bearer-from-cookie + refresh-on-401, dormant) + `cookies.ts` + pure `catalog-types.ts` (typed shapes + DI helpers) + `next.config` images (dev host `localhost:3000`; **prod R2 host still pending, plan §8**). Verified vs a mock backend: BFF forwards GET/search/POST + `Idempotency-Key`/`Content-Type`; `serverApi().getShops()` typed OK; typecheck + build ✅.
- [x] 4 — Location gate (client-only serviceability) — `serviceArea.ts` (ported from customer-app geo.ts: centre 28.2403/75.6465, 3 km radius, haversine; pincode allowlist `333026`) + `LocationContext` (GPS/pincode choice → serviceable, persisted to `loc` cookie + localStorage) + soft `LocationGate` overlay + `LocationPill` (wired into Header; reuses i18n `address.*`/`home.location`). Verified: serviceArea logic 8/8; SSR keeps full content with no overlay (soft gate); typecheck + build ✅. (**Neighbour pincodes still to confirm, plan §8**.)
- [x] 5 — Guest cart context + capsule + QtyStepper — pure `cart.ts` (cartKey/addLine/setLineQuantity/totals) + `GuestCartContext` (localStorage `bringly_guest_cart`, count/subtotal/quantities, variant-aware) + `QtyStepper` (ADD ⇄ −/qty/+) + `CartCapsule` (floating → /cart) + `format.ts` (formatPaise ₹/Indian-grouping, discountPercent). Verified: 14/14 logic asserts; typecheck+build ✅.
- [x] 6 — Home (ISR) — `/` static ISR (`revalidate=120`+`fetchCache=force-cache`+token-free `publicServerApi` → stays `○`, not dynamic); 6 sections (CategoryGrid, DailyEssentials, NearbyShops, ChirawaSpecials, Bestsellers, ForYouFeed) as async RSC (per-section try/catch), reusable client `ProductTile` (next/image + guest-cart stepper), `ShopCard`, skeletons. Verified vs mock: all 6 sections + product/shop/category names render server-side (view-source), 7 catalog endpoints fetched, next/image wired, ADD steppers present. (SEO essentials in place; full Lighthouse = manual. **Prod image host still pending, §8**.)
- [x] 7 — Shop page (ISR) — `/shop/[shopId]`: SSG via `generateStaticParams` (6 shops prerendered), `revalidate=60`, metadata (layout title template — no manual "Bringly" suffix), Store+ItemList JSON-LD (`<`-escaped), header (logo/rating/ETA/hours/closed banner), category-grouped grids, featured-shops link rail (web analogue of the app's two-pane rail), UUID guard → clean 404 on junk ids (backend 500s on malformed UUIDs), root `not-found.tsx`. ProductTile extended (PDP link + `inStock` + StockBadge) instead of a separate ProductCard. Verified: typecheck+build ✅, SSR product names ✅, JSON-LD parses ✅, 200/404 matrix ✅. Gotcha: stale `.next` fetch-cache from the Task-6 mock backend leaked `s1` ids into `generateStaticParams` — `rm -rf .next` before building against a different backend.
- [x] 8 — Product page (ISR) — `/product/[productId]`: on-demand ISR (`revalidate=60`, empty `generateStaticParams`), Product JSON-LD (offers/availability/seller, `<`-escaped), Gallery island (thumbs + counter), ProductPurchase island (variant chips, fresh stock/price re-check via TanStack Query `refetchOnMount:'always'` with SSR `initialData`, variant-aware guest-cart stepper, OOS disabled state), highlight chips (unit + typed-narrowed `attributes`), shop link row, replacement row, description, related (same-shop) + also-like (cross-shop, `getProducts limit 7` minus self) grids, PriceBlock component, UUID guard → 404. Verified: typecheck+build ✅, SSR title/JSON-LD/island markup ✅, junk+unknown ids → 404 ✅.
- [x] 9 — Search (CSR) — `/search`: URL as single source of truth (`q`/`category`/`sort`/`inStock`/`min`/`max` — sharable, back-safe), debounced suggest dropdown (≥2 chars, "search for…" row + product rows → PDP), Filters (category chips from `getCategories`, सिर्फ़ उपलब्ध toggle, ₹ min–max, sort select; ₹→paise at the API boundary), ResultsGrid (दुकानें rows + सामान grid with total, empty + error states), `keepPreviousData` + 350ms filter debounce, robots `noindex,follow`, header search pill → `/search`. Verified: typecheck+build ✅, noindex meta ✅, BFF `search?q=atta` → 20/45 + suggest ✅.
- [x] 10 — Cart page (CSR) — `/cart`: CartLine (PDP-linked image/name, stepper, line total, हटाएं), bill card (उप-कुल, डिलीवरी शुल्क "चेकआउट पर तय होगा", कुल), कार्ट साफ़ करें, empty + hydration states, noindex. Proceed → `/login?next=/checkout` (flips to `/checkout` when middleware gating lands in Task 11). Verified: typecheck+build ✅, page renders + noindex ✅ (edits/persistence use the Task-5-verified GuestCartContext).
- [x] B1 (security) — Headers + CSP — `next.config.mjs` `headers()`: strict static CSP (`default-src 'self'`; `script-src 'self' 'unsafe-inline'` — **deliberately not nonce-based**: per-request nonces can't live in ISR-cached HTML and would force every page dynamic; compensating controls = zero third-party scripts, React escaping, `<`-escaped JSON-LD), `img-src` self+data+blob+image-host (+localhost dev), `connect-src` self+socket origin, `frame-ancestors 'none'`, `object-src 'none'`, nosniff, Referrer-Policy, X-Frame-Options DENY, Permissions-Policy (camera/mic/payment/usb off, geolocation self), HSTS+upgrade-insecure-requests prod-only. Plus `robots.ts` (disallow cart/checkout/order/orders/account/login/search/api). Verified: curl -I shows all headers ✅.
- [x] B2 (security) — BFF hardening — `api/bff/[...path]`: method+path **allowlist** (catalog GET, search, cart, pricing/preview, users/me/addresses, orders incl. cancel/rate/delivery-address/receiver, delivery rider-location, geo, auth/send-otp; admin/sellers/payments/loyalty/notifications/catalog-POSTs and auth verify-otp/refresh/logout → 404), forwards `x-forwarded-for`/`x-real-ip` (backend per-IP OTP caps key on the real client, not this server's egress IP), 100 KB body cap → 413, 15 s upstream timeout → 504. Verified: allow/block matrix + 413 ✅.
- [x] 11 + C1 — Auth infra + CSRF + gating — `api/auth/{verify-otp,logout,session,socket-token}` (nodejs, no-store, in-memory rate limits): verify-otp validates phone/OTP shape, **customer-role-only** cookie minting (seller/rider/requiresPin → 403, no cookies), returns only `{isNewUser, role}`; logout revokes backend-side best-effort + always clears; session decodes JWT server-side (no verify needed — httpOnly + backend authz; `stale:true` when only bl_rt); socket-token returns bl_at (same-origin-checked, refresh+rotate when lapsed). `src/middleware.ts` (**must live in src/ with a src layout — root middleware.ts is silently ignored**): Sec-Fetch-Site/Origin check on state-changing `/api/*` → 403, cookie-presence gate on /checkout|/order|/orders|/account → `/login?next=`. Shared libs: `cookie-names.ts` (edge-safe), `refresh.ts`, `jwt.ts`, `rate-limit.ts`, `cartSync.ts` (tolerant per-line replay). AuthProvider in Providers; cart proceed → /checkout. Verified live (dev OTP, new customer auto-created): cookie flags ✅ session ✅ authed BFF cart ✅ 307 gate ✅ evil-origin 403 ✅ socket-token 200/401 ✅ logout ✅.
- [ ] 12 — OTP login UI
- [ ] 13 — COD checkout (gated)
- [ ] 14 — Order confirmation + live tracking (gated)
- [ ] 15 — Orders history + Account/Addresses (gated)
- [ ] 16 — (Backend) Socket.IO CORS allowlist for web origin

---

### Task 1 — Scaffold `apps/web`
**Goal:** Running Next 15 App Router + TS + Tailwind app with theme tokens and base shell.
**Create/touch:** `apps/web/{package.json,next.config.mjs,tsconfig.json,tailwind.config.ts,postcss.config.mjs,.env.example}`, `src/app/{layout.tsx,globals.css,page.tsx}`, `src/lib/query.ts`, `src/components/layout/{Header,Footer}.tsx`, `src/components/ui/{Button,Card}.tsx`.
**Reuse:** none yet. Set `transpilePackages:['@chirawa/api-client','@chirawa/types','@chirawa/i18n']`.
**Notes:** Port tokens from `apps/customer-app/src/theme/index.ts`. Wrap in `QueryClientProvider`. Home = static shell (Bringly header + placeholder sections).
**Acceptance:** `pnpm --filter @chirawa/web dev` serves `/` (Bringly header, cream bg, no console errors); `typecheck` passes.
**Verify:** open `localhost:3000`; run typecheck.

### Task 2 — Make `@chirawa/i18n` web-safe
**Goal:** Reuse `translations` + `useT` on web without bundling `@react-native-async-storage/async-storage`.
**Create/touch:** `packages/i18n/src/*` (inject storage seam / headless core), `apps/web/src/i18n/provider.tsx` (cookie/localStorage-backed), re-export `useT`.
**Reuse:** `@chirawa/i18n` `translations`, `Language`.
**Notes:** Keep the RN `LanguageProvider` default intact (AsyncStorage) so RN apps still compile. Default `'hi'`.
**Acceptance:** web `useT('home.searchPlaceholder')` returns Hindi; `pnpm -r typecheck` passes; no async-storage in the web build graph.
**Verify:** web typecheck + build-graph check; RN `customer-app` typecheck unchanged.

### Task 3 — Wire api-client + BFF passthrough proxy + catalog types
**Goal:** Server + browser api-client instances, a generic same-origin proxy, typed catalog responses, image config.
**Create/touch:** `src/lib/api/{server.ts,browser.ts,cookies.ts}`, `src/app/api/bff/[...path]/route.ts`, `src/lib/catalog-types.ts`, `next.config.mjs` images.
**Reuse:** `@chirawa/api-client` (`ChirawaApiClient`, `TokenStorage`), `@chirawa/types`.
**Notes:** `serverApi` = request-scoped, cookie storage via `next/headers`. `browserApi` = singleton, baseUrl `/api/bff`, no-op storage. Proxy forwards method/body/query + `Content-Type`/`Idempotency-Key`; if `bl_at` present adds Bearer + refreshes on 401 (dormant until cookies exist). Define `catalog-types.ts` shapes. **Confirm the S3/CloudFront host** for `remotePatterns` (§8).
**Acceptance:** `browserApi.search('milk')` works through `/api/bff`; `serverApi.getShops()` works in an RSC; typecheck passes.
**Verify:** devtools `/api/bff/search?q=milk`; log an RSC `getShops()`.

### Task 4 — Location gate (client-only serviceability)
**Goal:** Gate shopping behind a location choice (auto-detect or manual pincode), validated against the service area; persist a `loc` cookie. Soft gate.
**Create/touch:** `src/context/LocationContext.tsx`, `src/components/location/LocationGate.tsx`, `src/components/layout/LocationPill.tsx`, `src/lib/serviceArea.ts`.
**Reuse:** `@chirawa/i18n`. **No geo endpoints** (they require auth).
**Notes:** `serviceArea.ts` = pincode allowlist (`333026` + neighbours) + haversine radius from Chirawa centre. Browser Geolocation → lat/lng → in-radius check. Manual = pincode text. Out-of-area → "coming soon". Full address (autocomplete/map) deferred to checkout.
**Acceptance:** first visit shows gate; in-area sets `loc` + LocationPill; out-of-area shows coming-soon; choice persists.
**Verify:** clear cookies → reload → detect + manual paths; try an out-of-area pincode.

### Task 5 — Guest cart context + capsule + QtyStepper
**Goal:** localStorage cart usable while browsing; floating capsule; steppers. No server calls yet.
**Create/touch:** `src/context/GuestCartContext.tsx`, `src/components/cart/CartCapsule.tsx`, `src/components/ui/QtyStepper.tsx`, `src/lib/format.ts`.
**Reuse:** `@chirawa/types` `CartItem`/`Paise` as a guide.
**Notes:** Persist `{productId,variantId?,quantity,name,imageUrl,shopId?,pricePaise}`; expose `count/subtotalPaise/quantities/addItem/setQuantity`. Mirror the optimistic UX in `CartContext.tsx`. This is what Task 11 replays to the server.
**Acceptance:** add/increment/remove persists across reload; capsule totals correct in ₹.
**Verify:** manipulate via a temp button; reload; inspect localStorage.

### Task 6 — Home (ISR)
**Goal:** SSR home mirroring the app sections, cart-aware, indexable.
**Create/touch:** `src/app/page.tsx` (`revalidate=120`), `src/components/home/*`, skeletons.
**Reuse:** `serverApi.getFeed/getShops/getDailyEssentials/getSpecials/getBestsellers/getCategoryImages/getCategories`; `GuestCartContext`; `next/image`.
**Notes:** RSC fetch server-side; client islands for steppers/capsule. SEO `metadata`.
**Acceptance:** `/` renders sections from live data server-side (view-source shows product names); steppers add to guest cart; Lighthouse SEO ≥95.
**Verify:** view-source; add from a shelf; Lighthouse.

### Task 7 — Shop page (ISR)
**Goal:** Indexable shop storefront + product list.
**Create/touch:** `src/app/shop/[shopId]/page.tsx` (`generateStaticParams`, `generateMetadata`, `revalidate=60`), `src/components/product/{ProductCard,StockBadge}.tsx`.
**Reuse:** `serverApi.getShop(shopId)`; `GuestCartContext`; `next/image`.
**Notes:** Store/ItemList JSON-LD; closed-shop + OOS states.
**Acceptance:** `/shop/<id>` SSR products + metadata + JSON-LD; steppers work; unknown id → 404.
**Verify:** view-source; validate JSON-LD; add-to-cart.

### Task 8 — Product page (ISR)
**Goal:** Indexable PDP with client stock/price re-check before enabling add.
**Create/touch:** `src/app/product/[productId]/page.tsx` (`generateMetadata`, `revalidate=60`), `src/components/product/PriceBlock.tsx`, client AddToCart island.
**Reuse:** `serverApi.getProduct` (SSR) + `browserApi.getProduct` (client revalidate); `GuestCartContext`.
**Notes:** Product JSON-LD; client confirms stock/price before enabling add. No payment hints.
**Acceptance:** `/product/<id>` SSR + metadata + JSON-LD; add disabled if OOS; variants selectable.
**Verify:** view-source; simulate OOS; add a variant.

### Task 9 — Search (CSR)
**Goal:** Interactive search (suggest + results + filters), `noindex`.
**Create/touch:** `src/app/search/page.tsx`, `src/components/search/{SuggestDropdown,ResultsGrid,Filters}.tsx`, `src/hooks/useDebounce.ts`.
**Reuse:** `browserApi.suggest/search`; `@chirawa/types` `Search*`; `GuestCartContext`.
**Notes:** debounced suggest; filters category/price/inStock/sort; `q` in URL; `robots: noindex`.
**Acceptance:** suggestions on type; results on submit; filters/sort work; add-to-cart from results.
**Verify:** search "milk", filter, add.

### Task 10 — Cart page (CSR)
**Goal:** Review/edit guest cart; proceed to checkout.
**Create/touch:** `src/app/cart/page.tsx`, `src/components/cart/CartLine.tsx`.
**Reuse:** `GuestCartContext`; `format`.
**Notes:** line edit/remove; subtotal; delivery fee shown as "calculated at checkout". "Proceed" → `/login?next=/checkout` if logged out, else `/checkout`.
**Acceptance:** edits update totals + localStorage; empty state; proceed routes to login when logged out.
**Verify:** edit qty, remove, proceed while logged out.

### Task 11 — Auth token infra + BFF cookie minting + login sync
**Goal:** Turn on the httpOnly session: mint/rotate/clear cookies, session probe, socket-token, middleware gate, browserApi authed + onAuthFailure; replay guest cart on login.
**Create/touch:** `src/app/api/auth/{verify-otp,logout,session,socket-token}/route.ts`, activate `src/app/api/bff/[...path]/route.ts` (Bearer+refresh), `middleware.ts`, `src/lib/api/cookies.ts`, `src/context/AuthState.tsx`, `src/lib/cartSync.ts`.
**Reuse:** `serverApi` for `verifyOtp/logout`; `@chirawa/types` auth DTOs; `browserApi`.
**Notes:** `verify-otp` → `serverApi.verifyOtp` writes `bl_at`/`bl_rt` (httpOnly/Secure/SameSite=Lax); returns only `{isNewUser,role}`. `session` decodes JWT (`sub`,`role`). `socket-token` returns `bl_at`. `middleware` redirects gated routes when no cookie. `cartSync`: per guest line `addToCart({productId,quantity,variantId})` → `getCart()` → clear local. `browserApi.onAuthFailure = ()=>redirect('/login')`.
**Acceptance:** after OTP verify, `bl_at`/`bl_rt` are httpOnly (not in `document.cookie`); `/api/auth/session` reports authed; authed `browserApi.getCart()` works via proxy; expired `bl_at` auto-refreshes; guest cart replays.
**Verify:** log in with dev OTP `123456`; inspect cookies/network; confirm merged cart.

### Task 12 — OTP login UI
**Goal:** `/login` phone→OTP wired to auth infra with `next` redirect.
**Create/touch:** `src/app/login/page.tsx`, `src/components/ui/OtpInput.tsx`, optional client-side name capture (receiver name).
**Reuse:** `browserApi.sendOtp`; `POST /api/auth/verify-otp`; `@chirawa/i18n` `auth.*`; `AuthState`.
**Notes:** mirror `OtpLoginScreen`/`VerifyOtpScreen`: 10-digit phone, 6-digit OTP, resend timer (`expiresInSeconds`), wrong-OTP error. On success → cart sync → redirect. No PIN (customer).
**Acceptance:** phone→OTP→session works; wrong OTP errors; resend timer; redirect honors `next`.
**Verify:** log in from `/cart` "proceed"; land on `/checkout`.

### Task 13 — COD checkout (gated)
**Goal:** Address select/add → pricing preview → place **COD** order → confirmation. No payment UI.
**Create/touch:** `src/app/checkout/page.tsx`, `src/components/checkout/{AddressPicker,AddressForm,BillSummary}.tsx`, `src/components/location/AddressAutocomplete.tsx`.
**Reuse:** `browserApi.getAddresses/createAddress`, `autocompletePlaces/placeDetails/reverseGeocode` (authed now), `getPricingPreview`, `placeOrder`; `@chirawa/types` `PlaceOrderRequest`, `PricingPreviewResponse`.
**Notes:** ensure the server cart exists (synced in Task 11/12). Address add uses geo autocomplete (reuse one session-token UUID per search). Preview → show `breakdownText`, fee, discount, total. `placeOrder({cartId,addressId,paymentMethod:'cod'})` with an `Idempotency-Key`. **Omit wallet**; promo optional/hidden. Success → `/order/[orderId]` (or group). Handle `requiresPricingRefresh`.
**Acceptance:** add/select address; bill matches preview; place sends `paymentMethod:'cod'` and returns an order with **no Razorpay fields**; redirect to tracking; double-submit idempotent.
**Verify:** place a COD order (seeded account); confirm 201 + id; re-tap → same order.

### Task 14 — Order confirmation + live tracking (gated)
**Goal:** `/order/[orderId]` confirmation + realtime tracking (socket + poll fallback).
**Create/touch:** `src/app/order/[orderId]/page.tsx`, `src/hooks/useOrderSocket.ts`, `src/components/tracking/{StatusStepper,EtaHero,RiderCard,TrackingMap}.tsx`; handle `groupId`.
**Reuse:** `browserApi.getOrder/getRiderLocation/cancelOrder/rateOrder/updateOrderAddress/updateOrderReceiver/getOrderGroup`; `GET /api/auth/socket-token`; `socket.io-client`; `@chirawa/types` `OrderStatus`.
**Notes:** mirror `OrderTrackingScreen`: fetch socket token → connect → `order:subscribe`; listen `order:status/location/eta/item-unavailable`; 15s poll + initial `getRiderLocation`; 5-phase stepper; COD "pay on delivery ₹X"; cancel pre-pickup; rating on delivered. Map optional (static fallback). **Realtime depends on Task 16**; poll works without it.
**Acceptance:** confirmation shows order + COD amount; status/ETA update live (or via poll); cancel works pre-pickup; rating submits on delivered.
**Verify:** open a placed order; drive a status change from seller/rider app; confirm live/poll update.

### Task 15 — Orders history + Account/Addresses (gated)
**Goal:** Past orders + profile/address management.
**Create/touch:** `src/app/orders/page.tsx`, `src/app/account/page.tsx`, `src/app/account/addresses/page.tsx`.
**Reuse:** `browserApi.getMyOrders`, address CRUD; `AuthState`; logout via `/api/auth/logout`.
**Notes:** orders list → reorder/track links. Account: name/phone (session), language toggle, logout. **Exclude** wallet/loyalty/referral. Addresses reuse Task 13 form.
**Acceptance:** history lists real orders + links to tracking; address add/edit/delete/default work; logout clears cookies → `/`.
**Verify:** view history, edit an address, log out.

### Task 16 — (Backend) Socket.IO CORS allowlist for the web origin
**Goal:** Allow the browser tracking socket to connect cross-origin.
**Justification:** REST is same-origin-proxied (no CORS), but the websocket connects browser→backend directly; without the web origin in the socket CORS allowlist, live tracking can't connect (poll still works).
**Touch:** Socket.IO server CORS in `apps/api` (add the web origin). Per `apps/api/CLAUDE.md`, verify against **Socket.IO v4** via Context7 first.
**Acceptance:** the web tracking socket connects and receives `order:status`; no other backend behavior changes.
**Verify:** watch a live status change arrive over the socket (not the poll).

---

## 8. Flagged gaps / open questions
- **S3/CloudFront image host** for `next/image` `remotePatterns` (Task 3) — confirm before Task 6.
- **Promo-code field at checkout** (Task 13) — defaulted **hidden**; enable only if requested.
- **Serviceability** is client-side (single town, pincode `333026`); flag if server-authoritative serviceability is wanted later.
- **Socket CORS** (Task 16) is the only backend change in this plan.

---

## 9. Decisions log (append as decided)
- **Tailwind v3** (config-based `tailwind.config.ts`), not v4 CSS-first `@theme` — matches §5 idiom. [Task 1]
- **Dev ports:** backend API owns **`:3000`** (`http://<DEV_HOST>:3000/api/v1`); the web app runs on **`:3001`** — baked into the web `dev` script. `BACKEND_ORIGIN` (dev) = `http://<DEV_HOST>:3000`, `BACKEND_API_BASE` = `$BACKEND_ORIGIN/api/v1`, `SOCKET_URL` = `$BACKEND_ORIGIN`. [Task 1 → needed by Task 3]
- **`sharp` build allowed** in `pnpm-workspace.yaml` `allowBuilds` (next/image dependency). [Task 1]
- **i18n split:** `@chirawa/i18n/core` = headless (react + translations, injectable storage seam); RN `LanguageProvider` is the only async-storage importer; web provider is localStorage/cookie-backed. [Task 2]
- **Typecheck gate reality:** `pnpm -r typecheck` silently SKIPS the 3 RN apps (no `typecheck` script) and `apps/api` is pre-broken. Fix forward: add `"typecheck": "tsc --noEmit"` to customer/seller/rider apps so `pnpm --filter='!@chirawa/api' -r typecheck` is a real gate for shared-package changes. Do NOT touch the pre-existing `apps/api` errors (out of scope). [Task 2]
