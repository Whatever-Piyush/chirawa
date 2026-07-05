/**
 * One-off backfill (Seller Sprint 3): every product must belong to a category.
 * Moves each product that still has a NULL category into its shop's default
 * category (isDefault), creating that default lazily per shop via the same helper
 * the API uses at runtime — so backfilled and freshly-added products converge on
 * one default category per shop.
 *
 * Conservative + idempotent / re-runnable: only touches products whose categoryId
 * is still NULL; already-categorized products are never moved.
 *
 * Run: pnpm --filter @chirawa/api db:backfill:category
 *  (or: tsx prisma/backfill-category.ts)
 */
import { PrismaClient } from '@prisma/client';
import { getOrCreateDefaultCategoryId } from '../src/modules/catalog/inventory.service';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Shops that still have at least one uncategorized product.
  const shops = await prisma.product.findMany({
    where:    { categoryId: null },
    distinct: ['shopId'],
    select:   { shopId: true },
  });

  let productsMoved = 0;
  for (const { shopId } of shops) {
    const defaultCategoryId = await getOrCreateDefaultCategoryId(prisma, shopId);
    const res = await prisma.product.updateMany({
      where: { shopId, categoryId: null },
      data:  { categoryId: defaultCategoryId },
    });
    productsMoved += res.count;
  }

  console.log(`\n✅ Category backfill complete: moved ${productsMoved} product(s) into a default category across ${shops.length} shop(s).`);
}

main()
  .catch((err) => { console.error('❌ Category backfill failed:', err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
