# BUG-2 Implementation Plan — surface rider details in `GET /orders/:id`

**Bug:** `OrderDetailResponse.rider?: { name; phone }` is declared
(`packages/types/src/dto/order.dto.ts:53-56`) but `getOrder` returns the raw Prisma
order and never populates it (`apps/api/src/modules/orders/orders.service.ts:353-375`).
So on the tracking screen `showRider = !!order.rider` and `riderPhone =
order.rider?.phone` are always falsy — the **rider card and Call button never render**.
Runtime-confirmed in `BUG_RUNTIME_VERIFICATION.md` (`has 'rider' key: False` while a
rider is assigned).

**Goal:** `GET /orders/:id` returns the assigned rider's **name + phone** to the
customer, so the tracking screen can show the rider card and enable the call.

> **No code is written by this document.** It specifies the contract change, the DB
> relation analysis, the implementation shape, and the tests. Implementation is a
> follow-up. Scope is **BUG-2 only** — BUG-3 (ETA) is untouched.

---

## 1. Key finding — the client is already ready

`OrderTrackingScreen` already consumes the exact shape we need; it just gets `undefined`
today:
- `const showRider = !!order.rider && (…)` (`OrderTrackingScreen.tsx:626`)
- `riderInitial = (order.rider?.name?.[0] ?? 'R')…` (`:631`)
- `riderPhone = (order.rider as { phone?: string } | null)?.phone ?? null` (`:648`)
- rider card render: `{showRider && order.rider && (… order.rider.name …)}` (`:742,:749`)

So **BUG-2 is a server-only change.** No client changes are required to make the rider
card/Call button work — populating `order.rider` is sufficient.

## 2. Data source (where name + phone come from)

`Order.riderId` holds the **`RiderProfile.id`** (per BUG-1). The rider's display data:
- **name** → `RiderProfile.fullName` (`schema.prisma:180`)
- **phone** → `RiderProfile.user.phone` via the existing `RiderProfile.user` relation
  (`schema.prisma:193`) → `User.phone` (`schema.prisma:108`)

`Order` has **no** `rider` relation (bare `String?` column), so the join is not available
on the order query as-is — see §4.

---

## 3. API contract changes

**Change:** `GET /api/v1/orders/:id` response gains an optional `rider` object **when a
rider is assigned**:
```jsonc
"rider": { "name": "Ramesh Kumar", "phone": "7700110001" }   // omitted when unassigned
```

**Impact analysis:**
- **Backward-compatible / additive.** The field is already declared optional in
  `OrderDetailResponse` (`order.dto.ts:53`). We are *fulfilling* an existing contract,
  not changing its shape. No version bump, no breaking change.
- **No client change required** (§1). The api-client already types `getOrder(): Promise<OrderDetailResponse>`
  (`packages/api-client/src/index.ts:401-402`).
- **Presence rule:** include `rider` only when `order.riderId` is set (assignment onward).
  Absent for `pending_payment → ready_for_pickup` pre-assignment. The client's `showRider`
  also gates on status, so the server can safely return it as soon as it exists.
- **Authorized viewers:** `getOrder` already gates access (customer owns the order, or the
  assigned rider, or admin/seller of the shop — `orders.service.ts:367-373`). The `rider`
  object rides along for whoever is already authorized to read the order. (If we ever want
  to hide the rider phone from the seller, that's a future scoping refinement — not
  required for BUG-2.)

**Scope decision — minimal append vs. full DTO serialization:**
- `getOrder` currently returns the **raw Prisma row**, and the client deliberately reads
  many raw fields through an `orderPrisma` cast (`OrderTrackingScreen.tsx:604-669`:
  `deliveryStreet/Lat/Lng`, `totalAmount`, `rating`, `receiverName/Phone`,
  `paymentMethod`, …). A full rewrite to the clean `OrderDetailResponse` shape
  (`cartSubtotal`/`total`/`deliveryAddress`, dropping internal fields) **would break
  those reads** and require a coordinated client change.
- **Recommendation:** for BUG-2, **append `rider` to the existing (raw) response** — the
  smallest change that satisfies the requirement and does not break the client.
- The broader DTO-drift + internal-field over-exposure cleanup (the raw passthrough leaks
  `riderId`, `feeRuleVersion`, `distanceSource`, …) is a **separate, larger task** that
  must update the client's `orderPrisma` casts in lockstep. Tracked as out-of-scope (§9).

**Privacy note (out of scope, flag for later):** this returns the rider's **real**
phone, per the requirement. Number-masking (a privacy proxy) is a Phase-2 enhancement
noted in `TRACKING_PAGE_RESEARCH.md` — not part of BUG-2.

---

## 4. Database relation changes

Two ways to obtain `fullName` + `user.phone` from `order.riderId`:

### Option A — no schema change (recommended for BUG-2)
After loading the order in `getOrder`, if `order.riderId` is set, do one extra lookup:
```
prisma.riderProfile.findUnique({
  where: { id: order.riderId },
  select: { fullName: true, user: { select: { phone: true } } },
})
```
then attach `rider: { name: fullName, phone: user.phone }`.
- Uses the **existing** `RiderProfile.user` relation — **zero migration**.
- One extra indexed PK lookup, **only when a rider is assigned** (negligible; `getOrder`
  is the tracking-detail endpoint).
- **Independent of BUG-1 Phase 2** (the `riderId → riderProfileId` rename + FK), so BUG-2
  can ship now without waiting on that migration.

### Option B — add the FK relation (couple with BUG-1 Phase 2)
Add `Order.rider RiderProfile? @relation(fields: [riderProfileId], references: [id])`
(the BUG-1 Phase-2 change) and fetch in the **single** order query:
```
include: { rider: { select: { fullName: true, user: { select: { phone: true } } } }, … }
```
- Cleaner, no extra round-trip.
- **Requires** the Phase-2 schema migration (rename + FK). Do **not** introduce a
  migration solely for BUG-2.

**Recommendation:** ship BUG-2 with **Option A** now; when BUG-1 Phase 2 lands, refactor
the manual lookup into the relation `include` (drop the extra query). No standalone DB
relation change is introduced by BUG-2 itself.

---

## 5. Implementation shape (no code yet)

Single file: `apps/api/src/modules/orders/orders.service.ts`, function `getOrder`:
1. Keep the existing query + access check unchanged.
2. After the `allowed` check, if `order.riderId`:
   - look up the rider profile (Option A), and
   - build `rider = { name: profile.fullName, phone: profile.user.phone }`.
3. Return `{ ...order, rider }` (rider `undefined`/omitted when unassigned or the profile
   lookup yields nothing).

Edge cases to handle:
- `order.riderId == null` (pre-assignment) → no `rider` key.
- profile or `user.phone` missing (data integrity / deleted rider) → omit `rider`
  defensively rather than emit a partial object.

No route change (`orders.routes.ts` `GET /:id` already calls `getOrder`). No DTO change
(field already declared). No client change.

---

## 6. Regression tests

`apps/api/src/modules/orders/__tests__/` — extend the existing mock-prisma pattern
(see `orders.rider-access.test.ts`). The mock adds `prisma.riderProfile.findUnique`
returning `{ fullName, user: { phone } }`.

New cases (new file e.g. `orders.get-order-rider.test.ts`, or extend `orders.rider-access.test.ts`):
1. **Populates rider when assigned:** order with `riderId = RiderProfile.id` → response has
   `rider: { name: <fullName>, phone: <user.phone> }`, sourced from the profile lookup.
2. **Omits rider when unassigned:** `riderId = null` → response has **no** `rider` key,
   and the rider lookup is **not** called.
3. **Defensive omit:** `riderId` set but profile lookup returns `null` (or no
   `user.phone`) → response has no `rider` key (no partial/`undefined`-field object).
4. **Access unchanged (regression guard):** the BUG-1 access checks still hold — customer
   who owns the order gets the order (now with `rider`); a non-owner still 403s. (Already
   covered by `orders.rider-access.test.ts`; assert the `rider` field doesn't alter
   gating.)

**Runtime verification (end-to-end):** reuse the harness from
`POST_FIX_RUNTIME_VERIFICATION.md` — as the **customer**, `GET /orders/:id` for an
assigned order and assert `rider.name` and `rider.phone` are present and correct (the
pre-fix check was `has 'rider' key: False`). Confirms the route → service → client shape.

---

## 7. Dependencies & sequencing

- **Independent of BUG-1 Phase 1** (already shipped on `fix/order-rider-id-identity`) and
  of BUG-1 Phase 2 (the FK migration) when using Option A.
- Correctness of the *name/phone lookup* relies on `order.riderId` holding the
  `RiderProfile.id` — which BUG-1 confirmed and preserved. (BUG-1 fixed the *comparison*
  sites; it did not change what the column stores.)
- If BUG-1 Phase 2 ships first, prefer Option B (relation `include`) and skip the extra
  query.

## 8. Rollback

Code-only, additive, no schema change → revert the single-function change. Because the
field is optional and the client tolerates its absence, reverting simply returns the
rider card to its current (hidden) state. Zero data/migration implications.

## 9. Out of scope (do not bundle into BUG-2)

- **BUG-3** (no server ETA) — untouched.
- **Number masking** of the rider phone — future privacy enhancement.
- **Full `OrderDetailResponse` serialization** + stop leaking internal fields
  (`riderId`, `feeRuleVersion`, `distanceSource`, raw `deliveryLat/Lng`, etc.) and align
  `cartSubtotal`/`total`/`deliveryAddress` with the DTO — a larger, **client-coordinated**
  refactor (the client currently reads raw fields via `orderPrisma`). Tracked separately.
- **BUG-1 Phase 2** (rename `riderId → riderProfileId` + FK) — referenced as the eventual
  home for Option B, but not required by BUG-2.
