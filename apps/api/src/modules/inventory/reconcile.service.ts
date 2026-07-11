import type { PrismaClient } from '@prisma/client';
import { getInventoryConfig } from './inventory.config';
import {
  commitReservationsForOrder, releaseReservationsForOrder, type ReservationTx,
} from './reservations.service';

// ─── Nightly inventory reconciler (Inventory Engine) ──────────────────────────
// Same discipline the payments got: webhooks lie, networks retry, processes die
// — so we assert the invariants every night and auto-fix the safe ones.
//
//   I1  every active product has an inventory_state row      → create (binary)
//   I2  reserved_qty == Σ reservations WHERE status='held'   → recount + event
//   I3  no held reservation on a terminal order              → commit (delivered)
//                                                              / release (cancelled)
//   I4  tracked expected_qty is never negative               → assert only
//                                                              (floored by design)
//
// The mismatch count is the health metric: it should trend to zero.

export interface ReconcileSummary {
  createdStateRows: number;
  reservedRecounts: number;
  terminalHeldFixed: number;
  negativeExpected: number;
}

export async function runInventoryReconciliation(prisma: PrismaClient): Promise<ReconcileSummary> {
  const cfg = await getInventoryConfig(prisma);
  const summary: ReconcileSummary = {
    createdStateRows: 0, reservedRecounts: 0, terminalHeldFixed: 0, negativeExpected: 0,
  };

  // I1 — products the engine doesn't know yet (created before the hooks, seeds).
  const missing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT p.id FROM products p
    LEFT JOIN inventory_state s ON s.product_id = p.id
    WHERE s.product_id IS NULL`;
  if (missing.length > 0) {
    await prisma.inventoryState.createMany({
      data: missing.map((m) => ({ productId: m.id })),
      skipDuplicates: true,
    });
    summary.createdStateRows = missing.length;
  }

  // I2 — the denormalized counter must equal the sum of held rows.
  const drift = await prisma.$queryRaw<Array<{ productId: string; reservedQty: number; held: number; shopId: string }>>`
    SELECT s.product_id AS "productId", s.reserved_qty AS "reservedQty",
           COALESCE(SUM(r.qty) FILTER (WHERE r.status = 'held'), 0)::int AS held,
           p.shop_id AS "shopId"
    FROM inventory_state s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN reservations r ON r.product_id = s.product_id
    GROUP BY s.product_id, s.reserved_qty, p.shop_id
    HAVING s.reserved_qty <> COALESCE(SUM(r.qty) FILTER (WHERE r.status = 'held'), 0)`;
  for (const row of drift) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE inventory_state SET reserved_qty = ${row.held}, updated_at = now()
        WHERE product_id = ${row.productId}::uuid`;
      await tx.inventoryEvent.create({
        data: {
          productId: row.productId, shopId: row.shopId, eventType: 'reconcile_fix',
          qtyDelta: null, reservedAfter: row.held,
          actorType: 'system',
          reason: `reserved_qty recount: ${row.reservedQty} → ${row.held}`,
        },
      });
    });
    summary.reservedRecounts += 1;
  }

  // I3 — a held reservation on a finished order means a hook was missed
  // (crash between claim and commit, pre-engine order, …). Replay the hook.
  const terminal = await prisma.$queryRaw<Array<{ orderId: string; status: string }>>`
    SELECT DISTINCT r.order_id AS "orderId", o.status
    FROM reservations r JOIN orders o ON o.id = r.order_id
    WHERE r.status = 'held' AND o.status IN ('delivered', 'cancelled')`;
  for (const row of terminal) {
    try {
      await prisma.$transaction(async (tx) => {
        const invTx = tx as unknown as ReservationTx;
        const actor = { role: 'system', id: null };
        if (row.status === 'delivered') await commitReservationsForOrder(invTx, row.orderId, actor, cfg);
        else await releaseReservationsForOrder(invTx, row.orderId, actor, cfg, new Date(), 'reconciler: terminal order');
      });
      summary.terminalHeldFixed += 1;
    } catch (err) {
      console.error(`[inventory] reconciler failed to fix order ${row.orderId}:`, err);
    }
  }

  // I4 — impossible by construction (GREATEST floors); if it ever fires, a write
  // path bypassed the module. Alert, don't guess a fix.
  const negative = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count FROM inventory_state WHERE expected_qty < 0`;
  summary.negativeExpected = negative[0]?.count ?? 0;

  const mismatches = summary.reservedRecounts + summary.terminalHeldFixed + summary.negativeExpected;
  console.log(
    `🧮 Inventory reconciler: stateRows+${summary.createdStateRows} recounts=${summary.reservedRecounts} ` +
    `terminalFixed=${summary.terminalHeldFixed} negative=${summary.negativeExpected} (mismatches=${mismatches})`,
  );
  return summary;
}
