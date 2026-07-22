import type { PrismaClient } from '@prisma/client';
import { confidence, type InventoryConfig } from './belief';
import { getInventoryConfig } from './inventory.config';

// ─── Morning verification card (Inventory Engine, S5) ─────────────────────────
// The only proactive verification the engine ever asks for, and it is targeted:
//   priority(item) = order_frequency_7d × (1 − confidence(now)) × value_weight
// — literally the expected cost of being wrong. Only COUNT-TRACKED items ever
// appear (binary tail is exempt from verification pressure by design), and only
// items that were actually ordered recently (zero demand ⇒ zero priority ⇒ not
// worth the seller's thumb). Answered via PATCH /catalog/products/:id/verify,
// which raises confidence and drops the item off tomorrow's card.

export interface MorningCardItem {
  productId: string;
  name: string;
  imageUrl: string | null;
  expectedQty: number;
  confidence: number; // 0..1 at computation time
  priority: number;
}

export async function getMorningCard(
  prisma: PrismaClient,
  shopId: string,
  cfgIn?: InventoryConfig,
  now: Date = new Date(),
): Promise<MorningCardItem[]> {
  const cfg = cfgIn ?? await getInventoryConfig(prisma);

  const tracked = await prisma.product.findMany({
    where: {
      shopId, isActive: true,
      inventoryState: { isNot: null, is: { expectedQty: { not: null } } },
    },
    select: {
      id: true, name: true, price: true,
      images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
      inventoryState: {
        select: {
          expectedQty: true, reservedQty: true, velocityClass: true,
          confidenceBase: true, lastVerifiedAt: true,
        },
      },
    },
  });
  if (tracked.length === 0) return [];

  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const freq = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: {
      productId: { in: tracked.map((p) => p.id) },
      order: { shopId, createdAt: { gte: since }, status: { not: 'cancelled' } },
    },
    _count: { productId: true },
  });
  const freqByProduct = new Map(freq.map((f) => [f.productId, f._count.productId]));

  const items: MorningCardItem[] = [];
  for (const p of tracked) {
    const s = p.inventoryState;
    if (!s || s.expectedQty == null) continue;
    const orders7d = freqByProduct.get(p.id) ?? 0;
    if (orders7d === 0) continue; // no demand → not worth a question
    const conf = confidence({
      expectedQty: s.expectedQty, reservedQty: s.reservedQty,
      velocityClass: s.velocityClass, confidenceBase: Number(s.confidenceBase),
      lastVerifiedAt: s.lastVerifiedAt,
    }, cfg, now);
    const priority = orders7d * (1 - conf) * (p.price / 100); // value weight in rupees
    if (priority <= 0) continue;
    items.push({
      productId: p.id, name: p.name, imageUrl: p.images[0]?.url ?? null,
      expectedQty: s.expectedQty, confidence: Number(conf.toFixed(3)),
      priority: Number(priority.toFixed(2)),
    });
  }

  return items.sort((a, b) => b.priority - a.priority).slice(0, cfg.morningCardN);
}
