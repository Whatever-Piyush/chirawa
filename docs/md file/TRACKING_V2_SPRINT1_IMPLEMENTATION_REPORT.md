# Tracking V2 — Sprint 1 Implementation Report

**Scope:** P0.1 Error State · P0.2 Refund Card · P0.3 Item-Unavailable. **Excluded (not
touched):** ETA Hero, Map Gating, Timeline redesign, Rider Card redesign (P1).

**Status:** Implemented on `fix/order-rider-id-identity`, **uncommitted**. One small additive
backend serialization change (refund block, no schema/migration); the rest is customer-app +
i18n. Context7 Prisma v5 already consulted this session for the `select` patterns used.

## 1. Files changed
| File | Item | Change |
|---|---|---|
| `apps/api/src/modules/orders/orders.service.ts` | P0.2 | `getOrder`: select `payments.refundedPaise`; derive a `refund` block; return it |
| `packages/types/src/dto/order.dto.ts` | P0.2 | additive `refund?: { amountPaise; destination }` |
| `apps/api/.../__tests__/orders.rider-access.test.ts` | P0.2 | +4 refund-block tests |
| `packages/i18n/src/translations.ts` | P0.1–3 | new `tracking.*` keys (en + hi) |
| `apps/customer-app/.../OrderTrackingScreen.tsx` | P0.1–3 | error card + Retry; reconnecting banner; refund card; `order:item-unavailable` listener + banner + refetch; styles |

`.env.example` left unstaged (pre-existing). No P1 files touched.

## 2. What was built
**P0.1 — Error state.** Replaced `if (!order) return null` (the blank screen) with a
recoverable **error card** (icon + message + **Retry** → `setLoading(true); fetchOrder()`).
Added a **"Reconnecting…"** banner driven by socket `disconnect`/`connect_error` (cleared on
`connect`); data keeps flowing via the 15 s poll. First-load failures surface; poll failures
keep the last good order (no clobber). Listener cleanup added.

**P0.2 — Refund card.** `getOrder` now returns `refund { amountPaise, destination }` derived
from `max(Σ Payment.refundedPaise, Σ unavailable-line OrderItem.refundedPaise)` — covers
prepaid full/line refunds (`original`) and COD line adjustments (`cash_adjustment`), without
double-counting. The screen shows a green **refund card** ("Refund of ₹X · to your account ·
3–5 days"). (Read-only; a full refund timeline is Phase 2.)

**P0.3 — Item-unavailable.** Added the missing `socket.on('order:item-unavailable')` listener
→ an inline, dismissable **banner** ("'Tata Tea Gold' is out of stock — ₹140 refunded", or
"Order cancelled — full refund initiated" when `cancelled`), an optional **"Add instead"**
substitute CTA, and a **refetch** so the bill + refund card reconcile. Listener cleanup added.

## 3. Tests
- **Typecheck:** api **29 = baseline (0 new)**; **customer-app `tsc --noEmit` → 0 errors**.
  (Two transient test-only cast errors were fixed before finalizing, as in prior sprints.)
- **Unit:** `vitest run src/modules/orders` → **71/71 pass (9 files)**; `orders.rider-access`
  went 19 → 23 with the refund-block tests: prepaid refund → `original`; COD line →
  `cash_adjustment`; **no double-count** when both Payment + OrderItem are set; omitted when
  nothing refunded.
- Client UI logic: the repo has no RN component/socket-UI test harness — covered by the
  runtime + backend-contract proofs below (stated honestly).

## 4. Runtime verification (live API, real OTP, cleaned up)

**P0.1 — Error state**
```
GET /orders/<nonexistent> (customer) → HTTP 404 {"code":"NOT_FOUND","message":"Order not found"}
```
A clean error contract ⇒ the screen renders the **error card + Retry**, not a blank page
(was `return null`). UI render verified by construction.

**P0.2 — Refund card**
```
seeded: cancelled prepaid order + payment refunded_paise=15000
GET /orders/:id (customer) → refund = { amountPaise: 15000, destination: 'original' }
```

**P0.3 — Item-unavailable** (Node `socket.io-client` as the customer + rider trigger)
```
customer socket subscribed
>>> RECEIVED order:item-unavailable {productName:"Tata Tea Gold", refundedPaise:14000, cancelled:false}
rider triggers item-unavailable [HTTP 200]
RESULT: client received order:item-unavailable ✓
GET /orders/:id after refetch → refund = { amountPaise: 14000, destination: 'original' }
```
Proves the wire (server→subscribed client) **and** the refetch reconciliation (the line refund
now appears in the refund block). The rider flow also flips the product to out-of-stock — the
harness **restored it** (`stock_status` back to `available`).

**Cleanup verified:** `orders=54`, no leftover rows, no stray payment, Tea Gold stock
`available`, no online riders — DB identical to before.

## 5. Not done (per instruction)
- **P1:** ETA Hero, Map Gating, Timeline redesign, Rider Card redesign — **not started.**
- Phase 2: refund timeline/model, structured support, masking, route polyline, delay engine,
  group ETA — out of scope.

## 6. Notes
- Changes **uncommitted** on `fix/order-rider-id-identity`. Suggested commit:
  `feat(tracking): V2 sprint 1 — error state, refund card, item-unavailable`.
- The dev API (tsx-watch) reloaded the backend `refund` change; the client changes are
  customer-app only.
- The refund `destination`/copy are derived approximations for MVP; a first-class `Refund`
  model with a real timeline is Phase 2.
