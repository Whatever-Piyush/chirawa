# Tracking V2 — Sprint 1 Changeset (pre-implementation)

Scope: **P0.1 Error State · P0.2 Refund Card · P0.3 Item-Unavailable** only.
**Excluded:** ETA Hero, Map Gating, Timeline redesign, Rider Card redesign (P1 — not touched).
Built on the shipped backend; one small **additive** backend serialization add (refund block),
no schema/migration.

## Files to change
**Backend (additive)**
| File | Change |
|---|---|
| `apps/api/src/modules/orders/orders.service.ts` | `getOrder`: add `refundedPaise` to the `payments` select; derive a `refund` block from `Payment.refundedPaise` (+ COD line refunds via `OrderItem.refundedPaise`); return `{ …order, rider, eta, refund }` |
| `packages/types/src/dto/order.dto.ts` | additive `refund?: { amountPaise; destination: 'original'\|'cash_adjustment' }` on `OrderDetailResponse` |
| `apps/api/src/modules/orders/__tests__/orders.rider-access.test.ts` | extend `getOrder` tests for the `refund` block |

**Client**
| File | Change |
|---|---|
| `apps/customer-app/src/screens/orders/OrderTrackingScreen.tsx` | P0.1 error card + Retry (replace `return null` `:618`); split first-load vs poll in `fetchOrder` `:444`; socket-stale "reconnecting" banner. P0.2 refund card. P0.3 `order:eta`-style `order:item-unavailable` listener + inline banner + refetch + cleanup |
| `packages/i18n/src/translations.ts` | new `tracking.*` keys (en + hi) for the error, reconnecting, refund, and item-unavailable copy |

No P1 files (`TrackingMap.tsx`, `ProgressStepper`, rider card layout) touched.

## Backend `refund` derivation (read-only, MVP)
```
paymentRefund = Σ payments.refundedPaise            // prepaid full + line refunds
lineRefund    = Σ items[fulfillmentStatus='unavailable_refunded'].refundedPaise   // covers COD adjustments
refundedPaise = max(paymentRefund, lineRefund)      // avoids double-count
refund = refundedPaise > 0
  ? { amountPaise: refundedPaise, destination: paymentMethod==='cod' ? 'cash_adjustment' : 'original' }
  : undefined
```
(A real refund **state machine / timeline** is Phase 2; this is a derived read-only block. Copy
is localized client-side.)

## Socket changes (client only — events already exist server-side)
- Add `socket.on('order:item-unavailable', …)` → set an item banner + refetch (P0.3); `off` in cleanup.
- Augment `connect` to clear, and add `disconnect`/`connect_error` → set `socketStale` (P0.1 banner); `off` in cleanup.
- **No server socket changes.**

## Tests to add
- **Backend:** `getOrder` returns the `refund` block for a refunded order (prepaid full, line
  refund), `cash_adjustment` for COD line, omitted when nothing refunded.
- **Client:** extract pure helpers where feasible (`refundView`, item-banner reducer) — unit
  test if a seam exists; otherwise covered by runtime + manual (repo has no RN UI test harness).

## Runtime verification plan (all three flows)
- **P0.1 Error state:** `GET /orders/<bad-id>` → API returns NotFound (curl) ⇒ screen shows the
  **error card + Retry** instead of blank (in-app); socket disconnect ⇒ "reconnecting" banner,
  poll keeps data.
- **P0.2 Refund card:** seed `payments.refunded_paise > 0` on an order ⇒ `GET /orders/:id`
  returns the `refund` block (curl) ⇒ refund card renders (in-app). Clean up.
- **P0.3 Item-unavailable:** Node `socket.io-client` (proven P3 pattern) subscribed as the
  customer + trigger `POST /delivery/orders/:orderId/items/:itemId/unavailable` (rider) ⇒
  assert `order:item-unavailable` received with `{productName, refundedPaise, …}` (wire) ⇒
  inline banner + refetch (in-app). Clean up.

## After implementation
`pnpm --filter @chirawa/api typecheck` + `pnpm --filter @chirawa/customer-app exec tsc --noEmit`
→ `vitest run src/modules/orders` → the three runtime flows → `TRACKING_V2_SPRINT1_IMPLEMENTATION_REPORT.md`.
**No P1 items started.**
