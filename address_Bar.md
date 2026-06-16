# Address Bar — Redesign

Reworked the customer-app address/location flow to match the reference screens
(Blinkit + Zepto map-pin pattern), keeping Bringly's **orange** brand (`#FF6B35`)
— the references' green/red are just those apps' colors, not part of our palette.

> Status: **IMPLEMENTED ✅** — typechecks clean (`tsc --noEmit`, 0 errors).
> Not yet run on a device/emulator.

---

# v5 — Bug fixes: search, edit, global address switch (✅ IMPLEMENTED on `feat/address-v5`)

> Built; customer-app + packages typecheck **0 errors**. As built:
> - **Edit fixed:** `AddressActionsSheet` is no longer a nested `<Modal>` — it's an
>   absolute-fill overlay, so the ⋯ menu (Edit/Share/Set default/Delete) works
>   inside the sheet too.
> - **Global switch:** new **`AddressContext`** (current address + `select(id)`,
>   persisted to AsyncStorage, server default synced). Home / Categories / Order
>   History headers + **Checkout** all read `current` from it; selecting/pinning in
>   the sheet or My Addresses switches the delivery address **everywhere instantly**,
>   and **Checkout re-prices on switch**. `AddressCard` shows the pin/default from
>   the optimistic current.
> - **Search key staged:** `GOOGLE_MAPS_API_KEY` set in `apps/api/.env` to the
>   existing key. ⚠️ **It still won't return results until you, in Google Cloud:**
>   **(1) enable Billing** on that project (the direct call returns
>   `REQUEST_DENIED: "must enable Billing"`), and **(2) enable Places API (New)**
>   (`403 PERMISSION_DENIED`). Code is correct; this is purely a GCP toggle. (Map
>   address text still works via the on-device geocoder meanwhile.)

---


Three reported breakages (IMG_3831/3833/3834). Root causes diagnosed below.

## 1. Search returns nothing (IMG_3831)
**Root cause:** `GOOGLE_MAPS_API_KEY=placeholder` in `apps/api/.env`, so the backend
autocomplete (correctly) returns `[]` → the sheet shows "no places". **Config, not
a code bug.**
**Fix:**
- Set `GOOGLE_MAPS_API_KEY` in `apps/api/.env` to a real key. The Android Maps key
  already in `app.json` (`AIzaSyBN1U…`) is a candidate **if** its Google Cloud
  project has **Geocoding API** + **Places API (New)** enabled (and the key isn't
  Android-app-restricted — a server key/no-referrer-restriction is safest).
- Restart the API (it reads the key at boot).
- Small UX honesty: backend returns a `keyConfigured:false` hint (or the client
  treats empty + non-error as "search unavailable here") so a missing key doesn't
  look like "no results". (optional)

## 2. Can't edit saved addresses (IMG_3833)
**Root cause:** `AddressActionsSheet` is a `<Modal>` rendered **inside** the
`LocationSheet` `<Modal>` (nested modals). **Android does not render a nested
Modal**, so the ⋯ menu (Edit/Share/Set default/Delete) never appears from the
sheet. (On the top-level My Addresses page it isn't nested, so it works there.)
**Fix:**
- De-nest the actions menu. Cleanest: convert `AddressActionsSheet` from a `Modal`
  to an in-tree absolute overlay (so it works whether or not it sits inside another
  modal), **or** have the card's ⋯ close the sheet first and open the menu at the
  screen level. Recommended: make it a non-Modal overlay → works everywhere,
  including inside the sheet.
- Then verify Edit → `AddressDetails` (editId prefill) → `updateAddress` PATCH
  end-to-end (the path itself is correct; it was just unreachable).

## 3. Pin + switch the active address everywhere (IMG_3834)
**Root cause:** there is **no global current-address state**. `HomeScreen`,
`CategoriesScreen`, `OrderHistoryScreen`, and `CheckoutScreen` each fetch addresses
and locally pick `find(isDefault)`. So pinning/selecting in the sheet updates the
backend but **doesn't propagate** to the home header or the cart/checkout, and the
pin/select feels broken.
**Fix — a real global address store (the proper big-app pattern):**
- New **`context/AddressContext.tsx`** provider (mounted high, after auth):
  - holds `addresses`, `currentAddress`, `loading`;
  - `refresh()`; `select(id)` = optimistic set `currentAddress` + `api.setDefaultAddress(id)` + persist to AsyncStorage; `remove`/`update` helpers re-sync.
  - hydrates on launch (persisted id → that address, else the `isDefault`).
- **All surfaces read `currentAddress` from the context** instead of their own
  `find(isDefault)`: Home header, Categories header, Order-history header, and
  **Checkout** (so the delivery address + pricing follow the switch into the cart).
- **LocationSheet select** and **AddressCard pin** call `context.select(id)` →
  every screen updates instantly (optimistic), backend confirms in the background.
- **Fix pin tappability:** the 📌 sits inside the card's `TouchableOpacity`; give it
  its own hit area / stop propagation so tapping the pin doesn't trigger card-select
  (and vice-versa).

## Files v5 will touch
- `apps/api/.env` (key — config) · *(optional)* `geo.service.ts`/DTO (key hint)
- **New** `apps/customer-app/src/context/AddressContext.tsx` + provider wiring
- `HomeScreen`, `CategoriesScreen`, `OrderHistoryScreen`, `CheckoutScreen` (read context)
- `LocationSheet`, `AddressListScreen`, `AddressCard` (select/pin via context),
  `AddressActionsSheet` (de-nest: Modal → overlay)

## Decisions before building
1. **Search key** — reuse the existing `AIzaSyBN1U…` for the backend (you enable
   Geocoding + Places (New) on its project), or issue a dedicated server key?
2. **Persist the chosen address** across app restarts via AsyncStorage (recommended)?
3. **Checkout** — should switching the address mid-cart also re-price immediately
   (recommended), matching the home/header switch?

---

# v4 — High-class polish + functional search (✅ IMPLEMENTED on `feat/address-v4`)

> Built. types + api-client + i18n + customer-app typecheck **0 errors**; backend
> geo files clean; the three `/geo/*` routes return **200** (empty in dev until a
> real key is set). **One thing you must do:** in apps/api `.env`, set a real
> `GOOGLE_MAPS_API_KEY` whose Google Cloud project has **Geocoding API** *and*
> **Places API (New)** enabled — until then reverse-geocode falls back to the
> on-device geocoder and search returns empty (by design, no crash).
>
> **As built:**
> - Backend `apps/api/.../geo/`: `POST /geo/autocomplete` + `POST /geo/place`
>   (Places API New, `locationRestriction` circle 15 km around Chirawa, session
>   tokens, field masks, distance from centre). Key stays server-side.
> - `packages/types` (Place DTOs) + `packages/api-client`
>   (`autocompletePlaces`, `placeDetails`, `updateAddress`).
> - **Plus Codes killed:** `AddressMapScreen` + `AddressDetailsScreen` now use
>   `api.reverseGeocode` (+ on-device fallback); **deleted `utils/geocode.ts` &
>   `config/maps.ts`** (in-JS key gone).
> - New shared `AddressCard` (category avatar · pin=default · share · ⋯) +
>   `AddressActionsSheet` (Edit·Share·Set default·Delete) + `usePlaceSearch` hook +
>   `utils/shareAddress`.
> - `AddressListScreen` rebuilt → IMG #12; `LocationSheet` → functional
>   Chirawa-only search + `AddressCard`. Edit flow PATCHes via `updateAddress`.
> - i18n strings added; "(optional)" dropped from the maps-link label.

---

## ORIGINAL PLAN (for reference)


From the user's review of the *current* build (IMG_3823–3828). Reference for the
sheet + saved cards = **IMG_3525** (Blinkit "Select delivery location"). Keep
Bringly **orange**. Goal: make it behave like a top-tier real app — fully
functional, secure, optimized.

> **Architectural backbone (decided by the codebase):** `main` already ships a
> **secure server-side geo proxy** — `POST /api/v1/geo/reverse` (`apps/api/.../geo/`)
> that reverse-geocodes via Google with the **key kept server-side** and a
> **Plus-Code guard** (`isPlusCode`, `parseGoogleResults`). But our
> `AddressMapScreen` + `AddressDetailsScreen` still call the **client-side**
> `utils/geocode.ts` I added in v2 — which has **no Plus-Code filter** and embeds
> the Maps key in app JS. **That single mismatch is the root of items B & part of
> D.** v4 consolidates everything onto the backend proxy and **deletes
> `utils/geocode.ts` + `config/maps.ts`.**

## A. Polish the delivery-location sheet → IMG_3525 look (IMG_3823)
`LocationSheet.tsx`. Structure already matches; this is visual craft:
- Saved-address cards: rounded surface, **category avatar tile** (see F), bold
  name, 2-line muted address, phone line, and a trailing **pin / ⋯ / share** action
  row — exactly like the reference. Selected = orange ring + check.
- Quick-action card (Use current / Add new / Request from someone else): keep, tidy
  spacing + chevrons. (No "Import from Zomato".)
- Search field stays rectangular; becomes functional (item D).

## B. Kill Plus Codes — show real place names (IMG_3824, IMG_3825, IMG_3826)
The map card title and the "Area, street" card show Open Location Codes like
`6JRR+P49`, `6JQV+MPR`, `6MW2+J7F` because client `geocode.ts` picks Google's
`plus_code` as the name. Fix:
- **Route both screens through `api.reverseGeocode(lat,lng)`** (backend proxy),
  which returns a cleaned `{ area, street, city, pincode, source }` that is
  **never a Plus Code** (`parseGoogleResults` already strips them; falls back to
  sublocality → neighbourhood → route → locality, then the on-device geocoder).
- Map card title = `area` (or `street`), subtitle = the cleaned full line.
- `AddressDetailsScreen` City/Area cards = the cleaned values, never a Plus Code.
- Delete `utils/geocode.ts` + `config/maps.ts`; drop the in-JS Maps key.
- Add a final guard in the UI: if any displayed string still matches the Plus-Code
  regex, show the locality/`city` instead.

## C. Remove "(optional)" from the maps-link field (IMG_3826)
i18n `address.mapsLink`: `'Add google maps link (optional)'` → `'Add google maps
link'` (en + hi). The field stays optional in logic; just drop the word.

## D. Make the search actually work — Places Autocomplete (IMG_3827)
Today the sheet search only filters saved addresses (`No saved addresses yet`).
Make it a real **navigational place search** the high-class way:

**New backend proxy** in the existing geo module (key stays server-side, mirrors
`/geo/reverse`), using **Places API (New)** — *Autocomplete (New)* + *Place Details
(New)*; legacy can no longer be enabled:
- `POST /api/v1/geo/autocomplete` `{ q, sessionToken }` →
  `[{ placeId, primaryText, secondaryText, distanceKm }]`. Server calls Places
  Autocomplete (New) with:
  - **`locationRestriction`** = a **circle around `CHIRAWA_CENTER`** (start ~15 km,
    covers Chirawa town + nearby villages) — a **hard restriction, not a bias**, so
    results from other cities/states **never appear**.
  - `includedRegionCodes:['in']` as a backstop.
  - **Server-side safety net:** drop any prediction whose resolved
    region/locality isn't Chirawa/Jhunjhunu (so a stray Jaipur/Haryana/UP hit like
    the reference's `132 km`/`248 km` rows can't slip through).
  - `distanceKm` computed from `CHIRAWA_CENTER` (or the device GPS if shared) →
    shown on the result tile.
- `POST /api/v1/geo/place` `{ placeId, sessionToken }` → `{ lat, lng, area, city,
  pincode, formatted }` via Place Details (New) with a **field mask**
  (`location,formattedAddress,displayName,addressComponents`) — only what we need.

> **Chirawa-only is the core rule:** the app serves only Chirawa for now, so a
> Chirawa user searching their locality must see **only Chirawa-area matches** —
> never another city/state. Enforced by `locationRestriction` + the region filter
> above (not merely ranking them lower).

**Result row (per IMG #13):** pin-icon tile with the **distance** under it,
**primary text** (e.g. *Near Shyam Mandir*) bold + **secondary text** (e.g.
*Ambika Nagar, Chirawa, Rajasthan*) muted. Saved matches first, then place results
under a "Search results" heading.

**Optimization (real-app grade):**
- **Session tokens** — one UUID v4 per search session, sent on every autocomplete
  call *and* the final place-details call, so Google bills the whole session once
  (per their guidance). New token after each pick.
- **Debounce** input ~250 ms; ignore <3 chars; cancel in-flight on change.
- Redis-cache popular `q`→predictions briefly server-side (like product suggest).
- Client merges results: **saved addresses first** (instant, offline) **then**
  place predictions under a "Search results" heading.

**Flow:** type → suggestions → tap → `/geo/place` → coords → push `AddressMap`
pre-centred there (then Confirm → details). Quota/error → graceful fallback to
"Use current location".

## E. Redesign "My Addresses" page → IMG #12 (IMG_3828)
`AddressListScreen.tsx` looks crude (emoji + "Default"/"Delete" text buttons).
Rebuild it as the **full-page twin of the sheet**, matching IMG #12:
- Header **"My Addresses"** + back.
- Top action rows (same component as the sheet): **+ Add new address**, **Request
  address from someone else** (WhatsApp). *Skip "Import from Zomato"* — not a real
  feature for us.
- **"Your saved addresses"** heading, then the shared **`AddressCard`** (item F)
  per address: category **avatar tile** · name · 2-line address · `Phone number:`,
  with a **📌 pin** top-right and an inline **⋯ (more)** + **share (↑)** button row —
  pixel-faithful to IMG #12.
- Default address surfaces first; remove the old star/Delete text buttons and the
  separate `+` FAB (the top "Add new address" row replaces it). Empty state stays.
- Same `AddressCard` is reused in `LocationSheet` so the two stay identical.

## F. Saved-address cards: category avatar + share + edit + pin (IMG_3525 / #11)
Applies to **both** the sheet and My Addresses:
- **Category avatar** from the label: Home → house, Work → briefcase/building,
  Hotel → bed, Other/person → people — tinted tile (matches the reference's
  yellow-icon tiles, in our orange/neutral palette). Map via the existing
  `LABEL_VALUE` (घर/दुकान/होटल/अन्य).
- **Pin** = set as default (`api.setDefaultAddress`) — the 📌 in the reference.
- **Share** = share the formatted address (reuse the WhatsApp/`ShareAddress`
  deep-link flow already in the repo) + native Share sheet.
- **Edit** = open the add-address form **prefilled** for that address and **update**
  it via `api.updateAddress(id, …)` (already exists). Needs `AddressDetails`/add
  flow to accept an `editId` + initial values, and to PATCH instead of create.

## Files v4 will touch
- `components/location/LocationSheet.tsx` (cards + search results UI)
- `screens/profile/AddressMapScreen.tsx`, `AddressDetailsScreen.tsx` (→ backend geo)
- `screens/profile/AddressListScreen.tsx` (redesign + actions)
- **New** `components/location/AddressCard.tsx` + `AddressActionsSheet.tsx` (shared)
- `apps/api/src/modules/geo/` (+ autocomplete + place-details routes/service)
- `packages/api-client` (+ `autocomplete`, `placeDetails`), `packages/types` (DTOs)
- `packages/i18n/translations.ts` (search results, actions, drop "(optional)")
- **Delete** `utils/geocode.ts`, `config/maps.ts`
- Edit flow: extend `AddressDetails` params (`editId` + prefill) + save path

## Decisions to confirm before building
1. **Places API enablement** — the search needs **Places API (New)** enabled on the
   server Maps key (separate SKU, billed per session; ~free within the monthly
   credit at low volume). OK to enable, or defer item D and ship A/B/C/E/F first?
2. **Edit flow** — reuse the existing add-address screen prefilled + PATCH
   (recommended), vs a separate edit screen?
3. **Share format** — WhatsApp deep link (reuses existing) + native share sheet, or
   native share only?
4. **Avatar style** — flat tinted icon tiles (recommended, matches reference) vs
   illustrated/emoji.

_Sources for the search design:_ Places API (New) Autocomplete + session-token &
field-mask billing guidance (developers.google.com/maps/documentation/places).

---

# v3 — UX refinements (✅ IMPLEMENTED)

> Built; customer-app + i18n typecheck clean. Not yet run on a device. No new
> native module (uses expo-location, already in the build) — so a **JS reload is
> enough**, no rebuild needed for v3.

**As built:**
- **A** — verified the address bar opens the sheet on Home / Categories / Order
  History (Header row → `onLocationPress` → `LocationSheet`). No change needed.
- **B** — `utils/geo.ts`: center → `28.2403, 75.6466`, **3 km radius**, new
  `isInsideServiceArea()` (radius now, `CHIRAWA_POLYGON` ready). `AddressMapScreen`
  uses it; out-of-range shows the warm "coming soon" banner and Confirm stays
  disabled.
- **C** — `utils/geocode.ts`: layered **Google → native expo-location** fallback,
  so a real address shows on drag / current-location even before the Geocoding API
  is enabled.
- **D** — `AddressDetails` "Area, street" card shows `resolved.title || locality`,
  never "Selected location".
- **E** — House/Apartment **optional**; Area + Landmark **required** (placeholders +
  `canSave` updated; save maps `street = [house, area].join`).
- **F** — new `LocationPermissionModal` shown on Home when permission is off
  (Enable → request/Settings, Select manually → opens sheet).
- **G** — `AddressDetails` location-off **banner** with Enable → requests
  permission, fetches GPS, reverse-geocodes, and auto-fills City/Area.
- i18n: `comingSoon`, `locPerm*`, `enableLocation`, `selectManually`, `autoFill*`,
  `enable`, and required-marker placeholder tweaks (en + hi).

**Polygon swap (later):** when you send the boundary coordinates, set
`CHIRAWA_POLYGON` in `utils/geo.ts` — `isInsideServiceArea()` flips to
point-in-polygon automatically, no other changes.

---

Round 3, from the user's feedback. Keeps Bringly **orange**. Reference mapping:
- **Image #6** = `IMG_3525` — the "Select delivery location" sheet (`LocationSheet`)
- **Image #7** = `IMG_3757` — "Location permission not enabled" full modal
- **Image #8** = `IMG_3699` — "Adding address at your current location? Enable" banner

## A. Address bar / search always opens the sheet (#6)
Every "change address" affordance — the **header address chip** and **tapping the
search field** — must open the `LocationSheet` (saved addresses + Use current
location + Add new address + Request from someone else). Audit all entry points
(Home header, Categories header, anywhere showing the delivery address) and make
sure they all open the sheet rather than jumping straight to the map.

## B. Chirawa boundary + friendly out-of-range copy
**Replace the hard "We currently only deliver within Chirawa"** with a warm,
non-offensive message, e.g. **"We're not delivering here just yet — but we're
expanding fast and will reach you soon! 🛵"** (en) / Hindi equivalent.

**Boundary analysis (researched + confirmed on the Chirawa map):** Chirawa is a
municipality of ~47.4 km² centred near 28.25°N 75.633°E (Wikipedia). The shared
Google Maps screenshot shows the admin boundary; the town **core** sits central-
east of it, near the user's GPS pick.

**LOCKED for v3:**
- **Center** = `28.240303949239777, 75.64655776908275` (town core; covers the
  Wikipedia point ~1.7 km away). _Old code center `28.2330, 75.6307` is replaced._
- **Radius** = **3 km**, **town only**.
- **Polygon later:** the user will provide exact boundary coordinates. So build the
  geofence as a single swappable function in `utils/geo.ts` —
  `isInsideServiceArea(lat, lng)` — that does the 3 km radius now and flips to a
  point-in-polygon test (ray casting) the moment a `CHIRAWA_POLYGON` ring is
  supplied, with **no caller changes**.

## C. Real-time address on drag + current location (kill "Selected location")
Today the bottom card shows **"Selected location"** whenever Google geocoding
fails (most likely the Maps key doesn't have the **Geocoding API** enabled yet).
Fix in two layers:
1. **Enable the Geocoding API** on the key (external, already flagged).
2. **Layered geocoder fallback in code:** try Google → on failure fall back to the
   native `expo-location` reverse-geocoder → only then a generic label. So a real
   street/area name shows on **every pin drag** and on **Go to current location**,
   even before the key is fully provisioned. Debounce drags so we don't spam the
   API; keep the existing race-guard.

## D. "Area, street" card shows the real area name (#8 / details page)
The `AddressDetails` "Area, street" summary must show the **geocoded area**, never
"Selected location". Same layered-geocoder fix as C feeds it; if everything fails,
fall back to the locality from the pin, not a placeholder string.

## E. Manual address boxes — flip which are required
On the add-address page the 3 boxes change required-ness:
- **House no. / Apartment / Building** → **optional**
- **Area, Street** → **required** ✱
- **Landmark** → **required** ✱

Save mapping onto the existing DTO stays valid: `street = [house, area].join(', ')`
(area is required so street is always non-empty); `landmark = box3` (required).
No backend change.

## F. App-open "location off" modal (#7), themed
On app open, if location permission is **denied/off**, show a centred modal in our
theme: pin-off icon, **"Location permission not enabled"**, "Please enable location
permission for a better delivery experience", and two actions — **Enable location**
(request permission; if permanently denied, deep-link to OS settings) and **Select
location manually** (opens the `LocationSheet`). Show it on the Home surface;
don't nag (once per app session, or until a location/address is set).

## G. AddressDetails "enable to auto-fill" banner (#8), themed
On the add-address page, if location is **off**, show the top banner: pin-off icon,
**"Adding address at your current location? Enable it to auto-fill the address"**,
with an **Enable** button. On enable → request permission → on grant, fetch current
location, geocode it, and auto-fill City / Area. Hidden when permission is granted.

## Files v3 will likely touch
- `components/location/LocationSheet.tsx` (entry audit), Home/Categories headers.
- `utils/geo.ts` (boundary model + geofence test), `utils/geocode.ts` (layered
  fallback), `AddressMapScreen.tsx` (friendly copy, real-time address).
- `AddressDetailsScreen.tsx` (required-flags, area-name card, location-off banner).
- New: a `LocationPermissionModal` component + a hook to read permission state.
- `packages/i18n/translations.ts` (new strings, en + hi).

## Decisions (LOCKED ✅)
1. **Boundary** — **3 km radius** from center `28.240303949239777,
   75.64655776908275`, **Chirawa town only**. Built as a swappable
   `isInsideServiceArea()` so the user's forthcoming **polygon** drops in with no
   caller changes.
2. **Out-of-range** — **block Confirm** with the friendly "coming soon" message
   (out-of-area addresses can't be saved).
3. **In-sheet search** — **saved addresses only** for v3 (no Google Places yet).

_Still external (unchanged from v2): enable the **Geocoding API** on the Maps key;
**rebuild the dev client** for the contacts picker._

---

# v2 — Refinement (✅ IMPLEMENTED)

> Built. customer-app + `@chirawa/types` typecheck clean; the address create/list
> backend path is clean (a DB migration was applied). **Not yet run on a device.**
> Two deploy caveats: (1) the Google Maps key in `app.json` must have the
> **Geocoding API enabled** for the bottom-card address text (pin coords are exact
> regardless; if disabled the card falls back to a generic "Selected location").
> (2) `apps/api` has ~20 **pre-existing** `exactOptionalPropertyTypes` tsc errors
> across auth/cart/orders/payments — unrelated to this work; our `createAddress`
> was actually cleaned up in passing.

**As built — files changed:**
- DB: `apps/api/prisma/schema.prisma` + migration
  `20260613134851_add_address_receiver_contact` (adds `contact_type`,
  `receiver_name`, `receiver_phone`, `maps_link` to `addresses`).
- Backend: `users.schema.ts` (zod), `users.service.ts` (create data + list select).
- Shared: `packages/types/src/dto/address.dto.ts` (`ContactType` + new optional
  fields on request/response). `api-client` forwards them unchanged.
- App: `AddressMapScreen.tsx` (orange lollipop pin + shadow, exact-GPS snap, Google
  geocoding, "X km away" line, POIs, tooltip), `AddressDetailsScreen.tsx` (City/Area
  cards, 3 example boxes, maps-link, Myself/Someone-else + receiver fields +
  contacts picker, Home/Work/Hotel/Other), `LocationSheet.tsx` (rectangular search).
- New: `src/config/maps.ts` (Maps key for REST), `src/utils/geocode.ts` (Google
  reverse-geocoder). `app.json` (READ_CONTACTS + expo-contacts plugin). i18n strings.
- Dep added: `expo-contacts ~15.0.11`.

---

This round refines the three surfaces to match a specific set of reference shots,
keeps the Bringly **orange** theme, and adds **exact-GPS pin placement** via Google
Maps. Reference mapping (from the user's message):

- **Image #1** = `IMG_3695` — map pin screen ("Select Your Location")
- **Image #2** = `IMG_3699` — green "Add address details" base layout
- **Image #3** = `IMG_3698` — Zepto "Add Address Details" (the 3-field structure)
- **Image #4** = `IMG_3702` — green details page, "Myself" selected
- **Image #5** = `IMG_3700` — green details page, "Someone else" selected

## A. "Select delivery location" sheet — `LocationSheet.tsx`

Match the Blinkit sheet (`IMG_3525` / `IMG_3526`): title **Select delivery
location**, search, *Use current location*, *Add new address*, *Request address
from someone else*, then saved addresses. Our sheet is already structurally there.

- **Change:** keep the search field **rectangular** (small radius, e.g. `Radius.md`),
  **never** pill/oval (`Radius.full`). This is the one explicit visual rule.
- Everything else in the sheet stays as-is.

## B. Map pin screen — `AddressMapScreen.tsx` (step 1)

Rebuild the pin visuals + nail exact-location accuracy.

1. **Exact device GPS on "Use current location".** Use
   `Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest })`
   (consider `BestForNavigation` + a fresh fix, not a cached `getLastKnownPosition`).
   Animate the map so its **centre = the exact returned coords**. The confirmed
   lat/lng must be those exact floats — **no rounding, no mismatch**. For the
   "current location" case specifically, store the raw GPS coords and use them on
   Confirm unless the user has since dragged the map (so map-snapping drift can't
   corrupt the value).
2. **Orange lollipop pin + shadow.** Replace the current `Ionicons location-sharp`
   with a real lollipop: a filled **orange** (`#FF6B35`) round head on a thin
   stalk, and a **translucent oval shadow** on the ground where the tip points
   (like Image #1's pin, recolored orange). Fixed at screen centre; the map slides
   under it.
3. **Show nearby Google places/shops.** Keep `provider={PROVIDER_GOOGLE}` and the
   **default** Google styling so POIs/shops/landmarks render (do **not** set
   `showsPointsOfInterest={false}` or a custom style that hides them). Brand-orange
   applies to **our** pin + buttons; Google's POI labels keep their native styling
   so they stay recognizable. (Optional, deferred: a `customMapStyle` JSON to tint
   the map warm — not recommended now.)
4. **Tooltip** above the pin: **"Order will be delivered here / Place the pin to
   your exact location"** (Image #1 wording).
5. **Bottom card:** resolved **title** (e.g. street/area) + full address line +
   an info line **"Pin location is X km away from your current location"** (Image
   #1). Primary button styled orange.
6. **Reverse-geocoding accuracy:** see Decision (1) below — Google Geocoding API
   (better for Indian addresses, uses the existing key) vs the current native
   `expo-location` geocoder.

## C. "Add address details" page — `AddressDetailsScreen.tsx` (step 2)

Base = Image #2/#4/#5 (green Bringly layout), with the address area swapped to the
Image #3 multi-field structure:

- **Header:** "Add address details" + back.
- **Address details card** (from Image #2): **City** row (icon + "City" + value +
  **Change**) and **Area, street** row (icon + value + **Change**) — these stay
  read-ish, prefilled from the geocoded pin.
- **Replace** the single "Enter complete address\*" field with **3 separate input
  boxes**, each with an example placeholder:
  1. **House no., Building or Company name** — e.g. *"A-504, Shanti Heights"*
  2. **Area, Street** — e.g. *"Link Road, Tonk Phatak"*
  3. **Landmark** — e.g. *"Near Inorbit Mall"*
- **Contact details** (Image #4/#5): **Myself / Someone else** radio; **Receiver's
  name** (clearable); **Receiver's phone** `+91 …` with a **contacts-picker** icon
  (needs `expo-contacts` — see Decision 2).
- **Save address as** chips: **Home / Work / Hotel / Other** (adds **Hotel**; today
  we only have home/work/other).
- Primary button (Next/Save) — orange.

## Data / backend implications (the real work behind C)

- **Receiver name/phone don't exist in `CreateAddressRequest`** (DTO in
  `packages/types`). To persist them we must extend the DTO + `api-client` +
  the backend `POST /users/me/addresses` handler. See Decision (3).
- **"Hotel" label** needs a value added to the `LabelChoice` → Hindi map
  (`home→घर, work→दुकान, hotel→होटल, other→अन्य`).
- **3-box mapping** onto the existing DTO (if not extending the schema):
  `street` = box1 (House/Building) `+ ", " +` box2 (Area/Street); `landmark` =
  box3; `locality`/`city`/`pincode`/`lat`/`lng` from the pin.
- **"Add google maps link (optional)"** field appears in Image #4/#5 above contact
  details — **excluded for now** unless you want it (Decision 4); no column exists
  to store it.

## Files this v2 will touch

- `apps/customer-app/src/components/location/LocationSheet.tsx` (rectangular search)
- `apps/customer-app/src/screens/profile/AddressMapScreen.tsx` (lollipop pin, exact
  GPS, distance line, Google POIs)
- `apps/customer-app/src/screens/profile/AddressDetailsScreen.tsx` (3 boxes, City/Area
  cards, contact details, Hotel chip)
- `packages/i18n/src/translations.ts` (new strings: 3-box labels/examples, contact
  details, hotel, distance line, tooltip)
- *If Decision 3 = yes:* `packages/types` (DTO), `packages/api-client`, and
  `apps/api` (backend handler + Prisma migration for receiver fields).

## Decisions (LOCKED ✅)

1. **Reverse-geocoding source → Google Geocoding API.** Use the existing Maps key;
   if it's SDK-restricted, the Geocoding API must be enabled for it. Pin coords stay
   exact regardless; this only improves the address *text*.
2. **Contacts-picker icon → add `expo-contacts`.** Phone field opens the device
   address book to autofill receiver name/phone.
3. **Persist receiver details → full backend + migration.** Extend
   `CreateAddressRequest`/`AddressResponse` (`packages/types`) + `api-client` + the
   `apps/api` create/list handlers + a Prisma migration adding `receiverName`,
   `receiverPhone`, `contactType` (myself/other) to the address model.
4. **Serviceability → keep the 5 km Chirawa block AND show the "X km away" line.**
   Also **include** the optional **"Add google maps link"** field (Image #4/#5) —
   needs a column too (store on the address; see migration).

---

## v1 (shipped) — original two-step flow

## The shape of the change

**Before:** one screen (`AddressMapScreen`) mashed a small *draggable* marker, a
"use my location" button, label chips, and House/Landmark/Area text fields into a
single scroll. No resolved address — the user typed everything; coordinates were
saved but never reverse-geocoded.

**After:** the modern **two-step flow** the references use:

1. **Confirm location (map)** — full-bleed map with a **fixed centre pin** the map
   slides under; the pin's coordinates are **reverse-geocoded live** into a
   readable address shown in a bottom card → **Confirm location**.
2. **Add address details (form)** — House/Floor + Building/Block + Landmark, label
   chips, with a "Change" shortcut back to the map → **Save Address**.

---

## Files changed

### 1. `apps/customer-app/src/screens/profile/AddressMapScreen.tsx` — rewritten (step 1)

**What:**
- Replaced the draggable `Marker` with a **fixed centre pin** overlay; the map
  moves under it and `onRegionChangeComplete` captures the pin's lat/lng.
- Added the *"Your order will be delivered here / Move the map to set your exact
  spot"* tooltip above the pin.
- **Reverse-geocodes** the pin via `expo-location`'s native
  `reverseGeocodeAsync` and shows a two-line address (title + full line) in a
  bottom card under a "Delivering your order to" heading.
- "Go to current location" pill (GPS) floating above the card.
- **Serviceability:** distance from Chirawa centre > 5 km shows a warning and
  disables Confirm (kept the existing `MAX_KM`/`distanceKm` logic).
- **Confirm** → navigates to `AddressDetails` with the resolved fields.

**Why:**
- The fixed-pin + bottom-card pattern is what every reference screen uses; it's
  faster and less error-prone than dragging a tiny marker.
- Reverse-geocoding (your choice) means the card shows a real street/area name
  instead of the user typing it blind — matches the references' bottom card.
- Used `expo-location`'s **native** reverse geocoder (not the Google Geocoding
  REST API) so there's **no API key / endpoint dependency** — it works with the
  Maps key already in `app.json` and the location permission already requested.

**Implementation notes / gotchas handled:**
- **Race guard:** a monotonic `reqSeq` ref so a slow geocode for an old pin can't
  overwrite the result for a newer pin.
- **Never-blank card:** on mount we always resolve the default Chirawa centre
  first; `autoLocate` then layers the GPS jump on top. So if GPS is denied or the
  map animation no-ops, the card still shows an address instead of hanging on
  "Finding address…".

**Result:** open → map centred on Chirawa with the pin + address card filled →
drag the map / tap "current location" → address updates live → Confirm carries the
resolved location into step 2. Outside the 5 km zone, Confirm is disabled with a
clear warning.

### 2. `apps/customer-app/src/screens/profile/AddressDetailsScreen.tsx` — new (step 2)

**What:**
- Summary header showing the resolved location + a **"Change"** button (goes back
  to the map).
- Fields: **House No. & Floor** (required), Building & Block (optional), Landmark
  & Area name (optional).
- **Home / Work / Other** label chips (icons + orange active state).
- **Save Address** → `api.createAddress(...)` → pops back to the address list.

**Why:**
- Splitting details into their own step (vs cramming under the map) matches the
  references and keeps each screen focused.
- Mapped onto the **existing** `CreateAddressRequest` DTO — no backend change:
  `street` = House + Building joined, `landmark` = landmark field (falls back to
  the resolved locality), `locality`/`city`/`pincode`/`lat`/`lng` come from the
  geocoded pin, `label` = home/work/other.

**Result:** after confirming the pin, the user fills a short focused form and saves;
the new address appears in the saved-addresses list (which refreshes on focus).

### 3. `apps/customer-app/src/navigation/AppNavigator.tsx`

**What:**
- Registered the new `AddressDetails` screen with typed params
  (`lat, lng, title, subtitle, locality, city, pincode`).
- Made `AddressMap` accept an optional `{ autoLocate?: boolean }` param.
- Updated headers: "Confirm location" (map) / "Add address details" (form).

**Why:** the two-step flow needs a typed route to pass the resolved location
between screens; `autoLocate` lets the location sheet request an immediate GPS jump.

### 4. `apps/customer-app/src/components/location/LocationSheet.tsx`

**What:** split the single `goToMap` handler into two:
- **"Use current location"** → opens the map with `autoLocate: true` (homes in on
  GPS immediately).
- **"Add new address"** → opens the map neutral (Chirawa centre).

**Why:** previously both did the same thing (just opened the map). Now "use current
location" actually means it — one tap instead of two. This was the meaningful
LocationSheet improvement; the rest of the sheet already matched the reference
(search, quick-action card, saved-address cards) so it was left intact.

**Result:** tapping "Use current location" lands the user on the map already
resolving their GPS position.

### 5. `packages/i18n/src/translations.ts`

**What:** added strings (en + hi) under the `address` namespace for the new flow:
`pinTitle, deliverHere, movePin, goToCurrent, locatingAddress, deliveringTo,
confirmLocation, pickedLocation, detailsTitle, change, houseFloor, buildingBlock,
landmarkArea, saveAs, addressSaved`. Old keys (`useMyLocation`, `dragToAdjust`)
left in place (harmless).

**Why:** keep all user-facing copy bilingual and out of the components, per the
app's i18n convention.

---

## Entry points (all now feed the new flow)

- `AddressListScreen` "＋" FAB → `AddressMap` (neutral)
- `ShareAddressScreen` "Add new address" → `AddressMap` (neutral)
- `LocationSheet` → `AddressMap` (neutral or `autoLocate`)

All navigate to the same step-1 map; `AddressMap`'s param is optional so existing
call sites stay valid.

---

## Deliberate omission (decision to revisit)

The Zepto reference (and Bringly's current `3699–3702`) show **Receiver name +
phone** fields on the details form. **Left out on purpose:** `CreateAddressRequest`
has no receiver fields, so building them would **silently drop the data** on save.

**To add them properly** we'd extend the DTO (`packages/types`) + `api-client` +
the backend endpoint, then surface the fields in `AddressDetailsScreen`. Flag this
if receiver-on-address is wanted and we'll wire it end-to-end.

---

## Possible follow-ups

- **Functional search** on the map screen (place autocomplete) — currently omitted
  because there's no Places API wired; the sheet's search only filters saved
  addresses. Would need Google Places Autocomplete (billed) or a local gazetteer.
- **Receiver details** (see above) — needs a backend field.
- **Pin precision:** the centre pin sits at the geometric centre of the full map;
  if the bottom card ever changes height a lot, revisit the `paddingBottom: 180`
  offset that lifts the pin into the visible area above the card.
- **Serviceability polish:** mirror the references' "X km away from your current
  location" line in addition to the in/out-of-zone warning.
  