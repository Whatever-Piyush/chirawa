# BUG-001 Fix Plan (Consolidated) — COD collection: trusted amount + state-machine bypass + non-idempotent double-credit

**Status:** BUG-001 now covers **three confirmed defects** in the same code path (`codCollected`).
**This is a patch plan only — no implementation, no code changes.** Snippets are *proposed* illustrations.
**Date:** 2026-06-20 · **Branch:** `chore/harness-phase-0a`
**Evidence basis:** `BUG_001_STATE_MACHINE_CHECK.md` + source reads (file:line below).

## The three confirmed defects (all in `codCollected`)

| # | Defect | Confirmed by |
|---|--------|--------------|
| **D1** | **Client-supplied COD amount is trusted** — written verbatim to `Order.codCollectedPaise` and the `codBalancePaise` increment, never compared to `Order.totalAmount`. | `orders.service.ts:675,682`; route has no validation (`orders.routes.ts:122`). Under-report → rider keeps the cash. |
| **D2** | **`codCollected` bypasses the order state machine** — writes `status:'delivered'` directly; never calls `assertTransition`; no `order.status` guard. Callable from `confirmed`/`preparing`/`ready_for_pickup`/`picked_up`. | `BUG_001_STATE_MACHINE_CHECK.md`; `orders.service.ts:666-691` (no status check). |
| **D3** | **`codCollected` is not idempotent → double-credit** — a retry/double-submit on an already-`delivered` order re-runs and **increments `codBalancePaise` again** (no terminal-state guard, no compare-and-set). | `orders.service.ts:680-684` (unconditional increment). |

All three are fixed together because they live in the same ~18 lines and share one transaction.

---

## 1. Exact files to modify

| File | Change | Defects |
|------|--------|---------|
| `apps/api/src/modules/orders/orders.service.ts` (`codCollected`, ~666-691) | Derive amount from `order.totalAmount`; add `assertTransition`; add terminal-state idempotency guard + compare-and-set credit. | D1, D2, D3 |
| `apps/api/src/modules/orders/orders.schema.ts` | Add `codCollectedSchema` (zod) — `amountPaise` optional, non-negative int. | D1 |
| `apps/api/src/modules/orders/orders.routes.ts` (118-126) | Replace raw `as` cast with `codCollectedSchema.safeParse`; pass optional amount. | D1 |
| `apps/api/src/modules/orders/__tests__/orders.cod-collected.test.ts` | Mock fixup + new regression cases (see §3). | D1, D2, D3 |
| `apps/rider-app/.../DeliveryScreen.tsx`, `.../api.service.ts` | **No change required** (verified §5). Optional later cleanup only. | — |

No new files. No Prisma schema/migration. No `packages/types` / `packages/api-client` change (no shared DTO).

---

## 2. Exact logic changes

### 2a. `orders.service.ts` — `codCollected` (proposed; replaces 666-691)

```ts
async function codCollected(
  orderId: string, riderProfileId: string,
  amountPaise: number | undefined,         // ← now optional; advisory only (see D1)
  riderUserId: string,
) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new NotFoundError('Order');
  if (order.riderId !== riderProfileId) throw new ForbiddenError('Not your delivery');
  if (order.paymentMethod !== 'cod')   throw new BusinessRuleError('Yeh COD order nahi hai');

  // [D3a] Idempotent terminal state — a retried collection succeeds WITHOUT re-crediting.
  //       (Must precede assertTransition, which treats delivered→delivered as a no-op.)
  if (order.status === 'delivered') return { message: 'Cash collection confirm ho gaya' };

  // [D2] State machine — 'delivered' is legal ONLY from 'out_for_delivery'
  //      (ORDER_TRANSITIONS single source of truth). Rejects confirmed/preparing/ready/picked_up.
  assertTransition(order.status, 'delivered');

  // [D1] Server-derived amount — the client value is never trusted or written.
  const amountDue = order.totalAmount;
  if (amountPaise != null && amountPaise !== amountDue) {
    console.warn(`COD amount mismatch (ignored) order=${orderId} sent=${amountPaise} due=${amountDue}`);
  }

  // [D3b] Compare-and-set: only the call that actually flips out_for_delivery → delivered
  //       writes history + credits the balance — race-safe against concurrent double-submit.
  const credited = await prisma.$transaction(async (tx) => {
    const flip = await tx.order.updateMany({
      where: { id: orderId, status: 'out_for_delivery' },
      data:  { status: 'delivered', deliveredAt: new Date(), codCollectedPaise: amountDue },
    });
    if (flip.count === 0) return false;                 // concurrent call already delivered it
    await tx.orderStatusHistory.create({
      data: { orderId, status: 'delivered', changedByRole: 'rider', changedById: riderUserId },
    });
    await tx.riderProfile.update({
      where: { id: riderProfileId },                    // BUG-1 keying preserved (RiderProfile.id)
      data:  { codBalancePaise: { increment: amountDue } },
    });
    return true;
  });

  if (credited) {
    emitOrderStatusChanged({
      orderId, status: 'delivered',
      shopId: order.shopId, sellerId: '', riderId: riderProfileId, customerId: order.customerId,
    });
  }
  return { message: 'Cash collection confirm ho gaya' };
}
```

Notes:
- `assertTransition` is already defined+exported in this module (`orders.service.ts:92`) — no import needed.
- The transaction moves from **array form** to **callback (interactive) form** to read `updateMany`'s
  count and branch. This is the main structural change; atomicity is preserved (all writes in one tx).
- `assertTransition` (clear error for illegal *read* state) + the `where:{status:'out_for_delivery'}`
  compare-and-set (atomic guard against a TOCTOU race / concurrent cancel) are complementary defense.

### 2b. `orders.schema.ts` — add validation (proposed)

```ts
export const codCollectedSchema = z.object({
  amountPaise: z.number().int().nonnegative().optional(),  // advisory; server derives the real value
});
export type CodCollectedInput = z.infer<typeof codCollectedSchema>;
```

### 2c. `orders.routes.ts` — `/:id/cod-collected` (proposed; replaces 119-126)

```ts
app.post('/:id/cod-collected',
  { preHandler: [requireRole('rider')] },
  async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const parsed = codCollectedSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    const result = await ordersService.codCollected(
      request.params.id, request.auth!.profileId, parsed.data.amountPaise, request.auth!.userId,
    );
    return reply.send(result);
  },
);
```
(`ValidationError` is already imported in this file; import `codCollectedSchema` from `./orders.schema`.)

---

## 3. All required test cases

File: `apps/api/src/modules/orders/__tests__/orders.cod-collected.test.ts`

**Harness changes (required, enabling):**
- Add `totalAmount: 16000` to the `codOrder` mock (`:20-23`) — the service now reads `order.totalAmount`.
- Update the prisma mock to **callback-form `$transaction`** and add `order.updateMany`:
  `$transaction: vi.fn((fn) => fn(tx))`, where `tx.order.updateMany` returns `{ count: 1 }` (configurable),
  plus `tx.orderStatusHistory.create` and `tx.riderProfile.update`.

**Test matrix:**

| Case | Setup | Assert |
|------|-------|--------|
| Happy path (legal state, derived amount) | status `out_for_delivery`, `totalAmount 16000`, call amount `16000` | `codCollectedPaise=16000`, `codBalancePaise +16000`, status `delivered`, history actor=`RIDER_USER`, emit called once |
| **D1 — client value ignored** | `totalAmount 16000`, call amount `1` | recorded `codCollectedPaise=16000` and increment `16000` (NOT `1`) |
| **D1 — no amount supplied** | `totalAmount 16000`, call amount `undefined` | records derived `16000`; no throw |
| **D2 — illegal from-state rejected** | status `confirmed` (also param: `preparing`, `ready_for_pickup`, `picked_up`) | throws `BusinessRuleError` (Illegal transition); `updateMany`/`riderProfile.update` **not** called |
| **D3 — idempotent retry (already delivered)** | status `delivered` | returns success; `riderProfile.update` **not** called (no second credit) |
| **D3 — concurrent flip lost (compare-and-set)** | status `out_for_delivery` but `updateMany` mocked → `{ count: 0 }` | `riderProfile.update` **not** called; no emit (no double credit) |
| Existing — wrong owner | `riderId='other'` | throws Forbidden; no writes |
| Existing — non-COD | `paymentMethod='upi'` | throws BusinessRule; no writes |
| Existing — missing order | order `null` | throws NotFound |

**Optional (route-level):** malformed body (`amountPaise: "x"`) → `400` via `codCollectedSchema`.

---

## 4. Rollout risk

- **Overall: low–moderate.** API-only; no DB migration; one contained service function + route + schema + test.
- **Main implementation risk:** the **array→callback transaction refactor**. Must preserve (a) atomicity of status+history+balance, and (b) the BUG-1 keying (`riderProfile.update where id`). Covered by the happy-path + concurrent tests.
- **Behavioral change (intended):** `cod-collected` now returns **422** from non-`out_for_delivery` states. **Verified safe for the app** (§5) — only out-of-band/abusive callers are rejected.
- **Behavioral change (intended):** a retry on a `delivered` order now returns success **without** a second credit (previously double-credited). Response message unchanged → clients unaffected.
- **No deploy-ordering constraint:** no schema migration, no client dependency; API can ship independently.
- **Observability:** the mismatch `console.warn` gives early signal of any client/display drift or tampering attempts post-deploy.

---

## 5. Backward-compatibility impact

| Surface | Impact |
|---------|--------|
| **HTTP contract** | Path/verb/response unchanged. Body `{ amountPaise }` becomes **optional and ignored** (server derives). Non-breaking. |
| **Current rider app — amount (D1)** | `DeliveryScreen.tsx:78` sends `stop.totalAmount` (= `order.totalAmount`); now ignored in favor of the identical server value → **same result, no app release needed**. |
| **Current rider app — state guard (D2)** | **Verified compatible:** the deliver button (→ `collectCod`) is rendered **only when `o.status === 'out_for_delivery'`** (`DeliveryScreen.tsx:165-168`); from `picked_up` the app shows "Delivery Shuru" (start-delivery) instead. The app never calls `cod-collected` from an illegal state, so the new `assertTransition` never rejects a legitimate request. |
| **Current rider app — idempotency (D3)** | Normal single tap flips once / credits once; a retry or double-submit is now safely idempotent (was a double-credit). Success message unchanged. |
| **Out-of-band / non-app callers** | A caller posting from a non-`out_for_delivery` state, or re-posting a delivered order, is now correctly rejected / no-op'd. Intended hardening (this is the abuse surface). |
| **`packages/types` / `packages/api-client`** | No change — no shared DTO for this endpoint; customer client never exposed it. |
| **Other consumers** | None — `codCollected`/`cod-collected`/`collectCod` have exactly one production caller chain (rider app). |

---

## 6. Migration impact

- **DB schema / Prisma:** none. Reuses `Order.totalAmount`, `Order.codCollectedPaise`, `RiderProfile.codBalancePaise`.
- **Data migration to deploy:** none.
- **Optional historical remediation (separate finance/ops task, out of scope):** COD orders delivered
  before this fix may carry under-reported `codCollectedPaise` / low `codBalancePaise`; correct value
  for a delivered COD order is `Order.totalAmount`, but a backfill cannot distinguish honest legacy
  data from prior fraud and touches real rider balances — treat as a reconciliation decision, gated
  on BUG-003 (no deposit ledger exists to reconcile against today).

---

## 7. Verification steps (pre-merge)

1. Land service + schema + route + test changes together; run `apps/api` unit suite (all §3 cases green).
2. Sandbox: place a COD order, advance to `out_for_delivery`, POST `cod-collected` `{ "amountPaise": 0 }`
   → assert `cod_collected_paise == total_amount` and rider `cod_balance_paise` delta == total.
3. Sandbox negative: POST `cod-collected` on a `confirmed` order → expect 422 illegal-transition.
4. Sandbox idempotency: POST twice on the same delivered order → balance credited once.
5. Smoke the **unchanged** rider app: pickup → start-delivery → deliver completes normally.

---

## 8. Scope & adjacent notes
- This plan addresses **only BUG-001's three defects.** It does **not** touch BUG-002 (settlement
  over-pay), BUG-003 (no rider cash reconciliation), BUG-004 (float cap unenforced).
- `markDelivered` (prepaid sibling, `orders.service.ts:700-721`) shares D2/D3 patterns (bypasses
  `assertTransition`; no terminal-state guard) but has no cash credit, so the double-submit there is
  harmless. Aligning it (same `assertTransition` + terminal guard) is a low-priority consistency
  follow-up, not part of BUG-001.
- **No source code was modified.** Snippets are proposed illustrations only. Line numbers reflect
  branch `chore/harness-phase-0a` and may drift.
