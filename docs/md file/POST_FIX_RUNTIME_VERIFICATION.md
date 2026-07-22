# Post-Fix Runtime Verification — BUG-1

**Goal:** Re-run the exact scenario that originally proved BUG-1, now against the fixed
code, and show **before vs after**. The bar: the previous `403`s must now return `200`.

**Result:** ✅ **All previously-failing calls now succeed.** Every `403` → `200`, the
order completes, and the COD cash is actually ledgered (`0 → 16000`).

## Method (identical to the original verification)

- **Live API** `http://localhost:3000` (`/health` → 200), served by `tsx watch` — the
  fixed `orders.routes.ts` / `orders.service.ts` are loaded (the dev server reloads on
  save; a `200` here is itself proof, since the old code returned `403` deterministically).
- **Real OTP login** (dev code `123456`): rider `7700110001`, customer `9680599889`,
  admin `9999900001`.
- **Real assignment:** two orders (one `upi`, one `cod`) seeded for the customer at
  "Chirawa Store", then assigned via the **real** `POST /delivery/orders/:id/assign`
  (admin → `assignOrder`), which writes `orders.rider_id = RiderProfile.id`
  (`riderid_is_profile_id = t`).
- **No repo code touched** by the harness; all test rows deleted and the rider's COD
  balance restored afterward (verified: orders back to 54, balance back to 0).

Same rider identity as the original run — `RiderProfile.id = a69c6e6c…`, `User.id =
2cb348fa…` (distinct).

## Before vs after

| Step | Request (as rider) | BEFORE (buggy) | AFTER (fixed) |
|---|---|---|---|
| 1 | create + assign order | `rider_id = RiderProfile.id` | `rider_id = RiderProfile.id` (unchanged) |
| 2 | login as rider | token issued | token issued |
| 3 | `GET /orders` | **count = 0** (own orders invisible) | **HTTP 200 — count = 2**, contains both orders |
| 4 | `GET /orders/:id` | **403 `Not your order`** | **HTTP 200** (order returned) |
| 5 | `POST /orders/:id/delivered` | **403 `Not your delivery`** | **HTTP 200** — `Order delivered confirm ho gaya`; status → `delivered`, `deliveredAt` stamped |
| 6 | `POST /orders/:id/cod-collected` | **403 `Not your delivery`** | **HTTP 200** — `Cash collection confirm ho gaya`; status → `delivered`, `cod_collected_paise = 16000` |
| — | rider `cod_balance_paise` after COD | never moved (silent no-op) | **`0 → 16000` (+16000)** — the ledger fix |

> BEFORE values are from `BUG_RUNTIME_VERIFICATION.md` (same scenario, pre-fix).

## After — verbatim traces (this run)

**Assignment (real `assignOrder`):**
```
seeded+assigned: prepaid=4167052c-…  cod=47a5a9dd-…
 id            | payment_method | riderid_is_profile_id
 4167052c-…    | upi            | t
 47a5a9dd-…    | cod            | t
```

**Step 3 — `GET /orders` (rider):**
```
HTTP 200 | returned count = 2
contains prepaid = True | contains cod = True
```

**Step 4 — `GET /orders/:id` (rider, prepaid):**
```
status: 200
{"id":"4167052c-…","customerId":"d5c485ae-…","shopId":"2259f27d-…", … }
```

**Step 5 — `POST /orders/:id/delivered` (rider, prepaid):**
```
status: 200
{"message":"Order delivered confirm ho gaya"}
```

**Step 6 — `POST /orders/:id/cod-collected` (rider, cod):**
```
status: 200
{"message":"Cash collection confirm ho gaya"}
```

**COD ledger + final state:**
```
rider cod_balance_paise BEFORE = 0
rider cod_balance_paise AFTER  = 16000   (delta = 16000)

 id          | status    | delivered_stamped | cod_collected_paise
 4167052c-…  | delivered | t                 |                   0   (prepaid)
 47a5a9dd-…  | delivered | t                 |               16000   (cod)
```

## What this proves

1. **The four 403s are gone** — `delivered`, `cod-collected`, `GET /orders/:id`, and the
   empty `GET /orders` all now work for the genuinely-assigned rider. BUG-1's
   user-facing breakage is resolved end-to-end (route → service → DB).
2. **The COD ledger fix works** — the rider's `cod_balance_paise` actually increments by
   the collected amount. Pre-fix, even if the 403 were bypassed, the balance update was
   keyed by `where: { userId }` and silently no-op'd; the `where: { id: riderProfileId }`
   fix is confirmed by the `0 → 16000` delta.
3. **The status-history actor is correct** — the `delivered` transitions were written
   (status + `deliveredAt`), with `changedById` = the rider's `User.id` (unchanged
   convention).

## Integrity

- No repository code/schema modified by this verification.
- All seeded rows (2 orders, 2 items, assignments, status history) deleted; rider COD
  balance restored to `0`; rider set back to `offline`. Post-run DB:
  `orders = 54`, `assigned = 0`, `leftover_test = 0`, `cod_balance = 0`, `online_riders = 0`
  — identical to before the run.
- Out of scope and unchanged: BUG-2 (no `rider` object in the payload) and BUG-3 (no
  server ETA) — confirmed not addressed, as required.
- Environment: local dev DB (`chirawa_development`). Production should be smoke-tested
  with one real assigned order post-deploy (per `BUG1_IMPLEMENTATION_PLAN.md` §P0).
