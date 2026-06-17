# Location Search — Context & Implementation Blueprint

> Status: **IMPLEMENTED on Mappls (MapmyIndia) — awaiting live credentials.**
> The backend geo proxy was switched off Google and onto **Mappls** because
> Google Cloud billing was blocked for our account (see §10–§12). Code is done,
> typechecked, and unit-tested; it needs real Mappls credentials to verify live.
> Sections §0–§9 below are the original Google research/diagnosis, kept for
> history. **The current design is §12.**

---

## 0. TL;DR (the one-line cause)

The code path is **already fully wired and correct** — verified end-to-end against
the official Places API (New) spec. The only reason no places show is that the
backend has **`GOOGLE_MAPS_API_KEY=placeholder`** in `apps/api/.env`. The geo
service short-circuits to an empty array `[]` for a placeholder/empty key, so the
sheet always lands on the empty state: *"No matching places in Chirawa"*.

**Fix = configuration, not code:** create a real server-side key with **Places
API (New) + Geocoding API** enabled and billing on, put it in `apps/api/.env`,
restart the API. (Implementation-phase details in §5.)

---

## 1. Symptom (reported)

- Open app → tap the **location section in the header** → **Select delivery
  location** sheet opens.
- Tap the search field, type an address (e.g. an area/street).
- No suggestions appear — unlike Blinkit/Zepto, which show live recommended
  places. After 3+ chars you get the empty state text.

---

## 2. How it's supposed to work — full data flow

Everything below already exists in the repo and is correctly connected.

| # | Layer | File | What it does |
|---|-------|------|--------------|
| 1 | UI — search box | `apps/customer-app/src/components/location/LocationSheet.tsx:118-137` | `TextInput` bound to `search.query` / `search.setQuery` |
| 2 | UI — results render | `LocationSheet.tsx:140-155`, `PredictionRow` `:213-233` | shows spinner → predictions → else empty state `locationSheet.noResults` |
| 3 | Hook (debounce + session) | `apps/customer-app/src/components/location/usePlaceSearch.ts` | `MIN_CHARS=3`, `DEBOUNCE_MS=250`, generates a v4 `sessionToken`, calls `api.autocompletePlaces`, drops stale responses via `seqRef` |
| 4 | API client | `packages/api-client/src/index.ts:363-370` | `autocompletePlaces(q, sessionToken)` → `POST /geo/autocomplete`; `placeDetails(placeId, sessionToken)` → `POST /geo/place` |
| 5 | App `api` instance | `apps/customer-app/src/services/api.service.ts` | `api` is a `ChirawaApiClient` instance → methods (4) are available |
| 6 | Route (auth-gated) | `apps/api/src/modules/geo/geo.routes.ts:27-52` | `/geo/autocomplete` + `/geo/place`, zod-validated, key stays server-side |
| 7 | Zod schemas | `apps/api/src/modules/geo/geo.schema.ts:14-25` | `autocompleteSchema { q, sessionToken }`, `placeDetailsSchema { placeId, sessionToken }` |
| 8 | Service → Google | `apps/api/src/modules/geo/geo.service.ts:130-230` | `autocompletePlaces()` + `placeDetails()` call Google Places API (New) |
| 9 | Pick → resolve → map | `LocationSheet.tsx:56-63` | chosen prediction → `search.resolve(placeId)` → `/geo/place` → navigate to `AddressMap` centred on the resolved lat/lng |

**Empty-state strings** (`packages/i18n/src/translations.ts`):
- `locationSheet.searchPlaceholder` = "Search for area, street name…"
- `locationSheet.searching` = "Searching…"
- `locationSheet.noResults` = **"No matching places in Chirawa"** ← what the user sees now

---

## 3. Root-cause analysis

### 3.1 Primary cause — placeholder key
`apps/api/src/modules/geo/geo.service.ts:134-135`:
```ts
const key = env.GOOGLE_MAPS_API_KEY;
if (!key || key === 'placeholder') return [];   // ← short-circuit, no Google call
```
- `apps/api/.env` currently has `GOOGLE_MAPS_API_KEY=placeholder`.
- `apps/api/src/config/env.schema.ts:51` defaults it to `'placeholder'` when unset.
- So `autocompletePlaces()` returns `[]` → UI shows "No matching places in Chirawa".

This matches the warning in Batman's v4 commit (`723655a`): *"Needs a real
GOOGLE_MAPS_API_KEY (Geocoding + Places API New enabled) for live results."*

### 3.2 The code is correct (verified against the official spec)
The request the service builds matches Google's Autocomplete (New) reference
exactly (see §4):
- `POST https://places.googleapis.com/v1/places:autocomplete` ✅
- Headers `Content-Type`, `X-Goog-Api-Key`, `X-Goog-FieldMask` ✅
- Body `input`, `sessionToken`, `includedRegionCodes:['in']`,
  `locationRestriction.circle{center,radius=15000}` (≤ 50000 max), `origin` ✅
- Response parse: `suggestions[].placePrediction.{placeId, structuredFormat.mainText/secondaryText, distanceMeters}` ✅
- Details: `GET /v1/places/{id}?sessionToken=…` + `X-Goog-FieldMask: location,formattedAddress,addressComponents` ✅

**Conclusion: no wiring bug. Do not refactor the flow.** The work is GCP/key setup
plus verification.

### 3.3 There are TWO different Google keys — don't conflate them
| Key | Where | Purpose | Status | Restriction |
|-----|-------|---------|--------|-------------|
| **Server search key** = `GOOGLE_MAPS_API_KEY` | `apps/api/.env` | Places API (New) Autocomplete/Details + Geocoding (`/geo/reverse`) | ❌ `placeholder` — **this is the bug** | IP / none (server-to-server) |
| **Android Maps-SDK render key** | `apps/customer-app/app.json` → `android.config.googleMaps.apiKey` (`AIza…` already set) | Renders the `react-native-maps` `PROVIDER_GOOGLE` map on `AddressMapScreen` | ✅ already configured (that's why the map shows) | Android app: package `com.chirawa.customer` + SHA-1 |

⚠️ **Do not reuse the Android render key as the server key.** The Android key is
(or should be) restricted to the app's package + SHA-1, so Google will reject
server-side Places/Geocoding calls made with it. The server needs its own key
(same GCP project is fine) with an **IP / no application restriction** and the
**Places API (New)** + **Geocoding API** enabled.

---

## 4. Verified API reference (Places API New) — the blueprint

Source: official Google Maps Platform docs (links in §9). Confirms our impl.

### 4.1 Autocomplete (New)
- **POST** `https://places.googleapis.com/v1/places:autocomplete`
- Headers: `Content-Type: application/json`, `X-Goog-Api-Key: <KEY>`,
  `X-Goog-FieldMask: <comma-separated fields>`
- Body fields we use:
  - `input` (required) — the typed query
  - `sessionToken` — groups autocomplete calls + the final Details call for
    *per-session* billing
  - `locationRestriction.circle{center{latitude,longitude}, radius}` — radius
    `0–50000` m; results **outside are excluded** (vs `locationBias` which only
    biases). We use a 15 km circle around Chirawa.
  - `includedRegionCodes:['in']` — limit to India (max 15 codes). Note: setting
    this **disables query predictions** (fine — we only want place predictions).
  - `origin{latitude,longitude}` — enables `distanceMeters` in the response
    (used for the "x km" chip).
- Response: `{ suggestions: [{ placePrediction: { placeId, text{text,matches},
  structuredFormat{ mainText{text}, secondaryText{text} }, types, distanceMeters } }] }`
  — max **5** predictions.

### 4.2 Place Details (New) — closes the session
- **GET** `https://places.googleapis.com/v1/places/{PLACE_ID}?sessionToken=<same token>`
- Headers: `X-Goog-Api-Key`, `X-Goog-FieldMask` (**required** — omitting errors).
  We request `location,formattedAddress,addressComponents`.
- Response: `location.{latitude,longitude}`, `formattedAddress`,
  `addressComponents[].{longText,shortText,types}`.
- **Field-mask SKU tiers** (cost control): `location`, `formattedAddress`,
  `addressComponents` are all **Essentials** tier (cheapest). Adding
  `displayName`/`primaryType` bumps to **Pro**; `rating`/`openingHours` →
  **Enterprise**. Keep the mask minimal (we already do).

### 4.3 Session-token billing model
- One token spans: all autocomplete keystrokes for a search **+** the one
  Place Details call → billed as a single "Autocomplete session".
- Our hook does this correctly: same `sessionRef.current` across keystrokes,
  rotated to a fresh UUID **after** a pick (`usePlaceSearch.ts:51-55, 57-62`).
- Without a session token you'd be billed per-request — our impl avoids that.

### 4.4 APIs to enable in GCP
- **Places API (New)** — autocomplete + details. (The legacy "Places API" is a
  *different* product; we need the **New** one.)
- **Geocoding API** — for `/geo/reverse` (reverse-geocode the map pin) and is the
  backstop for address components.

---

## 5. The fix — step by step (implementation phase)

### 5.1 Google Cloud setup
1. Use the existing GCP project (the one that issued the `AIza…` Android key) or a
   dedicated one.
2. **Enable billing** on the project (Places/Geocoding refuse to return results
   without it — a top cause of "no results").
3. **Enable APIs**: *Places API (New)* and *Geocoding API*.
4. **Create a new API key** (separate from the Android key). For dev, leave
   unrestricted or restrict by your machine/server IP. For prod, restrict by the
   API server's egress IP and limit to *Places API (New)* + *Geocoding API*.

### 5.2 Wire the key into the backend
- Set in `apps/api/.env`:
  ```
  GOOGLE_MAPS_API_KEY=<the real server key>
  ```
- Restart the API (`pnpm dev:api`). `tsx watch` reloads on file change, but env
  is read at boot — **a manual restart is required** for `.env` changes.
- `.env.example` already documents the var (line 54) — leave it as `placeholder`.

### 5.3 Sanity-check before touching the app
Hit the backend directly (auth required — grab a dev token after logging in with
OTP `123456`, see `SETUP.md`):
```bash
curl -s -X POST http://localhost:3000/api/v1/geo/autocomplete \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"q":"chirawa","sessionToken":"test-session-123"}' | jq
```
Expect a JSON array of `{placeId, primaryText, secondaryText, distanceKm}`.
Empty `[]` with a real key ⇒ check billing / API-not-enabled / key restriction.

---

## 6. Verification / test plan
- [ ] `curl /geo/autocomplete` returns non-empty predictions (§5.3).
- [ ] `curl /geo/place` with a returned `placeId` + same `sessionToken` returns
      `lat/lng/formatted`.
- [ ] In-app: open Select-delivery-location → type "chirawa"/a local area →
      predictions list renders (spinner → rows), distance chip shows.
- [ ] Tap a prediction → `AddressMap` opens centred on the resolved coordinates.
- [ ] Reverse geocode (`/geo/reverse`) on the pin returns a clean,
      Plus-Code-free address (confirms Geocoding API is on).
- [ ] Confirm GCP metrics show requests landing on *Places API (New)*.

---

## 7. Edge cases & caveats
- **Chirawa-only by design.** `locationRestriction` is a 15 km circle around
  `CHIRAWA_CENTER = {28.2403, 75.6466}` (`geo.service.ts:106-107`). Searching for
  places **outside** that radius legitimately returns nothing → "No matching
  places in Chirawa". When testing, use real Chirawa-area names. To widen
  coverage later, bump `SEARCH_RADIUS_M` (≤ 50000) or switch to `locationBias`.
- **3-char minimum + 250 ms debounce** (`usePlaceSearch.ts:14-15`) — fewer than 3
  chars never queries. Matches Blinkit-ish behaviour; tweak if we want earlier
  hints.
- **`distanceMeters`** only appears because we send `origin`; the "x km" chip
  depends on it.
- **Auth-gated endpoints** — `/geo/*` require a logged-in user (prevents the key
  becoming an open geocoding relay). A logged-out app state ⇒ 401, not results.
- **Timeout** — 4 s `AbortController` per Google call; on timeout we return `[]`
  gracefully (no crash), which also looks like "no results".

---

## 8. Related fix already applied (separate bug, same area)
While diagnosing, the **edit-address** save was failing with
`ValidationError: Expected number, received string` because Prisma serializes the
`Decimal` `lat/lng` columns as **strings**, and the edit flow re-sends them.
Fixed by coercing on the backend — `apps/api/src/modules/users/users.schema.ts`:
```ts
lat: z.coerce.number().min(-90).max(90),
lng: z.coerce.number().min(-180).max(180),
```
(Also the `updateAddress` one-line typecheck cast in `users.service.ts`.) These
are uncommitted in the working tree.

---

## 9. Open decisions for implementation
1. **Whose key / project?** Reuse the existing GCP project (recommended) vs a new
   one. Need owner access to enable billing + APIs.
2. **Prod key restriction** — restrict the server key by the API host's static
   egress IP (needs the deploy IP).
3. **Search radius** — keep 15 km Chirawa-only, or widen as we expand towns?
4. **"Recommended"/recent like Blinkit** — current sheet shows quick actions +
   saved addresses when not searching. Do we also want recent-search chips or
   nearby suggestions on focus? (Future enhancement, not part of this fix.)
5. **Response lat/lng contract** — consider serializing `Address.lat/lng` to
   numbers in API responses (cleaner than the input coercion in §8).

---

## Sources
- [Autocomplete (New) — Places API](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete)
- [Method: places.autocomplete (REST reference)](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places/autocomplete)
- [Place Details (New)](https://developers.google.com/maps/documentation/places/web-service/place-details)
- [Using session tokens](https://developers.google.com/maps/documentation/places/web-service/using-session-tokens)
- [Places API usage & billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
- [Geocoding API usage & billing](https://developers.google.com/maps/documentation/geocoding/usage-and-billing)
- [Best practices: restricting API keys](https://mapsplatform.google.com/resources/blog/google-maps-platform-best-practices-restricting-api-keys/)

---

## 10. Why we left Google (2026-06-16/17)

Google Cloud **billing could not be activated** for our account:
- The existing key (`bringly-497511` project) is valid, but **billing wasn't enabled** → every web-service call (Places New, Geocoding) returns `403 / REQUEST_DENIED: "You must enable Billing"`.
- Enabling billing repeatedly failed with **`OR_BACR2_44`** on **both a credit card and UPI** — an account-level fraud/risk block, not a card issue.
- A different account surfaced a **₹3,000 refundable prepayment** wall.

Decision: rather than keep fighting Google billing, **switch the backend geo proxy to Mappls (MapmyIndia)** — no card/deposit to start, and better village-level coverage for Chirawa.

## 11. Mappls vs Google — capacity & cost (for the record)

- **1000 users/day is fine on Mappls' free tier** in realistic usage (most users have a saved address and never hit geo APIs; only new/changed addresses do). Worst case (every user does a fresh full search daily ≈ 210k hits/mo) would need a paid plan.
- Mappls bills **per API hit**; Google bills **per session**. We reduce Mappls hits via debounce + 3-char min + the placeId-encoding trick (no separate place-detail call).
- Exact Mappls free-tier number is **not public** — confirm in the console after signup.
- ⚠️ The **map render** on `AddressMapScreen` still uses Google's Android Maps SDK (`app.json` key) — it works but shows a *"dev only"* watermark without Google billing. Swapping the rendered map to Mappls is a separate, larger task; out of scope here.

## 12. Current implementation (Mappls) — THE design now

**Provider swap is fully contained to `apps/api/src/modules/geo/geo.service.ts`** — routes, types, api-client, and the app UI are unchanged.

**Auth:** `client_id` + `client_secret` → `POST https://outpost.mappls.com/api/security/oauth/token` (`grant_type=client_credentials`) → a ~24 h bearer token, **cached in-process** (60 s safety margin). REST key used separately for reverse geocode.

**Endpoints used (verified against the LIVE API 2026-06-17):**
| `/geo/*` route | Mappls API | Notes |
|---|---|---|
| `/geo/autocomplete` | `GET https://atlas.mappls.com/api/places/search/json?query=&location=<chirawa>` (Bearer) | Returns `suggestedLocations[]` = `eLoc, placeName, placeAddress, distance` — **NO coordinates**. `placeId = eLoc`. Hard-filtered to **15 km** via the `distance` field (Mappls `location` only biases). ✅ live: returns Chirawa Bus Stand, etc. |
| `/geo/place` | **none** → returns `null` | **The free tier has no coordinate-returning API** (Autosuggest omits lat/lng; Place Detail / forward-geocode are premium — live they return `DAILY_LIMIT_EXHAUSTED` / `412`). So a pick can't be resolved to coords; `null` makes the app open the map at its `CHIRAWA_CENTER` default and the user drops the pin. See §13. |
| `/geo/reverse` | `GET https://apis.mappls.com/advancedmaps/v1/<REST_KEY>/rev_geocode?lat=&lng=` | First `results[0]` → cleaned address; `source: 'mappls'`. ✅ live: returns Gandhi Chowk / Shyampura / Chirawa / 333026. NB: Mappls' `area` field is the **country** — we build the area line from `subLocality`/`locality` instead. |

**Env (add to `apps/api/.env`):** `MAPPLS_CLIENT_ID`, `MAPPLS_CLIENT_SECRET`, `MAPPLS_REST_KEY` (schema defaults all to `placeholder` → geo disabled, app falls back to on-device geocoder). `GOOGLE_MAPS_API_KEY` is now only the Android map-render key.

**App change:** `customer-app/src/utils/location.ts` reverse-geocode gate is now provider-agnostic (`source !== 'none'`, was `=== 'google'`); `ReverseGeocodeResult.source` union gained `'mappls'`. `usePlaceSearch`'s `sessionToken` is now a harmless no-op (Mappls ignores it).

**Tests:** `geo.service.test.ts` rewritten — pure parsers (`parseAutosuggest`, `decodePlaceId`, `parseRevGeocode`, `isPlusCode`) unit-tested (8 tests pass). API typecheck back to the 29 pre-existing-error baseline (0 new).

### To go live (needs you)
1. Sign up at **https://apis.mappls.com/console/** (or `auth.mappls.com/console`). No card required for the free tier.
2. Create a project / API set → copy **Client ID**, **Client Secret**, and the **REST API Key**.
3. Add to `apps/api/.env`:
   ```
   MAPPLS_CLIENT_ID=...
   MAPPLS_CLIENT_SECRET=...
   MAPPLS_REST_KEY=...
   ```
4. Restart the API. Then verify (the real-response field names — `suggestedLocations`, `latitude/longitude`, rev_geocode `results[]` — are parsed defensively but should be checked against the first live payload).

### ✅ Live-verified (2026-06-17, with real creds)
- OAuth token, Autosuggest, and Reverse-geocode all return correct Chirawa data through the actual service code (end-to-end smoke test passed).
- Field names + the 15 km distance filter confirmed against live payloads.

## 13. Known limitation — picking a result doesn't centre the map exactly

On the Mappls **free tier** there is **no coordinate-returning API**, so when a user
taps a search suggestion we can't jump the map to that exact place — it opens at
the **Chirawa town centre** and the user nudges the pin (reverse-geocode then fills
the address). For a ~5 km town this is acceptable, and **the reported bug — "search
shows nothing" — is fully fixed** (suggestions now appear).

To get exact "tap result → map centres on it":
- **Option A:** email **apisupport@mapmyindia.com** to enable the **Place Detail
  (coordinates)** API on the account, then resolve the eLoc → lat/lng in
  `placeDetails()` (marked with a TODO there).
- **Option B:** add a free forward-geocode fallback (e.g. Nominatim/OSM) for the
  picked `placeAddress` — coverage of small-town POIs is hit-or-miss.
- **Option C (chosen for now):** keep the town-centre fallback.

## Sources (Mappls)
- [Mappls OAuth token generation](https://developer.mappls.com/mapping/tokenGeneration/)
- [Mappls Autosuggest API](https://developer.mappls.com/mapping/autosuggest-api/)
- [Mappls Reverse Geocoding API](https://developer.mappls.com/mapping/reverse-geocoding-api/)
- [Mappls dev console](https://apis.mappls.com/console/)
