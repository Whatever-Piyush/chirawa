# BUG-1 — Phase 1 Implementation Report

**Scope:** Fix **BUG-1 only** (the `Order.riderId` ↔ `User.id` identity mismatch).
No schema changes, no migrations, no refactors. BUG-2 and BUG-3 untouched.
**Approach:** Council-recommended Option B hotfix — keep `RiderProfile.id` as the
stored value; make the read/compare sites speak `RiderProfile.id`, sourced from
`request.auth.profileId` (the rider's `RiderProfile.id`, already in the JWT — zero extra
queries). Phase 2 (column rename + FK) intentionally deferred.

**Status:** Implemented on branch `feat/geo-mappls-switch`, **uncommitted** (no commit
was requested). Context7 consulted for the affected library (Prisma v5) per
`apps/api/CLAUDE.md`.

---

## 1. Changed files

| File | Type | Purpose |
|---|---|---|
| `apps/api/src/modules/orders/orders.routes.ts` | modified | Pass `request.auth.profileId` (rider identity) into the 4 affected handlers; pass `userId` too where the status-history actor is needed |
| `apps/api/src/modules/orders/orders.service.ts` | modified | Compare/query against the `RiderProfile.id`; fix the COD-balance update key; keep `changedById` = `User.id` |
| `apps/api/src/modules/orders/__tests__/orders.delivered.test.ts` | modified | Use **distinct** profile/user ids (old test conflated them); add BUG-1 regression case |
| `apps/api/src/modules/orders/__tests__/orders.cod-collected.test.ts` | **new** | `codCollected` coverage incl. COD-ledger-keyed-by-profile-id + BUG-1 regression |
| `apps/api/src/modules/orders/__tests__/orders.rider-access.test.ts` | **new** | `getOrder` / `getMyOrders` rider-access coverage + BUG-1 regression |

No other files touched. No schema/migration files. The identically-named `riderId` on
`DeliveryAssignment`, `RiderAvailability`, etc. was **not** modified (those are already
`RiderProfile.id` and correct).

---

## 2. Exact modifications

### `orders.routes.ts` (4 call sites)
```diff
- getMyOrders(request.auth!.userId, request.auth!.role)
+ getMyOrders(request.auth!.userId, request.auth!.role, request.auth!.profileId)

- getOrder(request.params.id, request.auth!.userId, request.auth!.role)
+ getOrder(request.params.id, request.auth!.userId, request.auth!.role, request.auth!.profileId)

- codCollected(request.params.id, request.auth!.userId, amountPaise)
+ codCollected(request.params.id, request.auth!.profileId, amountPaise, request.auth!.userId)

- markDelivered(request.params.id, request.auth!.userId)
+ markDelivered(request.params.id, request.auth!.profileId, request.auth!.userId)
```

### `orders.service.ts`
**`getOrder`** — accept `riderProfileId`; compare against it:
```diff
- async function getOrder(orderId: string, userId: string, role: string) {
+ async function getOrder(orderId: string, userId: string, role: string, riderProfileId: string) {
  ...
-     (role === 'rider'    && order.riderId === userId) ||
+     (role === 'rider'    && order.riderId === riderProfileId) ||
```

**`getMyOrders`** — accept `riderProfileId`; filter by it:
```diff
- async function getMyOrders(userId: string, role: string) {
+ async function getMyOrders(userId: string, role: string, riderProfileId: string) {
  ...
-     where = { riderId: userId };
+     where = { riderId: riderProfileId };   // Order stores RiderProfile.id
```

**`codCollected`** — the core fix, including the COD-ledger key (`where: { userId }` →
`where: { id }`) and keeping the history actor as the `User.id`:
```diff
- async function codCollected(orderId: string, riderId: string, amountPaise: number) {
+ async function codCollected(orderId: string, riderProfileId: string, amountPaise: number, riderUserId: string) {
-     if (order.riderId !== riderId) throw new ForbiddenError('Not your delivery');
+     if (order.riderId !== riderProfileId) throw new ForbiddenError('Not your delivery');
  ...
-       data: { orderId, status: 'delivered', changedByRole: 'rider', changedById: riderId },
+       data: { orderId, status: 'delivered', changedByRole: 'rider', changedById: riderUserId },
-       prisma.riderProfile.update({ where: { userId: riderId }, … })
+       prisma.riderProfile.update({ where: { id: riderProfileId }, … })
  ...
-       shopId: order.shopId, sellerId: '', riderId, customerId: order.customerId,
+       shopId: order.shopId, sellerId: '', riderId: riderProfileId, customerId: order.customerId,
```

**`markDelivered`** — same ownership-guard fix; history actor stays `User.id`; emit uses
the profile id:
```diff
- async function markDelivered(orderId: string, riderId: string) {
+ async function markDelivered(orderId: string, riderProfileId: string, riderUserId: string) {
-     if (order.riderId !== riderId) throw new ForbiddenError('Not your delivery');
+     if (order.riderId !== riderProfileId) throw new ForbiddenError('Not your delivery');
  ...
-       data: { orderId, status: 'delivered', changedByRole: 'rider', changedById: riderId },
+       data: { orderId, status: 'delivered', changedByRole: 'rider', changedById: riderUserId },
  ...
-       shopId: order.shopId, sellerId: '', riderId, customerId: order.customerId,
+       shopId: order.shopId, sellerId: '', riderId: riderProfileId, customerId: order.customerId,
```

**Why the extra `riderUserId` parameter:** `OrderStatusHistory.changedById` is the
acting **User.id** everywhere in the codebase (`dispatch.service.ts:209`,
`orders.service.ts:307`). Ownership/COD-balance must key off `RiderProfile.id`, but the
history actor must remain the `User.id`. Both ids are already on `request.auth`, so the
route passes both — no DB lookup added. Side benefit: the `delivered`/`cod-collected`
broadcast `riderId` is now `RiderProfile.id`, consistent with the dispatch emits.

---

## 3. Test results

### Typecheck (`pnpm --filter @chirawa/api typecheck`)
- **True baseline (all BUG-1 changes removed): 29 errors.**
- **With BUG-1 changes: 29 errors.**
- **Net new type errors introduced by this fix: 0.** My edited lines and the two new
  test files are type-clean (verified by grep — no errors at the changed logic or in
  the new tests).
- The 29 errors are a **pre-existing, repo-wide baseline** (`exactOptionalPropertyTypes`
  + Fastify generic route-handler pattern + some Prisma input types) across modules I
  did not touch — `payments`, `pricing`, `auth`, `cart`, `notifications`, `catalog`, and
  pre-existing lines in `orders.*`. The orders.service errors are at lines
  304/452/461/538/596/714 — none are BUG-1 logic; they merely shifted by the lines my
  comments/signatures added. Fixing them is out of scope (no refactors).

### Unit tests (`pnpm --filter @chirawa/api exec vitest run src/modules/orders`)
```
✓ orders.rider-access.test.ts   (3)   ← new
✓ orders.cod-collected.test.ts  (5)   ← new
✓ orders.delivered.test.ts      (5)   ← updated (+BUG-1 regression)
✓ orders.unavailable.test.ts    (5)
✓ orders.release.test.ts        (4)
✓ orders.stock.test.ts          (3)
✓ order-transitions.test.ts     (6)
✓ resolver.service.test.ts      (7)
Test Files  8 passed (8)
     Tests  38 passed (38)
```
New/expanded assertions of note:
- `cod-collected`: the COD balance is credited via `where: { id: RiderProfile.id }`
  (the silent-no-op fix), and `changedById` is the `User.id`.
- `delivered` + `cod-collected`: explicit **BUG-1 regression** test — passing the rider
  `User.id` (what the buggy route did) is rejected.
- `rider-access`: `getOrder` allows the assigned rider by `RiderProfile.id` and 403s on
  `User.id`; `getMyOrders` filters by `RiderProfile.id`.

> **Honest scope note:** these are **service-level** tests — they lock the service
> contract (compare/ledger by profile id, history by user id). BUG-1 itself was a
> **route-wiring** defect (the route passed `userId`). There is no route/integration
> test harness in the repo, so the definitive end-to-end proof of the wiring is the
> runtime re-verification below (adding a route test harness would be a refactor, out of
> scope for this fix).

---

## 4. Runtime verification plan

Re-run the exact scenario from `BUG_RUNTIME_VERIFICATION.md` against a running API to
confirm the wiring end-to-end. Pre-fix these returned `403`; post-fix they must succeed.

**Setup (real, as before):** API on `:3000` (`NODE_ENV=development`), Postgres+Redis up.
OTP-login (dev code `123456`) the seeded rider `7700110001`, customer `9680599889`,
admin `9999900001`. Seed one `upi` + one `cod` order for the customer at "Chirawa Store",
then assign each via the real `POST /delivery/orders/:id/assign` (admin) — this writes
`orders.rider_id = RiderProfile.id`. Clean up the test rows afterward.

**Assertions (post-fix expected):**

| # | Request (as rider unless noted) | Pre-fix | Post-fix expected |
|---|---|---|---|
| 1 | `POST /orders/{prepaid}/delivered` | `403 Not your delivery` | **200**, order → `delivered`, `deliveredAt` set |
| 2 | `POST /orders/{cod}/cod-collected` `{amountPaise}` | `403` | **200**, order → `delivered`, **and `rider_profiles.cod_balance_paise` incremented** (verify in DB — the ledger fix) |
| 3 | `GET /orders` (rider) | `[]` | **contains both assigned orders** |
| 4 | `GET /orders/{prepaid}` (rider) | `403 Not your order` | **200** |
| 5 | `GET /delivery/active` (rider) | shows the orders | unchanged — still shows them (regression check) |
| 6 | `OrderStatusHistory` for the delivered order | — | one `delivered` row with `changed_by_id` = rider **User.id** |

**Pass criteria:** rows 1–4 flip from `403`/empty to success; row 2's COD balance
actually moves (proves `where: { id }` ledger fix); rows 5–6 confirm nothing regressed.
A scripted version of this (login → seed → assign → assert → cleanup) can be run the same
way the original verification was, against the live dev API; production should be smoke-
tested with one real assigned order after deploy.

---

## 5. Out of scope (untouched, per requirements)

- **BUG-2** (rider not serialized into `getOrder`) and **BUG-3** (no server ETA) — not
  touched.
- **Phase 2** (rename `riderId` → `riderProfileId`, add FK `Order.rider → RiderProfile`)
  — deferred; no schema/migration in this change.
- **Pre-existing typecheck baseline** (29 errors in other modules) — left as-is (no
  refactors).
- **`assertTransition` bypass** in `codCollected`/`markDelivered` — separate finding,
  not addressed here.

## 6. Notes
- **Context7:** queried Prisma v5 docs (`/prisma/prisma`) before editing — confirmed the
  `update({ where: { id }, … })` unique-update shape and the `where: { field: undefined }`
  match-all footgun (mitigated: `riderProfileId` is a required param and the route always
  supplies `request.auth.profileId`).
- **No commit made** — changes are staged in the working tree on `feat/geo-mappls-switch`;
  say the word to commit/PR.
