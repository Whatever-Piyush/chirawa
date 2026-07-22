# Duplicate-Order Protection — Fix Plan

**Status:** Plan only. **No code to be implemented yet.** Grounded in the live codebase + the
runtime audit (5 concurrent `POST /orders` on one cart → **5 confirmed orders**, each ₹310).

---

## 0. Current state (audit recap)

| Layer | Finding | Evidence |
|---|---|---|
| UI button | `canPlaceOrder = … && !placing …` but the press handler is **`pulseAndPlace`**, which defers `handlePlaceOrder` (and `setPlacing(true)`) to the spring animation's `.start()` callback → button stays **enabled during the animation** | `CheckoutScreen.tsx:280-284,373,585` |
| UI handler | `handlePlaceOrder` has **no re-entrancy guard** (`if (!cart || !addressId) return;` only); `setPlacing` is async (render-latency gap) | `CheckoutScreen.tsx:288-291` |
| Client API | `placeOrder` sends **no `Idempotency-Key`**; `request()` only sets `Content-Type` + `Authorization` | `packages/api-client/src/index.ts:69-71,380` |
| Backend route | Idempotency is honored **only if the client sends the header**; client sends none → every request runs `createOrder()` directly | `orders.routes.ts:42-45` |
| Backend service | `placeOrder` does `redis.get(cart)` → resolver/fee/`$transaction` → `redis.del(cart)` with **no lock, not atomic** → concurrent reads all proceed | `orders.service.ts:152,268-320` |

**Net:** zero effective protection. The existing `runIdempotent` (SETNX) infra in
`shared/utils/idempotency.ts` is **present but dormant**.

---

## 1. Goals → design mapping

| Requirement | Mechanism |
|---|---|
| 1. Prevent duplicate orders from double-tap | Layers A (UI lock) + C (server dedup) |
| 2. Use existing backend Idempotency-Key infra | Layer B: client sends a stable `Idempotency-Key`; route already calls `runIdempotent` |
| 3. Fix UI re-entrancy **before animation starts** | Layer A: synchronous `useRef` submit-lock set on the first line of the tap handler |
| 4. Server protection even if client is buggy | Layer C: route **always** runs through `runIdempotent`, falling back to a server-derived key when the client sends none |
| 5. Runtime proof (1 order / replay / no stock dup / no payment dup) | §6 |

---

## 2. Layered design

### Layer A — UI re-entrancy lock (req 1 + 3)
Close all three client gaps (animation deferral, async `setPlacing`, no internal guard) with a
**synchronous ref**, which is immune to render latency.

- Add `const submittingRef = useRef(false);` in `CheckoutScreen`.
- `pulseAndPlace` becomes (first lines, **before** the animation):
  - `if (submittingRef.current || !canPlaceOrder) return;`
  - `submittingRef.current = true;` *(synchronous — blocks a 2nd tap immediately, even mid-animation)*
  - `setPlacing(true);` *(also flips the disabled style)*
  - then start the animation; call `handlePlaceOrder` from `.start(...)` as today.
- `handlePlaceOrder`: keep `setPlacing(true)` idempotent; in the existing `finally`, reset **both**
  `setPlacing(false)` **and** `submittingRef.current = false`. Optionally re-assert
  `if (!submittingRef.current) return;` at entry for defense.
- *(Alternative, equivalent: drop the deferral — call `handlePlaceOrder()` immediately and run the
  pulse in parallel. The ref-lock is preferred: smaller diff, keeps the animation.)*

> This makes a second tap during the animation a no-op **synchronously**, before any second
> `POST /orders` can be issued.

### Layer B — Client Idempotency-Key (req 2)
Reuse the dormant backend infra by actually sending a key.

- Extend the api-client request layer to allow per-call headers:
  `request(method, path, body, requiresAuth, headers?)` (or a `placeOrder`-specific overload) so
  `placeOrder` can attach `Idempotency-Key`. (`packages/api-client/src/index.ts:63-107,380`.)
- **Key lifecycle (the crucial part):**
  - Generate **one** key per *checkout intent* — e.g. when the cart's identity is first seen on the
    Checkout screen (tie it to `cart.cartId`), held in a `useRef`.
  - **Reuse the same key on retry** (network failure / timeout / user re-tap) so the retry replays
    the first result instead of creating a second order.
  - **Rotate** the key only when the intent changes: a new `cart.cartId` (cart cleared/rebuilt) or
    after a confirmed successful order.
- **409 handling:** `runIdempotent` returns `ConflictError` (409) to a caller that arrives while the
  first is still in-flight. The client must treat 409 as *"order is being placed"* — show the
  spinner / fetch the resulting order — **not** as an error that invites another tap.

### Layer C — Server-side dedup independent of the client (req 4)
A buggy/old client may send no key (or an inconsistent one). Make the server safe regardless by
**always** routing `createOrder` through `runIdempotent`, deriving a key when none is supplied.

- In `orders.routes.ts`:
  - `const effectiveKey = readIdempotencyKey(header) ?? \`auto:${parsed.data.cartId}\`;`
  - `const result = await runIdempotent(app.redis, \`order:${userId}\`, effectiveKey, createOrder);`
    (always — drop the `idemKey ? … : createOrder()` branch).
- Why `cartId`: it is a UUID, **stable across a double-tap** (same cart) and **unique per cart**, so
  same-cart concurrent submits collapse to one `runIdempotent` lock while genuine new orders
  (different cart → different `cartId`) are unaffected. It is read from the request body, so it needs
  **no cart read** (no new race).
  - *Robustness note:* a client that sends a key on tap 1 but not tap 2 would split across two keys.
    To be bullet-proof against inconsistent clients, prefer keying on `auto:${cartId}`
    **unconditionally** as the server's authoritative dedup key, treating any client key as
    advisory. (Recommended; call out in review.)
- **Defense-in-depth (optional, closes the raw read→delete race directly):** at the top of
  `placeOrder`, claim the cart atomically — Redis **`GETDEL cart:{userId}`** (or a small Lua
  get-then-del), so only one caller ever obtains the cart payload; concurrent callers get nil and
  fail fast. Trade-off: a *post-claim* failure (e.g. stock) must **re-persist the cart** so it isn't
  lost — so pair GETDEL with a write-back on the failure path, or use a short‑TTL per-user lock
  `SETNX checkout:{userId}` released in `finally` instead. With Layer C's `runIdempotent` serializing
  per key, this is belt-and-suspenders, not strictly required.

---

## 3. Exact files involved

| File | Change |
|---|---|
| `apps/customer-app/src/screens/orders/CheckoutScreen.tsx` | `submittingRef` lock in `pulseAndPlace` (pre-animation) + reset in `handlePlaceOrder` `finally`; generate/hold the per-intent `Idempotency-Key`; pass it to `api.placeOrder`; handle 409 |
| `packages/api-client/src/index.ts` | `request(...)` accepts optional headers; `placeOrder` forwards `Idempotency-Key` |
| `apps/api/src/modules/orders/orders.routes.ts` | always `runIdempotent` with `clientKey ?? auto:${cartId}` |
| `apps/api/src/shared/utils/idempotency.ts` | reuse as-is (optionally: make an in-flight caller *await* the first result instead of 409, for nicer UX — see §5) |
| `apps/api/src/modules/orders/orders.service.ts` | *(optional hardening)* atomic cart claim (`GETDEL`/lock) + write-back on failure |

No schema changes. No new dependencies.

---

## 4. Edge cases

- **Retry after transient failure:** `runIdempotent` does **not** cache failures → a retry with the
  same key re-runs (correct: no order existed). After success, the same key **replays** the cached
  201 (same `orderId`, `razorpayOrderId`).
- **COD vs online:** dedup wraps the whole `createOrder`, which for non-COD also calls
  `createCartPaymentOrder` → one Razorpay order + one set of `Payment` rows; replays return the same
  `razorpayOrderId` (no duplicate charge).
- **Cart changed mid-session:** new `cart.cartId` → new derived key → a legitimately different order
  is allowed.
- **Lock TTL:** `runIdempotent` lock is 60s, result cached 24h — a normal checkout completes well
  inside 60s; a process crash mid-flight auto-releases the lock for a genuine retry.
- **409 vs replay UX:** decide product behavior — either surface the in-flight 201 by polling the
  order, or enhance `runIdempotent` so in-flight callers *await* the first result (§5).
- **Multi-shop carts:** one `createOrder` still produces the shop-split orders atomically; dedup
  applies to the whole call, so the split set is created once.

---

## 5. Optional infra enhancement (nice-to-have)
Current `runIdempotent` returns **409** to a concurrent in-flight caller. For the cleanest UX
("5 taps all see the same confirmation"), optionally enhance it so an in-flight caller **waits** for
and **replays** the first result (poll the redis key until the cached response appears, bounded by a
timeout) instead of 409. This keeps the same SETNX skeleton. If not done, the client handles 409 as
"in progress" (Layer B).

---

## 6. Runtime verification plan (req 5)

Reuse the audit harness (concurrent `POST /orders`, COD **and** a `upi` run; same cart; within
operating hours). For each proof, capture HTTP responses + DB.

**Baseline (pre-fix, for contrast):** 5 concurrent → **5 orders**, stock decremented **5×**, (upi)
**5** Razorpay orders / Payment sets. *(Already demonstrated.)*

**Proof 1 — 5 concurrent submits ⇒ exactly 1 order**
- Fire 5 concurrent `POST /orders` for one cart **with the same `Idempotency-Key`**; repeat the burst
  **with no client key** (proves Layer C via `auto:${cartId}`).
- Assert: `SELECT count(*) FROM orders WHERE … {this cart}` **= 1**. Responses = one `201` plus four
  `201`-replays-or-`409`s; every returned `orderId` is identical. ✅

**Proof 2 — retries return the same response**
- After success, re-send `POST /orders` with the **same key** (and again the keyless/same-cart case).
- Assert: `201` with the **same `orderId`** (and same `razorpayOrderId` for upi); **no** new order row.

**Proof 3 — no inventory duplication**
- Record `products.stock_qty` for each line **before** the burst; pick stock-tracked SKUs (`stock_qty
  IS NOT NULL`).
- After the burst, assert `stock_qty` decreased by **exactly the ordered quantity once** (not ×5);
  i.e. `before - after == Σ line qty` of a single order.

**Proof 4 — no duplicate payments** (`paymentMethod = upi`)
- Assert exactly **one** `razorpayOrderId` across the burst and `SELECT count(*) FROM payments WHERE
  order_id = <the one order>` matches a single order's row count (one per child order); replays share
  that `razorpayOrderId`. No extra `Payment`/`transactions` rows.

**Cleanup:** delete the single created order + dependents after each run (as in the audit), so the
dev DB is left clean.

**Pass criteria:** Proof 1 = 1 order (both keyed and keyless bursts); Proof 2 identical
order/response on retry; Proof 3 single decrement; Proof 4 single payment intent.

---

## 7. Risks & rollout
- **Lowest-risk first:** Layer A (UI ref-lock) ships independently and removes the common double-tap
  immediately. Layer C (server `runIdempotent` always-on) is the real guarantee and is a small,
  backward-compatible route change. Layer B (client key) makes intent explicit and covers retries.
- **Watch:** the 409-vs-replay UX decision (§5); GETDEL cart-loss-on-failure (use write-back or the
  lock variant); ensure the client treats 409 as non-terminal.
- **Relation to prior work:** independent of the YMAL Phase-1 fix (`flushPendingMutations` serializes
  *cart writes vs checkout*; this serializes *checkout vs checkout*). This realizes the
  "prevent duplicate orders" item deferred in `YMAL_RACE_FIX_PLAN.md` (Option E).
