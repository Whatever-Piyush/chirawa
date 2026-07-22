import type { PrismaClient } from '@prisma/client';
import { beliefBand } from './belief';
import { getInventoryConfig } from './inventory.config';

// ─── Inventory health (admin dashboard, Inventory Engine) ─────────────────────
// The weekly founder-review numbers (design Appendix B), computed live:
//   fill health   — rider misses vs delivered orders (7d)
//   auto-accept   — lines auto-accepted while unverified (the §17.2 canary)
//   belief bands  — tracked items by normal/flagged/hidden at read time
//   reservations  — held now / committed / expired / released (24h)
//   invariants    — live reserved-counter drift count (the reconciler's I2)

export interface InventoryHealth {
  window: { misses7d: number; delivered7d: number; missRatePct: number };
  autoAccept: { unverifiedLines7d: number };
  beliefBands: { tracked: number; normal: number; flagged: number; hidden: number; binary: number };
  reservations: { heldNow: number; committed24h: number; expired24h: number; released24h: number };
  invariants: { reservedCounterDrift: number };
}

export async function getInventoryHealth(prisma: PrismaClient): Promise<InventoryHealth> {
  const cfg = await getInventoryConfig(prisma);
  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const d1 = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [misses7d, delivered7d, unverified7d, states, heldNow, committed24h, expired24h, released24h, drift] =
    await Promise.all([
      prisma.inventoryEvent.count({ where: { eventType: 'rider_reported_missing', createdAt: { gte: d7 } } }),
      prisma.order.count({ where: { status: 'delivered', deliveredAt: { gte: d7 } } }),
      prisma.orderItem.count({ where: { verificationFlag: 'rider_verify_requested', createdAt: { gte: d7 } } }),
      prisma.inventoryState.findMany({
        select: {
          expectedQty: true, reservedQty: true, velocityClass: true,
          confidenceBase: true, lastVerifiedAt: true,
        },
      }),
      prisma.reservation.count({ where: { status: 'held' } }),
      prisma.reservation.count({ where: { status: 'committed', resolvedAt: { gte: d1 } } }),
      prisma.reservation.count({ where: { status: 'expired', resolvedAt: { gte: d1 } } }),
      prisma.reservation.count({ where: { status: 'released', resolvedAt: { gte: d1 } } }),
      prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM (
          SELECT s.product_id
          FROM inventory_state s
          LEFT JOIN reservations r ON r.product_id = s.product_id AND r.status = 'held'
          GROUP BY s.product_id, s.reserved_qty
          HAVING s.reserved_qty <> COALESCE(SUM(r.qty), 0)
        ) drift`,
    ]);

  const bands = { tracked: 0, normal: 0, flagged: 0, hidden: 0, binary: 0 };
  for (const s of states) {
    if (s.expectedQty == null) { bands.binary += 1; continue; }
    bands.tracked += 1;
    const band = beliefBand({
      expectedQty: s.expectedQty, reservedQty: s.reservedQty,
      velocityClass: s.velocityClass, confidenceBase: Number(s.confidenceBase),
      lastVerifiedAt: s.lastVerifiedAt,
    }, cfg, now);
    bands[band] += 1;
  }

  return {
    window: {
      misses7d,
      delivered7d,
      missRatePct: delivered7d > 0 ? Number(((misses7d / delivered7d) * 100).toFixed(2)) : 0,
    },
    autoAccept: { unverifiedLines7d: unverified7d },
    beliefBands: bands,
    reservations: { heldNow, committed24h, expired24h, released24h },
    invariants: { reservedCounterDrift: drift[0]?.count ?? 0 },
  };
}
