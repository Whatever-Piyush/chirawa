import type { Prisma } from '@prisma/client';
import { BusinessRuleError } from '../../shared/errors/app-errors';
import { getInventoryConfig } from '../inventory/inventory.config';
import {
  commitReservationsForOrder, releaseReservationsForOrder,
  type ReservationTx,
} from '../inventory/reservations.service';

// ── Order state machine (Phase 1.7) ──────────────────────────────────────────
// Single source of truth for legal status transitions. Keeps illegal jumps
// (e.g. confirmed→ready_for_pickup, skipping preparing) out of the DB.
export const ORDER_TRANSITIONS: Record<string, readonly string[]> = {
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

// Throws BusinessRuleError on an illegal transition. A same-status write is
// treated as an idempotent no-op (e.g. accepting an already-confirmed COD order).
export function assertTransition(from: string, to: string): void {
  if (from === to) return;
  const allowed = ORDER_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new BusinessRuleError(`Illegal order transition: ${from} → ${to}`);
  }
}

// Timestamp column stamped when an order enters a given status (paid /
// pending_payment carry no timestamp, matching prior behaviour).
const STATUS_TIMESTAMP: Record<string, string | undefined> = {
  confirmed:        'confirmedAt',
  preparing:        'preparingAt',
  ready_for_pickup: 'readyAt',
  picked_up:        'pickedUpAt',
  out_for_delivery: 'outForDeliveryAt',
  delivered:        'deliveredAt',
  cancelled:        'cancelledAt',
};

export interface TransitionActor { role: string; id: string; reason?: string }

/**
 * THE single enforcement point for `Order.status` mutations.
 *
 * 1. `assertTransition(from, to)` — rejects any illegal jump BEFORE writing.
 * 2. Atomic compare-and-set — only flips a row that is still at `from`
 *    (`updateMany WHERE status = from`); a concurrent writer that already moved
 *    it yields `count === 0` and we report `false` without re-stamping.
 * 3. Writes the `OrderStatusHistory` row for the actor.
 *
 * Runs inside a caller-supplied transaction so the status flip is atomic with the
 * caller's other writes (cash credit, payment capture, refund ledger, …). Returns
 * `true` when the row was flipped, `false` on a lost race. Throws on illegal moves.
 *
 * `extraData` is merged into the order update (e.g. `{ codCollectedPaise }`).
 *
 * INVENTORY HOOKS (Inventory Engine): the stock lifecycle rides the status flip,
 * in the SAME transaction, so no call site can ever forget it —
 *   → picked_up  : COMMIT the order's held reservations (rider-witnessed shelf
 *                  departure; expected −= qty). Idempotent claim.
 *   → cancelled  : RELEASE the order's held reservations (goods never left).
 *                  Post-pickup cancels no-op — those holds are already committed.
 * Every cancel path (customer, seller reject, rider line-miss, admin) already
 * goes through this function, which is exactly why the hooks live here.
 */
export async function transitionOrderStatus(
  tx: Prisma.TransactionClient,
  orderId: string,
  from: string,
  to: string,
  actor: TransitionActor,
  extraData: Record<string, unknown> = {},
): Promise<boolean> {
  assertTransition(from, to);

  const data: Record<string, unknown> = { status: to, ...extraData };
  const tsField = STATUS_TIMESTAMP[to];
  if (tsField) data[tsField] = new Date();
  if (to === 'cancelled' && actor.reason != null) data['cancelReason'] = actor.reason;

  const res = await tx.order.updateMany({ where: { id: orderId, status: from }, data } as never);
  if (res.count === 0) return false;

  await tx.orderStatusHistory.create({
    data: { orderId, status: to, changedByRole: actor.role, changedById: actor.id, reason: actor.reason },
  } as never);

  if (to === 'picked_up' || to === 'cancelled') {
    const invTx = tx as unknown as ReservationTx;
    const cfg = await getInventoryConfig(tx as never);
    const invActor = { role: actor.role, id: actor.id };
    if (to === 'picked_up') {
      await commitReservationsForOrder(invTx, orderId, invActor, cfg);
    } else {
      await releaseReservationsForOrder(invTx, orderId, invActor, cfg, new Date(), actor.reason ?? null);
    }
  }
  return true;
}
