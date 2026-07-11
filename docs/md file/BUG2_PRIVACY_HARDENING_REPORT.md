# BUG-2 — Privacy Hardening Report

**Scope:** Tighten the rider-detail exposure introduced by BUG-2 so the rider's personal
PII (name + **phone**) is returned only when operationally needed. Implements the
skeptical-review findings (#3 seller leakage, #4 privacy window, #5 pre-pickup, #6
delivered-forever, + availability coupling). **Only `GET /orders/:id` serialization
changed.** No schema, no migration, no DTO change. BUG-3 untouched.

**Rule implemented:** expose `rider: { name, phone }` **iff**
- `order.status === picked_up` **OR** `order.status === out_for_delivery`, **AND**
- viewer role ∈ { `customer`, `rider`, `admin` } (never `seller`), **AND**
- a rider is assigned.
Otherwise `rider` is omitted. The lookup is **best-effort** — a failure cannot break
order retrieval.

**Status:** Implemented on `fix/order-rider-id-identity` (on top of BUG-1 `6fdad0d` +
the BUG-2 Option A change), **uncommitted**. Context7 (Prisma v5) consulted.

---

## 1. Changed files

| File | Change |
|---|---|
| `apps/api/src/modules/orders/orders.service.ts` | `getOrder` now gates the rider block by status + role and wraps the lookup in `try/catch` |
| `apps/api/src/modules/orders/__tests__/orders.rider-access.test.ts` | Expanded to 16 tests covering the status/role gates, edge cases, and the defensive failure path |

## 2. Exact modification (`getOrder`)
```diff
   if (!allowed) throw new ForbiddenError('Not your order');
-  return order;
+
+  // …expose rider ONLY during active delivery (picked_up / out_for_delivery) and
+  // ONLY to customer / rider / admin — never seller, never pre-pickup, never on a
+  // terminal order. Lookup is best-effort: a failure must NOT break order retrieval.
+  const riderInActiveDelivery =
+    order.status === 'picked_up' || order.status === 'out_for_delivery';
+  const viewerMaySeeRider =
+    role === 'customer' || role === 'rider' || role === 'admin';
+
+  let rider: { name: string; phone: string } | undefined;
+  if (order.riderId && riderInActiveDelivery && viewerMaySeeRider) {
+    try {
+      const profile = await prisma.riderProfile.findUnique({
+        where:  { id: order.riderId },
+        select: { fullName: true, user: { select: { phone: true } } },
+      });
+      if (profile?.user?.phone) {
+        rider = { name: profile.fullName, phone: profile.user.phone };
+      }
+    } catch {
+      /* best-effort: a rider-lookup failure must not fail order retrieval */
+    }
+  }
+
+  return { ...order, rider };
```

**How this resolves each review finding:**
- **#3 seller leakage** → `viewerMaySeeRider` excludes `seller`; the seller still reads
  the order (authorization unchanged) but never the rider's phone.
- **#5 pre-pickup** → `riderInActiveDelivery` requires `picked_up`/`out_for_delivery`, so
  nothing is returned during `confirmed`/`preparing`/`ready_for_pickup`.
- **#6 delivered-forever** → `delivered` is excluded; `cancelled` already nulls `riderId`
  (all three cancel paths release the rider) and is excluded for defense-in-depth.
- **#4 privacy window** → exposure is now bounded to the active-delivery window for
  authorized viewers. (Full **number masking** remains a separate, larger follow-up.)
- **Availability coupling** → the lookup is wrapped in `try/catch`; a DB hiccup on the
  rider fetch degrades to "no rider" instead of failing the whole order read.
- **Perf bonus** → the extra query is skipped entirely outside the active window / for
  sellers (the gate short-circuits before the DB call).

The presence rule (`{ ...order, rider }` with `rider === undefined` → key omitted in
JSON) is unchanged; only *when* `rider` is built is narrowed.

## 3. Test results

### Typecheck (`pnpm --filter @chirawa/api typecheck`)
**29 → 29 — zero new errors.** (Pre-existing repo-wide baseline in untouched modules.)
A transient `30` during development was a test-only cast (`order.id` on a narrowed type)
and was fixed before finalizing.

### Unit tests (`pnpm --filter @chirawa/api exec vitest run src/modules/orders`)
```
✓ orders.rider-access.test.ts   (16)  ← expanded
✓ orders.cod-collected.test.ts  (5)
✓ orders.delivered.test.ts      (5)
✓ orders.unavailable.test.ts    (5)
✓ orders.release.test.ts        (4)
✓ orders.stock.test.ts          (3)
✓ order-transitions.test.ts     (6)
✓ resolver.service.test.ts      (7)
Test Files  8 passed (8)
     Tests  51 passed (51)
```
New/expanded `orders.rider-access.test.ts` coverage:
- **Exposed:** customer during `picked_up` and `out_for_delivery` (parametrized); admin;
  the assigned rider — `rider = { name, phone }`, lookup keyed `where: { id: RiderProfile.id }`.
- **Hidden by status (and lookup skipped):** `confirmed`, `preparing`, `ready_for_pickup`,
  `delivered`, `cancelled` (parametrized).
- **Hidden by role (and lookup skipped):** `seller` — still authorized to read the order,
  but `rider` is absent.
- **Edge cases:** unassigned order (no lookup); profile lookup returns nothing (omit);
  **lookup throws → order still returned, no throw** (defensive path).

### Runtime confirmation (live API, real OTP login, cleaned up)
One assigned order (`rider_id = RiderProfile.id`), varied across statuses/viewers.
DB source of truth: `RiderProfile.fullName = "Sunil Yadav"`, `User.phone = "7700110001"`.

| status | viewer | `rider` in response |
|---|---|---|
| `out_for_delivery` | customer | `{ name: "Sunil Yadav", phone: "7700110001" }` ✅ |
| `out_for_delivery` | **seller** | **absent** ✅ (role gate) |
| `picked_up` | customer | `{ name, phone }` ✅ |
| `preparing` | customer | **absent** ✅ (status gate) |
| `confirmed` | customer | **absent** ✅ |
| `delivered` | customer | **absent** ✅ (terminal) |
| `cancelled` | customer | **absent** ✅ (terminal) |

Matches the spec exactly. (Note: the live seller `9001110001` is 10-digit, so OTP login
worked — the role gate is proven over real HTTP, not just in unit tests.)

## 4. Out of scope (untouched)
- **BUG-3** (no server ETA).
- **Number masking** of the rider phone — the larger privacy follow-up; this change only
  *bounds the window* in which the real number is exposed.
- **DTO serialization / internal-field over-exposure** cleanup (raw passthrough) — separate,
  client-coordinated task.
- **BUG-1 Phase 2** (FK + rename) — would let the lookup fold into a relation `include`.

## 5. Notes
- Behaviour preserved for the customer's real need: they still get the rider's name +
  phone exactly when coordinating an in-progress delivery (`picked_up` / `out_for_delivery`),
  matching the client's existing `showRider` display condition.
- Changes are **uncommitted** on `fix/order-rider-id-identity`. The working tree now holds:
  BUG-1 (committed) + BUG-2 Option A + this hardening (uncommitted). Ready to commit on
  your go-ahead (the BUG-2 + hardening could be one "surface rider details (gated)" commit).
