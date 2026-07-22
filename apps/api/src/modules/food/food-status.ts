import type { Prisma } from '@prisma/client';
import { BusinessRuleError } from '../../shared/errors/app-errors';

// ─── Food order state machine (Food.md §6) ────────────────────────────────────
// Deliberately mirrors modules/orders/order-status.ts — same status VOCABULARY,
// same single-enforcement-point + atomic compare-and-set PATTERN — but runs
// against food_orders. It is a scoped COPY, not an import of the marketplace
// machine: Food.md §6 chose isolation over DRY here so the marketplace file
// stays untouched and neither pipeline can accidentally couple to the other.
//
// Restaurant semantics of each hop:
//   pending_payment → paid              customer completed UPI payment
//   paid            → confirmed         restaurant ACCEPTED the order
//   confirmed       → preparing         kitchen started
//   preparing       → ready_for_pickup  food packed — rider can collect
//   ready_for_pickup→ picked_up         rider collected
//   picked_up       → out_for_delivery  rider en route
//   out_for_delivery→ delivered         done
//   (paid|confirmed|…) → cancelled      restaurant reject / customer cancel

export const FOOD_ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  pending_payment:  ['paid', 'cancelled'],
  paid:             ['confirmed', 'cancelled'],
  confirmed:        ['preparing', 'cancelled'],
  preparing:        ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['picked_up', 'cancelled'],
  picked_up:        ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered:        [],
  cancelled:        [],
};

// Same-status writes are idempotent no-ops (e.g. a double-tapped Accept).
export function assertFoodTransition(from: string, to: string): void {
  if (from === to) return;
  const allowed = FOOD_ORDER_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new BusinessRuleError(`Illegal food order transition: ${from} → ${to}`);
  }
}

const STATUS_TIMESTAMP: Record<string, string | undefined> = {
  paid:             'paidAt',
  confirmed:        'confirmedAt',
  preparing:        'preparingAt',
  ready_for_pickup: 'readyAt',
  picked_up:        'pickedUpAt',
  out_for_delivery: 'outForDeliveryAt',
  delivered:        'deliveredAt',
  cancelled:        'cancelledAt',
};

export interface FoodTransitionActor { role: string; id: string; reason?: string }

/**
 * THE single enforcement point for `FoodOrder.status` mutations.
 *
 * 1. `assertFoodTransition(from, to)` — rejects illegal jumps BEFORE writing.
 * 2. Atomic compare-and-set — flips only a row still at `from`
 *    (`updateMany WHERE status = from`); a concurrent writer that already moved
 *    it yields `count === 0` → returns `false` without re-stamping.
 * 3. Writes the FoodOrderStatusHistory row for the actor.
 *
 * Runs inside a caller-supplied transaction so the flip is atomic with the
 * caller's other writes (refund bookkeeping, rider claim, …).
 */
export async function transitionFoodOrderStatus(
  tx: Prisma.TransactionClient,
  foodOrderId: string,
  from: string,
  to: string,
  actor: FoodTransitionActor,
  extraData: Record<string, unknown> = {},
): Promise<boolean> {
  assertFoodTransition(from, to);

  const data: Record<string, unknown> = { status: to, ...extraData };
  const tsField = STATUS_TIMESTAMP[to];
  if (tsField) data[tsField] = new Date();
  if (to === 'cancelled' && actor.reason != null) data['cancelReason'] = actor.reason;

  const res = await tx.foodOrder.updateMany({ where: { id: foodOrderId, status: from }, data } as never);
  if (res.count === 0) return false;

  await tx.foodOrderStatusHistory.create({
    data: {
      foodOrderId,
      status: to,
      changedByRole: actor.role,
      changedById: actor.id,
      ...(actor.reason != null ? { reason: actor.reason } : {}),
    },
  });
  return true;
}
