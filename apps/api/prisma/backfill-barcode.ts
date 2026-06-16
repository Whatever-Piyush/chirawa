/**
 * One-off backfill (Catalog Engine Phase 0): copy a valid GTIN from a product's
 * ProductVariant.sku into Product.barcode, so existing inventory gains the
 * catalog join key without needing a re-import.
 *
 * Rules (deliberately conservative — this writes the matching key):
 *  - Only touches products whose `barcode` is still NULL → idempotent, re-runnable.
 *  - A variant `sku` counts only if it passes the GS1 check digit (isValidEan);
 *    free-text / internal SKUs are ignored, never matched.
 *  - Exactly one distinct valid GTIN across a product's variants → set it.
 *  - Several different valid GTINs (distinct pack sizes share one parent) → skip
 *    and log for manual review; we never guess which pack the parent represents.
 *
 * Run: pnpm --filter @chirawa/api db:backfill:barcode
 *  (or: tsx prisma/backfill-barcode.ts)
 */
import { PrismaClient } from '@prisma/client';
import { isValidEan } from '../src/shared/utils/barcode';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const products = await prisma.product.findMany({
    where: { barcode: null, variants: { some: { sku: { not: null } } } },
    select: { id: true, name: true, variants: { select: { sku: true } } },
  });

  let updated = 0;
  let ambiguous = 0;
  let noValid = 0;

  for (const p of products) {
    const validGtins = [...new Set(
      p.variants
        .map((v) => v.sku?.trim())
        .filter((s): s is string => !!s && isValidEan(s)),
    )];

    if (validGtins.length === 0) { noValid++; continue; }
    if (validGtins.length > 1) {
      ambiguous++;
      console.warn(`⏭️  ${p.name} (${p.id}) — ${validGtins.length} distinct GTIN skus ${JSON.stringify(validGtins)}; skipped for manual review`);
      continue;
    }

    await prisma.product.update({ where: { id: p.id }, data: { barcode: validGtins[0]! } });
    updated++;
  }

  console.log(`\n✅ Barcode backfill complete: ${updated} updated, ${ambiguous} ambiguous, ${noValid} no-valid-sku — of ${products.length} candidate product(s).`);
}

main()
  .catch((err) => { console.error('❌ Barcode backfill failed:', err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
