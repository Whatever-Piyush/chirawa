# BUG-2 — Implementation Report

**Scope:** Surface the assigned rider's **name + phone** in `GET /orders/:id` so the
tracking screen can show the rider card and Call button. **Option A** (manual lookup,
no schema change). BUG-3 untouched.

**Requirements honored:** no schema changes · no migrations · no DTO redesign · no
refactors · only `GET /orders/:id` serialization modified · populates `rider:{name,phone}` ·
regression tests added · typecheck run · affected tests run.

**Status:** Implemented on branch `fix/order-rider-id-identity` (stacked on the committed
BUG-1 fix `6fdad0d`), **uncommitted**. Context7 (Prisma v5) consulted for the
`findUnique` + nested relation-`select` patterns used.

---

## 1. Changed files

| File | Type | Change |
|---|---|---|
| `apps/api/src/modules/orders/orders.service.ts` | modified | `getOrder` populates `rider` from a `RiderProfile` lookup (the only serialization touched) |
| `apps/api/src/modules/orders/__tests__/orders.rider-access.test.ts` | modified | Add `riderProfile` mock + 3 BUG-2 regression tests |

No route change (`GET /:id` already calls `getOrder`). No DTO change (`rider?` already
declared). No client change (the tracking screen already reads `order.rider`). No
schema/migration.

## 2. Exact modification

`orders.service.ts` — `getOrder`, after the existing access check:
```diff
   if (!allowed) throw new ForbiddenError('Not your order');
-  return order;
+
+  // BUG-2: surface the assigned rider's name + phone … Order.riderId is the
+  // RiderProfile.id; phone lives on the linked User. Manual lookup (Option A) —
+  // no schema/relation change. Omitted entirely when unassigned.
+  let rider: { name: string; phone: string } | undefined;
+  if (order.riderId) {
+    const profile = await prisma.riderProfile.findUnique({
+      where:  { id: order.riderId },
+      select: { fullName: true, user: { select: { phone: true } } },
+    });
+    if (profile?.user?.phone) {
+      rider = { name: profile.fullName, phone: profile.user.phone };
+    }
+  }
+
+  return { ...order, rider };
```

**Behavior:**
- `rider` is built only when `order.riderId` is set; `{ ...order, rider }` with
  `rider === undefined` serializes to JSON with **no `rider` key** (Fastify/JSON drops
  `undefined`), so unassigned orders are unchanged.
- Source mapping: `name ← RiderProfile.fullName`, `phone ← RiderProfile.user.phone`
  (existing `RiderProfile.user` relation; `Order.riderId` is the `RiderProfile.id`).
- Defensive: if the profile (or its phone) is missing, `rider` is omitted rather than
  emitting a partial object.
- One extra indexed PK lookup, only when a rider is assigned. (When BUG-1 Phase 2 adds
  the `Order.rider` FK, this can fold into the main query's `include` — noted, not done.)

## 3. API contract

Additive and backward-compatible — it **fulfills** the already-declared optional field
`OrderDetailResponse.rider?: { name; phone }` (`packages/types/src/dto/order.dto.ts:53`).
No DTO change, no version bump, no client change. Internal raw fields the client reads
via its `orderPrisma` cast are left exactly as-is (no DTO redesign / no over-exposure
cleanup — out of scope).

## 4. Test results

### Typecheck (`pnpm --filter @chirawa/api typecheck`)
- **Before BUG-2: 29 errors. After BUG-2: 29 errors → 0 new.** No errors at the `getOrder`
  change or in the test. (The 29 are the pre-existing repo-wide
  `exactOptionalPropertyTypes`/Fastify-handler baseline in untouched modules.)

### Unit tests (`pnpm --filter @chirawa/api exec vitest run src/modules/orders`)
```
✓ orders.rider-access.test.ts   (6)   ← +3 BUG-2 tests (was 3)
✓ orders.cod-collected.test.ts  (5)
✓ orders.delivered.test.ts      (5)
✓ orders.unavailable.test.ts    (5)
✓ orders.release.test.ts        (4)
✓ orders.stock.test.ts          (3)
✓ order-transitions.test.ts     (6)
✓ resolver.service.test.ts      (7)
Test Files  8 passed (8)
     Tests  41 passed (41)
```
New BUG-2 regression tests (in `orders.rider-access.test.ts`):
1. **Populates** `rider: { name, phone }` from `RiderProfile.fullName` + `User.phone`
   when assigned (asserts the lookup is keyed `where: { id: RiderProfile.id }`).
2. **Omits** `rider` and **does not** call the lookup when the order is unassigned
   (`riderId === null`).
3. **Defensively omits** `rider` when the profile lookup returns nothing.

The existing BUG-1 access tests still pass — the added `riderProfile` mock prevents the
new lookup from breaking them, and access gating is unchanged.

### Runtime confirmation (live API, customer GET)
Seeded + assigned one order (real `assignOrder`), then `GET /orders/:id` as the
**customer**. Test rows cleaned up after.

| | Result |
|---|---|
| DB source of truth | `RiderProfile.full_name = "Sunil Yadav"`, `User.phone = "7700110001"` |
| **Before fix** (`BUG_RUNTIME_VERIFICATION.md`) | `has 'rider' key: False` |
| **After fix** | `has 'rider' key: True` · `rider = { "name": "Sunil Yadav", "phone": "7700110001" }` |

The customer now receives the rider's name and phone, matching the DB — the tracking
screen's rider card + Call button (`showRider = !!order.rider`, `order.rider.phone`) will
populate.

## 5. Out of scope (untouched)

- **BUG-3** (no server ETA) — not touched.
- **Number masking** of the rider phone — future privacy enhancement.
- **Full `OrderDetailResponse` serialization** / internal-field over-exposure cleanup /
  DTO drift — separate, client-coordinated task.
- **BUG-1 Phase 2** (rename `riderId → riderProfileId` + FK) — would later let this lookup
  become a relation `include`; not required here.

## 6. Notes
- Changes are **uncommitted** on `fix/order-rider-id-identity`, stacked on the BUG-1
  commit. Ready to commit (here, or on its own branch) on your go-ahead.
- Context7 Prisma v5 consulted (the nested `select: { user: { select: { phone } } }` is
  standard v5 relation selection).
