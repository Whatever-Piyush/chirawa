# BUG-1 Implementation Plan — `Order.riderId` identity fix

**Bug:** `Order.riderId` stores `RiderProfile.id`, but several services compare it
against `User.id` (the JWT subject) → assigned riders get `403` on delivery
completion, COD recording, order list, and order detail. Runtime-verified
(`BUG_RUNTIME_VERIFICATION.md`).

**Council decision (`Option B`, augmented):** keep `RiderProfile.id` as the stored
value (it is the dominant convention — `DeliveryAssignment`, `RiderAvailability`,
`RiderLocation`, `RiderZone`, `RiderSettlement`, `codBalancePaise` all key off it). Fix
the **read/compare sites** to speak `RiderProfile.id`. Then make the column
**unambiguous**: add a real FK relation and **rename it `riderProfileId`** so the wrong
comparison fails to compile. Reject A (relocates the resolve, makes `Order` the lone
off-convention table, needs a write-side prod migration to fix a read bug) and reject
C's denormalized second id (drift hazard).

> **No code is written by this document.** It specifies exact files, changes, migration
> impact, tests, and rollback. Implementation is a follow-up.

**Key enabling fact:** `request.auth.profileId` already exists
(`apps/api/src/shared/middleware/auth.middleware.ts:7-15,38-41`) and, for a rider, the
JWT `profileId` **is** the `RiderProfile.id` (`token.service.ts:154-158`). So the
hotfix needs **no extra DB lookup** — it swaps the value passed into the guards from
`request.auth.userId` to `request.auth.profileId`.

---

## Guiding principle

One namespace for the whole delivery domain: **`RiderProfile.id`**. Resolve the auth
subject (`User.id`) → `RiderProfile.id` exactly once, at the request edge (the JWT
already carries it). Everything downstream — including `Order` — compares in
profile-space.

---

## P0 — Prerequisite (the council's "do this first"): production data audit

**Run before any code/migration.** Read-only. Determine the real state of stored
values, because it gates the FK and tells us whether any backfill is needed (expected:
none — writes already store `RiderProfile.id`).

```sql
-- Distribution of orders.rider_id across the three possibilities
SELECT
  count(*) FILTER (WHERE rider_id IS NULL)                                   AS null_rows,
  count(*) FILTER (WHERE rider_id IN (SELECT id      FROM rider_profiles))   AS is_profile_id,
  count(*) FILTER (WHERE rider_id IN (SELECT user_id FROM rider_profiles))   AS is_user_id,
  count(*) FILTER (WHERE rider_id IS NOT NULL
                     AND rider_id NOT IN (SELECT id FROM rider_profiles))    AS orphan_or_userid
FROM orders;
```

Decision gates:
- **All non-null are `is_profile_id`** (expected) → no backfill; proceed to the FK in Phase 2 directly.
- **Any `is_user_id` / orphan rows** → values are mixed (older buggy writes). Do **not**
  add the FK until those rows are reconciled (map `user_id → rider_profiles.id`, or null
  out true orphans). Capture the exact bad ids first.

---

## Phase 1 — Hotfix (code-only, stops the production-down bug)

**No schema change, no data migration.** Make the four broken read/compare sites use
the `RiderProfile.id` the column actually holds. The value is already available as
`request.auth.profileId`.

### File 1 — `apps/api/src/modules/orders/orders.routes.ts`
Pass `request.auth.profileId` (the rider's `RiderProfile.id`) where these handlers
currently pass `request.auth.userId`:
- `GET /:id` handler (`:67-70`) — pass `profileId` into `getOrder` (new param).
- `GET /` handler (`:51-54`) — pass `profileId` into `getMyOrders` (new param).
- `POST /:id/cod-collected` (`:118-125`) — pass `profileId` (not `userId`) into `codCollected`.
- `POST /:id/delivered` (`:129-135`) — pass `profileId` (not `userId`) into `markDelivered`.

### File 2 — `apps/api/src/modules/orders/orders.service.ts`
Exact comparison fixes (the value compared becomes the `RiderProfile.id`):

| Site | Current (`file:line`) | Change |
|---|---|---|
| `getOrder` rider access | `(role === 'rider' && order.riderId === userId)` `:370` | add a `riderProfileId` param; compare `order.riderId === riderProfileId` |
| `getMyOrders` rider filter | `where = { riderId: userId }` `:383` | rider branch uses `where = { riderId: riderProfileId }` |
| `codCollected` ownership guard | `if (order.riderId !== riderId)` `:602` | rename param → `riderProfileId`; compare `order.riderId !== riderProfileId` |
| `codCollected` balance update | `prisma.riderProfile.update({ where: { userId: riderId } … })` `~:613-616` | **must also change** to `where: { id: riderProfileId }` (this line used the param as a `User.id`; without this the COD ledger update silently no-ops) |
| `codCollected` emit | `emitOrderStatusChanged({ … riderId: riderId … })` `~:621` | pass `riderId: riderProfileId` (now consistent with dispatch emits) |
| `markDelivered` ownership guard | `if (order.riderId !== riderId)` `:634` | rename param → `riderProfileId`; compare `order.riderId !== riderProfileId` |
| `markDelivered` emit | `emitOrderStatusChanged({ … riderId: riderId … })` `~:649` | pass `riderId: riderProfileId` |

> **Why `codCollected` is the trap inside the trap:** that one function uses the param
> **both** as `order.riderId` (needs profile id) **and** as `RiderProfile.userId`
> (needs user id, at the balance update). Switching the balance update to
> `where: { id: riderProfileId }` is mandatory — otherwise the 403 is fixed but the
> COD cash silently stops being ledgered. This is exactly the "next silent bug" the
> Contrarian warned about.

### Not changed in Phase 1 (already correct)
- All write sites already store `RiderProfile.id`: `dispatch.service.ts:117`,
  `batching.service.ts:128`, release→null `orders.service.ts:126`.
- Delivery module (`getActiveDelivery`, `riderAdvance`, `getRiderLocationForOrder`)
  already resolves `userId → RiderProfile.id` and treats `order.riderId` as a profile id
  (`dispatch.service.ts:234` does `riderProfile.findUnique({ where: { id: order.riderId } })`).

**Phase 1 result:** all four endpoints work; no stored data touched; the diff is small
and confined to the orders module.

---

## Phase 2 — Durable fix (schema rename + FK + relation)

Removes the ambiguity that caused the bug so it cannot silently recur. Do this calmly
after Phase 1 and after the P0 audit is clean.

### File 3 — `apps/api/prisma/schema.prisma`
- `model Order`:
  - Rename field `riderId String? @map("rider_id")` (`:536`) → **`riderProfileId String? @map("rider_profile_id")`**.
  - Add relation: **`rider RiderProfile? @relation(fields: [riderProfileId], references: [id])`** (Order currently has NO rider relation — that absence is part of the bug).
  - Update the composite index `@@index([riderId, status])` (`:580`) → `@@index([riderProfileId, status])`.
- `model RiderProfile`: add the back-relation **`orders Order[]`** (it has `assignments`, `riderSettlements`, `zones` but no `orders`).

### Migration (hand-edited — see Migration Impact)
A **column rename** preserving data + an FK constraint:
```sql
ALTER TABLE "orders" RENAME COLUMN "rider_id" TO "rider_profile_id";
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_rider_profile_id_fkey"
  FOREIGN KEY ("rider_profile_id") REFERENCES "rider_profiles"("id");
-- index rename handled by Prisma migration diff
```

### Field-rename cascade (every `Order.riderId` access — generated client renames the property)
After the Prisma rename, `prisma.order.*` no longer has `.riderId`; update each:
- `apps/api/src/modules/orders/orders.service.ts`: `:126` (`data:{riderId:null}`),
  `:370`, `:383`, `:465` (emit read), `:536`, `:594`, `:602`, `:634`, `:706`.
- `apps/api/src/modules/delivery/dispatch.service.ts`: `:82`, `:117` (write), `:228`
  (select), `:232`, `:234`.
- `apps/api/src/modules/delivery/batching.service.ts`: `:128` (write).
- `apps/api/src/modules/payments/payments.service.ts`: `:180` (emit read).
- `apps/api/src/modules/admin/admin.routes.ts`: `:133` (`select: { riderId: true }` on orders).
- Optional cleanup enabled by the FK: replace the manual lookup at
  `dispatch.service.ts:234` with a relation `include`.

> **Do NOT touch** the identically-named `riderId` on other models — `DeliveryAssignment.riderId`,
> `RiderAvailability.riderId`, `RiderZone.riderId`, `RiderSettlement.riderId`,
> `deliveryAssignment.count({ where: { riderId } })` (`dispatch.service.ts:107`,
> `batching.service.ts:101`), `admin.routes.ts:161,168`. These are already
> `RiderProfile.id` and correct.

---

## Migration impact

- **Data:** none, **if** the P0 audit shows all non-null values are already
  `RiderProfile.id` (expected). It is a pure **rename** — values are unchanged.
- **Prisma rename gotcha (critical):** Prisma's migration diff may render a field
  rename as **DROP + ADD** (data loss). Generate with `prisma migrate dev --create-only`
  and **hand-edit** the SQL to `RENAME COLUMN` (as above) before applying. Verify the
  generated SQL says `RENAME`, not `DROP`/`ADD`.
- **FK constraint:** creation fails if any non-null `rider_profile_id` doesn't exist in
  `rider_profiles(id)`. P0 must be clean first. The FK is itself the permanent guard
  against the original class of bug.
- **Generated client:** the `Order.riderId` property is renamed to `riderProfileId`
  everywhere — TypeScript compile errors will pinpoint every missed cascade site (a
  feature, not a risk: the wrong field stops compiling).
- **Deploy ordering (rename is not backward-compatible):**
  - **Recommended (small app, brief window):** deploy Phase 2 as a single coordinated
    release — apply the rename migration and the cascade-renamed code together; old code
    referencing `rider_id` must not run against the renamed column.
  - **Zero-downtime alternative (only if required):** expand-contract — add
    `rider_profile_id` as a new nullable column, dual-write, backfill from `rider_id`,
    switch reads, then drop `rider_id` in a later release. Heavier; likely unnecessary
    at current scale.
- **In-flight orders during deploy:** because Phase 1 already fixed behavior and Phase 2
  only renames, in-flight deliveries keep working; just deploy Phase 2 during a low-order
  window to avoid the brief code/DB skew.

---

## Tests

### Update (these currently encode the wrong assumption / the old field name)
- `apps/api/src/modules/orders/__tests__/orders.delivered.test.ts` — today it sets the
  mock order's `riderId` **and** the call arg to the **same** constant (`RIDER =
  'rider_user_1'`, `:17,20,41`), which is why the bug passed CI. Rewrite to use
  **distinct** `userId` and `riderProfileId` values: assert `markDelivered` **succeeds**
  when the arg equals `order.riderProfileId`, and **403s** when it equals the rider's
  `User.id`. (This test, fixed, would have caught BUG-1.)
- `apps/api/src/modules/orders/__tests__/orders.release.test.ts` — assertion expects
  `data: { riderId: null }` (`:27`) → `riderProfileId: null` after Phase 2.
- `apps/api/src/modules/orders/__tests__/orders.unavailable.test.ts` — mock orders set
  `riderId: …` → `riderProfileId: …` after Phase 2.

### New
- **`codCollected`** unit test (none exists today): COD order, assigned
  `riderProfileId`; passing the matching profile id → status `delivered`,
  `codCollectedPaise` set, and `riderProfile.update` called with `where: { id:
  riderProfileId }` and the increment; passing the rider's `User.id` → 403; non-COD →
  business-rule error.
- **`getMyOrders` (rider)**: returns orders where `riderProfileId === profileId`;
  returns `[]` for a profile with no orders. (Directly covers BUG-1c.)
- **`getOrder` (rider access)**: allowed when `order.riderProfileId === profileId`;
  403 otherwise. (Covers BUG-1e.)
- **Convention/integration guard:** a test that assigns via the real `assignOrder` then
  asserts `order.riderProfileId === deliveryAssignment.riderId` (both `RiderProfile.id`)
  — locks the namespace so the two can never diverge again. (Phase 2 only.)
- **Route-level (optional, high value):** the runtime scenario from
  `BUG_RUNTIME_VERIFICATION.md` as an automated test — assign, then `POST
  /orders/:id/delivered` as the assigned rider → 200 (was 403).

### Commands (per repo)
`pnpm --filter @chirawa/api test` (unit), `pnpm --filter @chirawa/api typecheck` (the
Phase-2 cascade is enforced by the compiler).

---

## Rollback strategy

- **Phase 1 (code-only):** revert the commit. No schema/data change → instant, safe,
  no data implications. This alone restores correct behavior, so it is independently
  shippable and independently revertible.
- **Phase 2 (schema rename + FK):**
  - **Forward fix preferred over rollback** — it's a rename; if a cascade site was
    missed, the compiler/tests catch it pre-deploy.
  - If rollback is needed: reverse migration
    `ALTER TABLE "orders" DROP CONSTRAINT "orders_rider_profile_id_fkey";`
    `ALTER TABLE "orders" RENAME COLUMN "rider_profile_id" TO "rider_id";`
    plus redeploy the pre-rename code. Data-preserving (rename only).
  - Because old code and the renamed column are mutually incompatible, **roll back code
    and schema together**, same as the deploy.
  - Keep the P0 audit output; if reconciliation rows were edited, retain the list of
    changed order ids to reverse if necessary.

---

## Sequencing checklist

1. **P0:** run the audit query on production; confirm all non-null `rider_id` are
   `RiderProfile.id`. Reconcile any stragglers.
2. **Phase 1:** ship the hotfix (routes + orders.service) → production-down bug
   resolved, no migration. Add/repair the `delivered` + `codCollected` + `getMyOrders` +
   `getOrder` tests.
3. **Phase 2:** schema rename + FK + relation + cascade renames + the convention guard
   test, in one coordinated release during a low-order window.

---

## Out of scope (adjacent; do not bundle into BUG-1)

- **BUG-2 (rider not serialized) & DTO drift:** `getOrder` returns the raw Prisma row
  (leaking internal fields incl. `riderId`/`riderProfileId`, missing the `rider` card).
  Fixing serialization is a separate task; note that after Phase 2 the raw passthrough
  leaks `riderProfileId` until that serialization work lands.
- **State-machine bypass:** `codCollected`/`markDelivered` write `status:'delivered'`
  without `assertTransition` — a separate correctness item.
- **Event payload `riderId` semantics:** the `emitOrderStatusChanged` payload field
  `riderId` is `RiderProfile.id` and currently **not used for socket routing**; Phase 1
  incidentally makes the COD/delivered emits consistent with dispatch. No routing change
  intended here.
