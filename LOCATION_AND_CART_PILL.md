# 📍 Auto-locate the customer (securely) + fix the "View Cart" capsule placement

> Two issues seen in `ss/1.jpeg` (our **Add address details** page):
> 1. The **"View Cart" capsule** (`CartDockPill`) is showing on the add-address page — it shouldn't be there.
> 2. **"Use my current location"** auto-filled the area as a **Plus Code** `6JVX+3C, Shyampura` (also seen in `ss/2.jpeg`) instead of a real locality — looks broken.

This doc is the full end-to-end plan + research, then we implement.

---

## PART A — Where should the "View Cart" capsule appear?

### A.1 Today (the bug)
`CartDockPill` is a **global** floating pill mounted once in `AppNavigator`, shown via a **denylist**:
```ts
const HIDDEN_ROUTES = new Set(['Checkout', 'OrderPlaced']);
const shouldShow = count > 0 && !HIDDEN_ROUTES.has(activeRoute);
```
A denylist means **every new screen shows the pill by default** — so our new `AddAddress` (and `AddressMap`, `AddressList`, `ShareAddress`, `ReceiveAddress`, `EditProfile`, `OrderTracking`…) all wrongly show "View Cart".

### A.2 Research — where do q-commerce apps show the mini-cart bar?
Blinkit/Zepto/Swiggy show the persistent **"View Cart"** bar only on **shopping/browsing surfaces** — home feed, category, search, product detail, store — i.e. anywhere you can *add* items and might want to jump to the cart. They **hide** it on **transactional / utility flows**: checkout, address entry/selection, payment, order tracking, profile/account, and auth. The bar is a *continue-shopping → go-to-cart* affordance; on an address form it's noise that competes with the form's primary CTA.

### A.3 Decision — switch to an **allowlist**
Show the pill **only** on browse/shop routes; default everything else to hidden (robust against new screens):
```ts
const CART_PILL_ROUTES = new Set([
  // bottom tabs (shopping/account shell)
  'Home', 'Categories', 'Special', 'OrderHistory', 'Profile',
  // pushed shopping surfaces
  'ProductDetail', 'ShopDetail', 'CategoryProducts', 'Search',
]);
const shouldShow = count > 0 && CART_PILL_ROUTES.has(activeRoute ?? 'Home');
```
Hidden automatically: `Checkout, OrderPlaced, OrderTracking, AddAddress, AddressMap, AddressList, ShareAddress, ReceiveAddress, EditProfile, AccountPrivacy`, all auth screens. Positioning logic (`TAB_ROUTES` offset / `ProductDetail` footer clearance) is unchanged.

---

## PART B — Auto-detect the customer's location (secure, end-to-end)

### B.1 Why we currently get a Plus Code
`AddAddressScreen.enableLocation()` uses `expo-location`'s **on-device** reverse geocoder
(`Location.reverseGeocodeAsync`). On Android this is the platform `Geocoder`, which in
**sparse/rural areas (Chirawa, a tier-3 town)** frequently returns a **Plus Code** in
`place.name` (e.g. `6JVX+3C`) because there's no street-level data. We then displayed
`place.name` directly → the ugly code.

### B.2 Research — how big tech auto-locates a user
The flow every major app (Blinkit, Zepto, Swiggy, Uber, Google Maps) uses:

1. **Permission priming, foreground-only.** Ask `requestForegroundPermissionsAsync()`
   ("When in use") *with a rationale*, never cold; foreground is enough for an address
   form (no background tracking). ([Expo Location](https://docs.expo.dev/versions/latest/sdk/location/) · [RN permission UX](https://blog.openreplay.com/requesting-location-permission-in-react-native-apps/))
2. **Get coordinates** from the fused provider (GPS + WiFi + cell). Geolocation is "the
   ability to track a device using GPS, cell towers, WiFi…". ([reverse geocoding](https://en.wikipedia.org/wiki/Reverse_geocoding))
3. **Reverse-geocode coordinates → a clean address** with **Google's Geocoding API**
   (not the OS geocoder). The response has structured `address_components` with types
   `route`, `sublocality`, `locality`, `postal_code`, `administrative_area_level_*`, plus a
   `formatted_address`. **Skip results whose `types` include `plus_code`** — that field
   only "best-approximates" the point and is *not* a street. ([Google reverse geocoding](https://developers.google.com/maps/documentation/geocoding/guides-v3/requests-reverse-geocoding) · [plus_code](https://developers.google.com/maps/documentation/geocoding/overview))
4. **Map-confirm.** The reverse-geocode is a *hint*; the user drags a pin / edits the
   line before saving (we already have `AddressMap`; the add-address form is editable).
5. **IP / coarse fallback** when GPS is denied (out of scope for Chirawa — we default to
   town centre + let the user type).

### B.3 Research — keeping it **secure**
Google's own guidance: **don't ship the Geocoding key in the client.** Use a **backend
proxy** — client sends `lat/lng` to *our* API, the server holds the key, calls Google,
**post-processes**, and returns only the fields the client needs. Also: restrict the key
to the Geocoding API, set quotas + alerts, rotate keys, never log precise coordinates.
([Google security guidance](https://developers.google.com/maps/api-security-best-practices) · [restricting keys](https://mapsplatform.google.com/resources/blog/google-maps-platform-best-practices-restricting-api-keys/) · [proxy pattern](https://github.com/rpearce/geocoding-proxy))

> Our app already ships a **Maps SDK** key in `app.json` (needed client-side to *render*
> the map) — that's a different key/use. The **Geocoding** key stays server-side only.
> The backend already declares `GOOGLE_MAPS_API_KEY` in `env.schema.ts`.

### B.4 Architecture we'll build
```
AddAddress"Enable"  ──►  utils/location.resolveCurrentAddress()
   │  1. requestForegroundPermissionsAsync()  (priming, "when in use")
   │  2. getCurrentPositionAsync()            → {lat,lng}
   │  3. api.reverseGeocode(lat,lng)  ──────► POST /api/v1/geo/reverse (auth)
   │         backend geo.service → Google Geocoding (server key, timeout)
   │         → parse address_components, DROP plus_code, pick sublocality/route/locality
   │         → { area, street, city, pincode, state, formatted }
   │  4. fallback (key absent / network fail): expo reverseGeocodeAsync,
   │         but **never** surface a Plus Code (regex-filtered)
   └─ prefill Area (+ House from route), keep coords for the saved address
```
**Security properties:** geocoding key server-side only; endpoint is auth-gated +
rate-limited; server builds the Google request (no arbitrary relay) and returns only
needed fields; foreground-only permission; coordinates used transiently (we persist only
the address the user confirms).

### B.5 Files
| Area | File | Change |
|---|---|---|
| Backend | `modules/geo/geo.schema.ts` | **NEW** zod `{ lat, lng }`. |
| Backend | `modules/geo/geo.service.ts` | **NEW** `reverseGeocode()` → Google Geocoding (server key, `AbortController` timeout, injectable `fetchImpl`), parse + **drop `plus_code`**. |
| Backend | `modules/geo/geo.routes.ts` | **NEW** `POST /reverse` (`authenticate`). |
| Backend | `modules/geo/__tests__/geo.service.test.ts` | **NEW** parser unit tests (plus-code dropped, components extracted, key-missing → null). |
| Backend | `app.ts` | register `geoRoutes` at `/api/v1/geo`. |
| Types | `packages/types/src/dto/geo.dto.ts` | **NEW** request/response DTO. |
| Client SDK | `packages/api-client/src/index.ts` | **NEW** `reverseGeocode(lat,lng)`. |
| App | `utils/location.ts` | **NEW** `resolveCurrentAddress()` + `isPlusCode()` + hardened expo fallback. |
| App | `screens/profile/AddAddressScreen.tsx` | use `resolveCurrentAddress()`; never show a Plus Code. |
| App | `components/CartDockPill.tsx` | allowlist visibility (Part A). |

### B.6 Plus-code guard
`^[23456789C-HJ-NP-V]{2,}\+[23456789C-HJ-NP-V]{2,}` (Open Location Code alphabet) — if a
candidate area string matches, we discard it and fall back to locality/city.

---

## C. Done-when
- [x] "View Cart" pill shows only on Home/Categories/Special/OrderHistory/Profile + ProductDetail/ShopDetail/CategoryProducts/Search (allowlist); **gone** from AddAddress and every address/checkout/auth/utility screen.
- [x] "Enable / Use my current location" fills a **real locality** (Google via backend proxy); on key-missing/offline it falls back to the OS geocoder and **never a Plus Code** (regex-guarded both server + client).
- [x] Geocoding key is **server-side only** (`env.GOOGLE_MAPS_API_KEY`); endpoint auth-gated; foreground-only permission; coords used transiently (only the confirmed address is saved).
- [x] customer-app `tsc` = 0 errors; new backend geo files = 0 errors (pre-existing repo-wide `exactOptionalPropertyTypes` errors are unrelated); backend parser unit test passes (4/4); no new client deps (expo-location already present).

## D. Out of scope / ops follow-ups
- Provisioning a real `GOOGLE_MAPS_API_KEY` (Geocoding API enabled) in backend env + key restriction/quota/rotation — an ops task; until then the hardened OS fallback is used.
- IP-based coarse fallback; full map-pin confirm on the add page (we already have `AddressMap`).
