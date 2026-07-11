import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

// ─── One-time inventory_state backfill (Inventory Engine cutover) ─────────────
// Creates the 1:1 inventory_state row for every product:
//   - products with a numeric stockQty become TRACKED (expectedQty = stockQty,
//     medium velocity class, confidenceBase 0.85, verified now via 'backfill'),
//   - products without become BINARY (expectedQty null — availability stays
//     governed by products.stockStatus exactly as before the engine).
// Idempotent: rerunning skips products that already have a state row.
//
// Run: pnpm --filter @chirawa/api db:backfill:inventory

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const products = await prisma.product.findMany({
    where: { inventoryState: null },
    select: { id: true, shopId: true, stockQty: true },
  });
  console.log(`Backfilling inventory_state for ${products.length} products…`);

  let tracked = 0;
  let binary = 0;
  const now = new Date();

  for (const p of products) {
    const isTracked = p.stockQty != null;
    await prisma.$transaction([
      prisma.inventoryState.create({
        data: {
          productId: p.id,
          expectedQty: p.stockQty,
          velocityClass: isTracked ? 2 : null,
          confidenceBase: isTracked ? 0.85 : 0.8,
          ...(isTracked
            ? { lastVerifiedAt: now, lastVerifiedSource: 'backfill', lastVerifiedQty: p.stockQty }
            : {}),
        },
      }),
      prisma.inventoryEvent.create({
        data: {
          productId: p.id,
          shopId: p.shopId,
          eventType: 'backfill',
          qtyAfter: p.stockQty,
          reservedAfter: 0,
          confidenceAfter: isTracked ? 0.85 : 0.8,
          actorType: 'system',
          reason: 'inventory engine cutover',
        },
      }),
    ]);
    if (isTracked) tracked += 1;
    else binary += 1;
  }

  console.log(`Done. tracked=${tracked} binary=${binary}`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
