# COD Migration Plan — Razorpay / Online-Payment Audit

**Goal:** convert the platform to **COD-first operation**.
**Scope:** complete audit of all payment-related code. **No code was modified** producing this document — it is an inventory + classification only.
**Date:** 2026-06-19 · **Branch at audit:** `chore/harness-phase-0a`

---

## 0. Executive summary (read this first)

The single most important finding: **COD already works end-to-end and is already the
default.** Online payment (Razorpay) is a *layer on top* of a complete COD flow, and it
is already cleanly gated behind `isRazorpayConfigured()` / `isPayoutConfigured()`
placeholder checks. The checkout screen defaults to `PaymentMethod.COD`
(`CheckoutScreen.tsx:154`), COD orders skip `pending_payment` and go straight to
`confirmed` (`orders.service.ts:265-266`), and the rider collects cash via
`POST /orders/:id/cod-collected`. The in-app "pay a placed order online" CTA is already
a stub that just toasts "coming soon" (`OrderTrackingScreen.tsx:968`).

Because of that, COD-first conversion is **mostly subtraction at the edges, not a rewrite.**
The recommended posture is **"dormant, not deleted"**: keep the well-tested Razorpay
subsystem in place but inert (it already no-ops on placeholder keys), remove only the
*customer-facing entry points* that would start an online payment, and harden the
COD-only money flows the platform will now depend on.

### Three things that are genuine blockers / new work (not just classification)

| # | Blocker | Where | Why it matters for COD-only |
|---|---------|-------|------------------------------|
| **B1** | **Production env hard-fail on placeholder Razorpay keys** | `apps/api/src/config/env.schema.ts:94-107` (`RAZORPAY_SECRET_KEYS` superRefine) | The API **refuses to boot in `NODE_ENV=production`** unless real `RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET` are set. A COD-only deployment with no Razorpay account **cannot start** until this is relaxed. → **Replace For COD** |
| **B2** | **Rider cash reconciliation does not exist** | `orders.service.ts:682` increments `RiderProfile.codBalancePaise`; nothing ever decrements it | `codBalancePaise` only ever grows; `rider_cod_collection` / `rider_cod_settlement` `TransactionType`s (`schema.prisma:73-74`) are **never written**; `COD_FLOAT_CAP_PAISE` (`env.schema.ts:92`) is **never enforced**. Under COD-first, cash-in-hand is the *primary* money flow — this gap becomes critical. → **Replace For COD (build new)** |
| **B3** | **No manual seller-settlement path when RazorpayX is dormant** | `settlement.job.ts:135-153` leaves settlements `pending` + `needsAttention`; no admin "mark paid" endpoint exists | With RazorpayX payouts dormant, daily settlements will accrue forever as `pending` with no way to clear them. Sellers must still be paid (out-of-band UPI/bank), and the record must be closable. → **Replace For COD (build new)** |

---

## 1. Classification legend

| Tag | Meaning | Default risk posture |
|-----|---------|----------------------|
| **Remove Now** | Delete / disable in the COD cutover. Either dead under COD, or an *entry point* that must not let a user start an online payment. | Low — these are leaf removals. |
| **Keep Dormant** | Leave in place but inert. Already gated by `isRazorpayConfigured()`/placeholder env, or becomes unreachable once entry points are removed. Zero traffic, cheap to revive. | Lowest — no behavior change. |
| **Replace For COD** | Behavior must change to be correct in a COD world (or new COD code must be written). | Highest — real work. |
| **Future Online Payment** | Deliberately preserved, untouched, so online payment can be switched back on later. | None now. |

> **Recommended global strategy:** prefer **Keep Dormant** over **Remove Now** for the
> server-side Razorpay machinery (it is tested and already inert on placeholder keys).
> Spend the actual effort on the three **Replace For COD** blockers above.

---

## 2. Every Razorpay dependency

| Item | Location | Classification | Action / Note |
|------|----------|----------------|---------------|
| `razorpay@^2.9.2` npm dependency | `apps/api/package.json` | **Keep Dormant** | Only imported by `razorpay.service.ts`. Harmless unused; removing it forces deleting the service. Defer removal to a "drop online payment for good" decision. |
| Razorpay SDK client + `getClient()` | `razorpay.service.ts:1-15` | **Keep Dormant / Future** | Lazily constructed; never called when no checkout/verify/refund runs. |
| `isRazorpayConfigured()` | `razorpay.service.ts:17-22` | **Keep** | This is the *dormancy switch*. Do **not** remove — it is what makes everything below safely no-op on placeholder keys. |
| `createRazorpayOrder()` | `razorpay.service.ts:28-43` | **Keep Dormant / Future** | Unreachable once checkout stops creating online orders. |
| `verifyPaymentSignature()` | `razorpay.service.ts:45-61` | **Keep Dormant / Future** | — |
| `verifyWebhookSignature()` | `razorpay.service.ts:63-79` | **Keep Dormant / Future** | See §4 (webhooks). |
| `createRefund()` | `razorpay.service.ts:83-90` | **Keep Dormant / Future** | COD refunds never call this (see §6). |
| `fetchPaymentsByOrderId()` | `razorpay.service.ts:92-101` | **Keep Dormant / Future** | Used only by payment reconciliation. |
| RazorpayX payouts: `isPayoutConfigured`, `ensureSellerFundAccount`, `createPayout`, `fetchPayout`, `razorpayXPost/Get`, `authHeader` | `razorpay.service.ts:103-208` | **Keep Dormant** | Seller-settlement money rail (see §5). Already no-ops when `RAZORPAYX_ACCOUNT_NUMBER` is placeholder. |
| Customer-side Razorpay WebView checkout | `apps/customer-app/src/components/payment/RazorpayCheckout.tsx` (whole file) | **Keep Dormant / Future** | Lazy-loaded (`CheckoutScreen.tsx:42`); only mounts when `rzpData` is set. Becomes unreachable once the "Pay Online" option is removed (§4/§7). |
| `EXPO_PUBLIC_RAZORPAY_KEY_ID` (commented) | `.env.example:113-114`, `apps/customer-app/.env.example` | **Keep Dormant** | Already commented out; leave for future. |
| Razorpay column cache on seller | `SellerProfile.razorpayContactId`, `razorpayFundAccountId` — `schema.prisma:159-160` | **Keep Dormant** | Only written by the payout path. No migration needed. |
| Razorpay-doc rule + version pin | `apps/api/CLAUDE.md` (Razorpay row) | **Keep Dormant** | Doc only. Update if/when the dep is removed. |

---

## 3. Every payment-gateway / config dependency

| Item | Location | Classification | Action / Note |
|------|----------|----------------|---------------|
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` env (placeholder defaults) | `env.schema.ts:42-44`; `.env.example:41-43`; `apps/api/.env.example:20-22` | **Keep Dormant** | Defaults are already placeholders → system runs in "dev mock" mode. Leave defaulted. |
| `RAZORPAYX_ACCOUNT_NUMBER` env | `env.schema.ts:48` | **Keep Dormant** | Drives `isPayoutConfigured()`; placeholder = dormant payouts. |
| **Production hard-fail: `RAZORPAY_SECRET_KEYS` + `superRefine`** | `env.schema.ts:10-14, 94-107` | **Replace For COD (BLOCKER B1)** | Currently blocks production boot without real Razorpay keys. Must be relaxed (e.g. gate behind an `ONLINE_PAYMENTS_ENABLED` flag, default false) so a COD-only prod instance can start. |
| `env.schema.test.ts` cases asserting the hard-fail | `apps/api/src/config/__tests__/env.schema.test.ts` | **Replace For COD** | Update alongside B1 so the suite reflects the new (relaxed) contract. |
| `COD_FLOAT_CAP_PAISE` env (₹2000) | `env.schema.ts:92`; `.env.example:91`; `apps/api/.env.example:46`; seed `cod_float_cap_paise` (`seed.ts:94`) | **Replace For COD** | Configured but **never enforced** (B2). COD-first should actually enforce/observe the rider float cap. |
| `ExternalServiceError('Razorpay', …)` example wording | `app-errors.ts:77-86` | **Keep Dormant** | Generic external-service error; mention of Razorpay is illustrative only. |
| `PaymentError` (402) class | `app-errors.ts:61-66` | **Keep Dormant** | Thrown only by online signature-verify (`payments.service.ts:95`). Unreachable under COD-only. |

---

## 4. Every webhook dependency

| Item | Location | Classification | Action / Note |
|------|----------|----------------|---------------|
| `POST /api/v1/payments/webhook/razorpay` route + raw-body parser | `payments.routes.ts:89-134` | **Keep Dormant** | No inbound traffic without a Razorpay account; signature check is skipped on placeholder secret (`razorpay.service.ts:64-68`). Safe to leave mounted; optional Remove Now to shrink attack surface. |
| `processWebhook()` (captured/failed handlers + idempotency) | `payments.service.ts:103-146` | **Keep Dormant / Future** | — |
| `PaymentWebhookEvent` model + `payment_webhook_events` table | `schema.prisma:672-680` | **Keep Dormant** | Idempotency store; no rows without webhooks. No migration needed. |
| nginx webhook location (no rate-limit) | `scripts/nginx/chirawa.conf:61-64` (+ `webhook` zone `:8`) | **Keep Dormant** | Harmless if unhit. Optional Remove Now. |
| `webhook.idempotency.test.ts` | `apps/api/src/modules/payments/__tests__/webhook.idempotency.test.ts` | **Keep Dormant** | Keep green for the day online payment returns. |

---

## 5. Every settlement dependency on Razorpay

> Settlement = **platform → seller** payout. This is *independent* of how the customer
> pays. Under COD-first the seller is still owed goods value; only the **payout rail**
> (RazorpayX) goes dormant. The *accrual* (what the seller is owed) must keep working.

| Item | Location | Classification | Action / Note |
|------|----------|----------------|---------------|
| Settlement **accrual** — `runDailySettlement()` builds `Settlement` records from delivered orders | `settlement.job.ts:35-113` | **Keep** | Still correct and needed under COD — it computes what each seller is owed. |
| `processSingleSellerSettle()` | `settlement.job.ts:288-340` | **Keep** | Same — record creation is COD-safe. |
| **RazorpayX payout** inside `initiatePayout()` (`ensureSellerFundAccount` → `createPayout`) | `settlement.job.ts:116-231` | **Keep Dormant** | When `!isPayoutConfigured()` it already leaves the settlement `pending` with a `failureReason` and **never fakes a payout** (`:146-153`). Inert by default. |
| `runPayoutReconciliation()` sweep | `settlement.job.ts:240-285` | **Keep Dormant** | Early-returns when `!isPayoutConfigured()` (`:241`). |
| Daily-settlement + payout-reconcile schedules | `scheduler.ts:16-38`; workers `worker/index.ts:47-55` | **Keep Dormant** (payout) / **Keep** (accrual) | Leave the daily-settlement cron (accrual). Payout-reconcile cron is inert while dormant. |
| `Settlement` model fields tied to payouts: `payoutId`, `upiRef`, `needsAttention`, `failureReason`, `SettlementStatus` | `schema.prisma:809-836, 80-85` | **Keep** | Reused by the manual flow (B3). `needsAttention` becomes the admin work-queue signal. |
| Seller settlement read API + screen — `getSettlements()`, `GET /sellers/me/settlements`, `SettlementScreen` | `sellers.service.ts:72-104`; `sellers.routes.ts:19-22`; `apps/seller-app/.../SettlementScreen.tsx` | **Keep** | Shows seller what they're owed; status labels already cover pending/processing/paid/failed (`SettlementScreen.tsx:21-23`). |
| **Manual "mark settlement paid" admin action** | *does not exist* | **Replace For COD (BLOCKER B3 — build new)** | Needed so admins can record an out-of-band UPI/bank payout and clear `pending`/`needsAttention`. Writes `status='paid'`, `paidAt`, `upiRef`, and the `seller_settlement` ledger row. |
| `settlement.job.test.ts`, `payout.reconcile.test.ts` | `apps/api/src/worker/jobs/__tests__/` | **Keep Dormant** | Keep for revival; extend for the manual path. |

---

## 6. Every refund dependency on Razorpay

> COD refund semantics already exist and are correct: cancels/line-unavailable on a COD
> order are handled as **cash adjustments**, never as Razorpay refunds.

| Item | Location | Classification | Action / Note |
|------|----------|----------------|---------------|
| `refundCapturedOrderPayment()` | `payments.service.ts:217-251` | **Keep** | Returns `null` immediately for `paymentMethod === 'cod'` (`:225`) → COD cancels never touch Razorpay. Already COD-correct. |
| `refundOrderLine()` | `payments.service.ts:260-294` | **Keep** | Returns `null` for COD (`:270`); caller routes COD line-unavailable to a cash-due reduction instead (`orders.service.ts:785-787`). Already COD-correct. |
| `initiateRefund()` (admin full refund → `createRefund`) | `payments.service.ts:148-184` | **Keep Dormant** | Online-only refund path. For a delivered COD order the cash is already with the rider/platform; any refund is out-of-band cash-back. |
| `POST /api/v1/payments/refund/:orderId` (admin) | `payments.routes.ts:67-87` | **Keep Dormant** | Entry point for the above. |
| Refund **visibility** (derived) — `order.refund { amountPaise, destination }` | `orders.service.ts:416-426`; `order.dto.ts:74-77` | **Keep** | Already emits `cash_adjustment` for COD vs `original` for prepaid. Under COD-only, `original` simply won't occur. |
| Refund notification copy — `CustomerNotifications.paymentRefunded`, "Refund 1-3 din" | `notification.templates.ts:38, 41`; `notifications.plugin.ts:132-135` | **Keep / Replace For COD (copy)** | Reword for COD where it implies money returning to a card/UPI; for COD it's a cash adjustment. |
| `refund.service.test.ts` | `apps/api/src/modules/payments/__tests__/` | **Keep** | Covers the COD-`null` branches too; keep green. |

---

## 7. Every UI component that assumes online payment

| Item | Location | Classification | Action / Note |
|------|----------|----------------|---------------|
| **Checkout "Pay Online" option** in the payment selector | `CheckoutScreen.tsx:503-525` (the `PaymentMethod.UPI` row) | **Remove Now** | This is *the* live entry point to online payment today. COD-first = COD only. Either drop the UPI row (leaving COD) or render it disabled/"coming soon". |
| Checkout default = COD | `CheckoutScreen.tsx:154` | **Keep** | Already COD-first. No change. |
| Checkout Razorpay machinery — `rzpData` state, `handlePaymentSuccess/Dismiss/Error`, `<RazorpayCheckout>` Suspense mount, `verifying` overlay | `CheckoutScreen.tsx:157-163, 334-345, 356-386, 647-681` | **Keep Dormant** | Becomes dead once the "Pay Online" option is removed (paymentMethod can only be COD → online branch never runs). Cheap to leave for revival; optional Remove Now for cleanliness. |
| Lazy import of `RazorpayCheckout` | `CheckoutScreen.tsx:42` | **Keep Dormant / Future** | Never imported at runtime once unreachable. |
| Tracking-screen "Pay Online" CTA on COD orders (`handlePayOnline` → toast "coming soon") | `OrderTrackingScreen.tsx:968, 1087-1102` | **Keep Dormant / Future** | Already non-functional (just a toast via `tracking.payOnlineSoon`). Optional Remove Now; harmless as-is. |
| Tracking `pending_payment` rendering (step index, emoji, labels) | `OrderTrackingScreen.tsx:48, 59, 499, 788, 928, 958` | **Keep Dormant** | COD never enters `pending_payment`; keep for online revival. |
| Tracking refund card + COD cash block | `OrderTrackingScreen.tsx:1025-1038, 1087-1102` | **Keep** | Refund card already distinguishes `cash_adjustment` (COD) from `original`. COD-correct. |
| Rider delivery COD vs prepaid UI (cash-collect confirm, "💵 COD / 💳 Online" label) | `apps/rider-app/.../DeliveryScreen.tsx:68-78, 149`; `RiderApi.collectCod` (`api.service.ts:112-113`) | **Keep / Replace For COD** | Core COD flow — keep. Under COD-only the "Online" branch is rarely/never hit; can simplify later. |
| Seller `SettlementScreen` | `apps/seller-app/.../SettlementScreen.tsx` | **Keep** | Settlement remains real (see §5). |
| i18n: `payOnline`, `onlineHint`, `comingSoon`, `verifying`, `paymentInitFailed`, `paymentFailed`, `paymentCancelledTitle/Body`, `securePayment` | `packages/i18n/src/translations.ts:154-161, 186` | **Keep Dormant** | Strings only; unused once entry points go. |
| i18n: `codPaySub` ("…or pay online to skip the hassle"), `payOnline`, `payOnlineSoon` (tracking) | `translations.ts:240-242` | **Replace For COD (copy)** | Reword so COD-only copy doesn't dangle a non-existent online option. |

---

## 8. Every API endpoint that assumes online payment

| Endpoint | Location | Classification | Action / Note |
|----------|----------|----------------|---------------|
| `POST /api/v1/payments/orders/:orderId` (create Razorpay order) | `payments.routes.ts:22-35` → `createPaymentOrder` (`payments.service.ts:15-34`) | **Keep Dormant** | Unreachable once checkout is COD-only. |
| `POST /api/v1/payments/verify/:orderId` (verify signature → mark paid) | `payments.routes.ts:39-63` → `verifyClientPayment` (`payments.service.ts:84-101`) | **Keep Dormant** | Also exposed in API client `verifyPayment()` (`api-client/src/index.ts:386-391`) — leave dormant. |
| `POST /api/v1/payments/refund/:orderId` (admin) | `payments.routes.ts:67-87` | **Keep Dormant** | See §6. |
| `POST /api/v1/payments/webhook/razorpay` | `payments.routes.ts:89-134` | **Keep Dormant** | See §4. |
| `POST /api/v1/orders` **online branch** — `if (paymentMethod !== 'cod') createCartPaymentOrder(...)` | `orders.routes.ts:30-37` → `createCartPaymentOrder` (`payments.service.ts:42-68`) | **Keep Dormant** | Becomes unreachable once the place-order schema is restricted to `cod` (below). |
| `paymentsRoutes` registration | `app.ts:178` (`prefix: '/api/v1/payments'`) | **Keep Dormant** | Leave mounted; endpoints simply go unexercised. Optional Remove Now. |
| **Place-order payment-method schema** — `z.enum(['upi','card','wallet','cod'])` | `orders.schema.ts:6` | **Replace For COD** | Restrict to `z.enum(['cod'])` (or validate against an `ONLINE_PAYMENTS_ENABLED` flag) so a client cannot place an online order while the gateway is dormant — this is what makes the online branch above truly unreachable. |
| `verifyPaymentSchema` (orders + payments) | `orders.schema.ts:13-17`; `payments.routes.ts:11-15` | **Keep Dormant** | Validates the dormant verify endpoint. |

---

## 9. Data-model & enum items (cross-cutting)

| Item | Location | Classification | Action / Note |
|------|----------|----------------|---------------|
| `PaymentMethod` enum (`upi`/`card`/`wallet`/`cod`) — TS + Prisma | `packages/types/src/enums/payment-method.enum.ts`; `schema.prisma:31-36` | **Keep Dormant** | Keep all members for future online payment. Restrict at the **schema/validation** layer (§8), not the enum. |
| `PaymentStatus` enum | `payment-status.enum.ts`; `schema.prisma:38-44` | **Keep** | `pending`/`captured`/`failed`/`refunded` still used by COD cancel/line-refund accounting. |
| `OrderStatus.pending_payment` + its transitions | `schema.prisma:19-29`; `orders.service.ts:78-88` | **Keep Dormant** | COD never enters it. Do **not** drop the enum value (would need a migration + breaks history rows). |
| `Payment` model | `schema.prisma:652-670` | **Keep** | Still written for refund/line-refund accounting on COD orders. |
| `Order.codCollectedPaise` | `schema.prisma:542`; written at `orders.service.ts:675` | **Keep** | Core COD field. |
| `RiderProfile.codBalancePaise` | `schema.prisma:189`; incremented `orders.service.ts:682` | **Replace For COD (B2)** | Increment-only today; needs a decrement/deposit flow. |
| `TransactionType.rider_cod_collection` / `rider_cod_settlement` | `schema.prisma:73-74` | **Replace For COD (B2)** | Declared but never written — wire them into the new rider cash-reconciliation flow. |
| `TransactionType.customer_payment` ("Online payment received") | written only in `markOrderPaid` (`payments.service.ts:318-320`) | **Keep Dormant** | COD records cash via `codCollectedPaise`, not this ledger row. Consider a COD-collection ledger entry for parity (optional). |
| `markOrderPaid()` + `reconcilePendingPayments()` + payment-reconcile job/cron | `payments.service.ts:296-342, 186-207`; `reconciliation.job.ts:19-79`; `scheduler.ts:41-50` | **Keep Dormant** | Operate only on `pending_payment` orders, which COD-only never creates. Inert. |
| `PlaceOrderResponse.razorpayOrderId/razorpayKeyId/amountPaise`; `VerifyPaymentResponse/Request` | `packages/types/src/dto/order.dto.ts:26-40` | **Keep Dormant** | Optional fields; simply unset under COD. |
| `OrderStatusChangedPayload.refundedPaise` | `event-bus.ts:129-131` | **Keep** | Used by COD cash-adjustment notifications too. |

---

## 10. Summary by classification

### 🔴 Remove Now (entry points only)
1. **Checkout "Pay Online" option** — `CheckoutScreen.tsx:503-525`. *(The only live online entry point.)*
   - Optional companions to remove for cleanliness (all otherwise Keep Dormant): the checkout Razorpay machinery (`CheckoutScreen.tsx:157-163, 334-345, 356-386, 647-681`), the tracking "Pay Online" toast CTA (`OrderTrackingScreen.tsx:1087-1102`), the nginx webhook location, the whole `paymentsRoutes` mount.

### 🟡 Replace For COD (real work — do these)
1. **B1 — Relax production Razorpay hard-fail** so COD-only prod can boot — `env.schema.ts:94-107` (+ `env.schema.test.ts`). *Gate online behind `ONLINE_PAYMENTS_ENABLED` (default false).*
2. **B2 — Build rider cash reconciliation**: decrement `codBalancePaise` on deposit, write `rider_cod_collection`/`rider_cod_settlement` ledger rows, enforce/observe `COD_FLOAT_CAP_PAISE`. New endpoint + (likely) admin/rider screen.
3. **B3 — Build manual seller-settlement "mark paid"** admin action to clear `pending`/`needsAttention` and write the `seller_settlement` ledger row — pairs with the dormant RazorpayX payout.
4. **Restrict place-order schema to `cod`** — `orders.schema.ts:6` (makes the online order branch unreachable).
5. **Reword online-implying copy** — `translations.ts:240-242`; refund notification templates (`notification.templates.ts:38,41`).

### 🟢 Keep Dormant (inert; revivable) — *the bulk of the Razorpay code*
- All of `razorpay.service.ts` (SDK + RazorpayX payouts), `payments.service.ts`, `payments.routes.ts` (4 endpoints), the webhook route + `PaymentWebhookEvent`, payment-reconcile + payout-reconcile jobs/crons, `RazorpayCheckout.tsx` + checkout machinery, Razorpay env vars, `PaymentError`, online i18n strings, online DTO fields.

### 🔵 Future Online Payment (preserve untouched)
- `PaymentMethod` enum members `upi`/`card`/`wallet`; `OrderStatus.pending_payment`; the entire dormant verify/checkout/webhook chain. These are the switch-back-on surface — keep them green in tests.

### ✅ Keep (already COD-correct — no change)
- COD place-order path + `confirmed`-on-create; `codCollected` / `markDelivered`; COD-`null` refund routing (`refundCapturedOrderPayment`, `refundOrderLine`); refund visibility (`cash_adjustment`); settlement **accrual**; seller settlement read API + screen; rider COD collect UI.

---

## 11. Suggested phasing (when you greenlight code changes)

- **Phase 0 — Unblock prod boot (B1).** Relax the env hard-fail behind `ONLINE_PAYMENTS_ENABLED=false`. Smallest change; lets a COD-only instance start. *(Nothing else works in prod until this lands.)*
- **Phase 1 — Close the online entry points.** Restrict `orders.schema.ts` to `cod`; remove/disable the checkout "Pay Online" option; reword dangling copy. Server Razorpay endpoints go dormant automatically.
- **Phase 2 — Harden COD money flow (B2).** Rider cash deposit/reconciliation + float-cap enforcement. This is the substantive COD-first feature work.
- **Phase 3 — Close the settlement loop (B3).** Manual "mark settlement paid" admin action + ledger.
- **Phase 4 (optional, later) — Hard removal.** If online payment is abandoned for good, delete the dormant Razorpay subsystem and the `razorpay` dependency in one deliberate change.

---

## 12. Notes & caveats

- **No code was changed** to produce this audit.
- Line numbers reflect the working tree at audit time (branch `chore/harness-phase-0a`) and may drift as the repo changes.
- `pnpm-lock.yaml` and `packages/types/dist/**` also reference Razorpay/payment symbols; those are generated artifacts and follow whatever the source decisions above produce — they are not separate action items.
- The repo's own `FEATURE_VERIFICATION_MATRIX.md` (E13) and `RUNTIME_VERIFICATION_HARNESS.md` independently corroborate **B2** (COD float cap configured but unenforced; `codBalancePaise` not reconciled) — worth citing when scoping that work.
