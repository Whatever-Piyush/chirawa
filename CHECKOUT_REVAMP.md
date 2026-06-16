# 🧾 Checkout revamp + working address picker (Blinkit-style)

> **Files in play**
> - `apps/customer-app/src/screens/orders/CheckoutScreen.tsx` (main)
> - `apps/customer-app/src/components/location/LocationSheet.tsx` (reused for the picker — 1.jpeg)
> - `apps/customer-app/src/screens/profile/AddAddressScreen.tsx` (**NEW** — 2.jpeg)
> - `apps/customer-app/src/navigation/AppNavigator.tsx` (register `AddAddress`)
> - `packages/i18n/src/translations.ts` (new keys)
>
> **References:** `ss/1.jpeg` (Select delivery location sheet), `ss/2.jpeg` (Add address details page).

---

## 0. The asks (verbatim → decoded)

| # | Ask | Decode |
|---|-----|--------|
| 2 | "Order for {name}, {number}" line should be **same & consistent — bold** | Today "Order for" is muted grey, the name+phone is bold → mixed. Make the **whole line one consistent bold style**. |
| 3 | Put **"Delivery in 20 minutes"**, nicer clock icon; items + delivery section look **separated — make them one** | Change copy 30→**20 min**. Replace the thin `time-outline` with a filled, badged clock. **Merge** the delivery-time header and the item list into **one continuous card** (no visual gap). |
| 4 | **Remove** Delivery instructions **and** Tip-your-partner sections | Delete both blocks + their state/handlers/styles. |
| 5 | **Remove** Promo code section | Delete block + promo state/handlers/styles + the bill "discount" row that depends on it. |
| 6 | **Address:** the bottom "select delivery address / Change" does nothing → make it open a picker like **1.jpeg** (Add-new + WhatsApp request + saved — **no Zomato**). "Add new address" opens an **add-address page like 2.jpeg** in our theme. Also remove the big inline address section in the body. | Wire sticky **Change → `LocationSheet`** (already matches 1.jpeg). Selecting an address sets the checkout address. **Add-new → new `AddAddressScreen`** (2.jpeg). Delete the inline body address section + its add-form. |

---

## 1. Research — what the two reference screens are

### 1.jpeg — "Select delivery location" sheet (Blinkit)
A bottom sheet over the dimmed checkout:
- (top) a **"location not enabled"** info banner with an **Enable** chip *(nice-to-have)*.
- **＋ Add new address** row.
- **🟢 Request address from someone else** (WhatsApp) row.
- ~~Import your addresses from Zomato~~ → **user said drop this**.
- **"Your saved addresses"** list (name, full address, phone, select).

➡️ **We already have this**: `LocationSheet.tsx` renders exactly Add-new + WhatsApp-request + saved addresses, and has **no Zomato import**. It currently also shows a search box + "Use current location" row (used by Home). For checkout we pass a `compact` flag to hide those two extras so it matches 1.jpeg ("just the whatsapp wala section and add new address").

### 2.jpeg — "Add address details" page (Blinkit)
A full screen:
- Header: ‹ back · **"Add address details"**.
- Pink banner: **"Adding address at your current location? Enable it to auto-fill"** + **Enable**.
- **Address details** card: **City** (Change), **Area, street** (Change), **House No./Tower/Floor** input.
- **Contact details** card: **Myself / Someone else** radio → **Receiver's name** + **Receiver's phone**.
- Sticky **Next** button.

➡️ **Adapt to Chirawa** (single-town grocery, theme = cream/orange):
- City is fixed → show a **read-only "City · Chirawa"** row (no picker).
- "Enable" → `expo-location` GPS + `reverseGeocodeAsync` to **prefill Area** (best-effort; already use expo-location in `AddressMapScreen`).
- Keep **House/Flat no** + **Area/Mohalla** inputs + our **Home/Shop/Other** label chips.
- **Contact details**: Myself (default) / Someone else → receiver name + phone.
- Sticky **Save / Next**.

> Sources (q-commerce card/checkout conventions): the two app screenshots in `ss/`, plus the prior research in `PRODUCT_CARD_ADD_BUTTON.md` (Blinkit/Zepto patterns).

---

## 2. Data model reality (important)

- `CreateAddressRequest` = `{ label, street, landmark, locality, city, pincode, lat, lng }` — **no receiver fields.** Address is "where".
- **Receiver name/phone is per-ORDER**: `api.updateOrderReceiver(orderId, name, phone)` (PATCH `/orders/:id/receiver`, allowed before pickup).

➡️ So "Someone else" on the add-address page is captured and **applied to the order after `placeOrder`** (best-effort PATCH; a failure never blocks the order). It flows back to Checkout via navigation params.

---

## 3. Implementation plan

### 3.1 `LocationSheet.tsx`
- Add props: `compact?: boolean` (hide search + "Use current location" → checkout/1.jpeg look) and `onSelectAddress?: (a: AddressResponse) => void`.
- When `onSelectAddress` is set, tapping a saved address calls it (sets checkout address) **and** closes — instead of only `setDefaultAddress`. (Home behavior unchanged when the prop is absent.)
- Point **Add new** → `navigation.navigate('AddAddress')` (was `AddressMap`). "Use current location" (Home only) still → `AddressMap`.

### 3.2 `AddAddressScreen.tsx` (NEW) — 2.jpeg in Chirawa theme
- Header title "Add address details".
- Location banner (Enable → GPS prefill, tolerant).
- Address details card: read-only **City · Chirawa**, **Area/Mohalla** input, **House/Flat no** input, label chips.
- Contact details card: **Myself / Someone else** → receiver name + phone.
- Sticky **Save** → `api.createAddress(...)`; then `navigation.navigate('Checkout', { newAddressId, receiverName?, receiverPhone? })`.

### 3.3 `AppNavigator.tsx`
- `RootStackParamList`: `AddAddress: undefined`; `Checkout: { newAddressId?: string; receiverName?: string; receiverPhone?: string } | undefined`.
- Register `<Stack.Screen name="AddAddress" ... headerTitle="Add address details">`.

### 3.4 `CheckoutScreen.tsx` — the big one
**Remove:** Delivery-instructions block, Tip block, Promo block, the inline **Delivery Address** body section + add-form; and all their state (`tip`, `customTipOpen`, `instructions`, `promo*`, `street/area/landmark/label`, `showAddressForm`, focus states) + handlers (`toggleInstruction`, `applyPromo`, `removePromo`, `handleConfirmAddress`) + styles + the discount bill row.

**#2 Order-for:** one consistent bold line — `Order for <name>, <phone>` all bold/`textPrimary`.

**#3 Delivery + items = one card:**
- New copy `checkout.deliveryIn20Mins`.
- Clock: filled `Ionicons "time"` in a rounded primary-tint badge (premium).
- Render the delivery-time header **and** the item rows inside **one bordered card** (header → divider → item rows). Cleanest via a small refactor of the list region into a single card (keep FlatList for the items but wrap header+rows visually, or map rows inside the card).

**#6 Address wiring:**
- Sticky **Change / select address** → open `LocationSheet` (`compact`, `onSelectAddress` sets `addressId` + refreshes pricing).
- Read route params on focus: if `newAddressId`, select it; stash `receiverName/Phone`.
- After `placeOrder`, if a receiver was provided, best-effort `api.updateOrderReceiver(orderId, name, phone)`.
- Keep the existing **closed-hours gate** on Place Order (unchanged).

### 3.5 i18n (`translations.ts`)
Add: `checkout.deliveryIn20Mins`; `address.addressDetailsTitle`, `address.cityLabel`, `address.contactDetails`, `address.myself`, `address.someoneElse`, `address.next`, `address.enableLocTitle`, `address.enableLocSub`, `address.enable`, `address.houseNoPlaceholder`. Reuse existing `address.houseNo/areaLabel/receiverNamePh/receiverPhonePh`, `locationSheet.*`.

---

## 4. Done-when
- [x] "Order for …" line is one consistent bold line.
- [x] "Delivery in 20 minutes" with a filled badged clock (white clock on a primary disc); delivery header + items are **one cohesive bordered card** (header → item rows → rounded cap).
- [x] Delivery-instructions, Tip, Promo sections **gone** (state/handlers/discount-row removed; orphan styles left dead-but-harmless).
- [x] Inline body address section **gone**; sticky **Change** opens `LocationSheet` (`compact`: Add-new + WhatsApp + saved, **no Zomato**, no search/use-current); selecting sets the delivery address + refreshes pricing.
- [x] **Add new address** → new `AddAddressScreen` (2.jpeg in Chirawa theme); saving returns to Checkout, auto-selects it; "Someone else" receiver best-effort `updateOrderReceiver` after placement.
- [x] Place-Order still gated to open hours; `tsc --noEmit` clean (0 errors); no new deps (expo-location already used by `AddressMapScreen`).

**Note:** verified by type-check + static review; not yet run on a device/emulator.

---

## 5. Out of scope / follow-ups
- City/Area "Change" pickers (we're single-town Chirawa) — shown read-only.
- Reverse-geocode accuracy / map pin on the add page (kept lightweight; `AddressMap` still exists for map-based add).
- Persisting "Someone else" as a reusable contact (currently per-order only).
