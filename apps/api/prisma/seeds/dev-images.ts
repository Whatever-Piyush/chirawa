import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { assertSeedableEnvironment } from '../seed-guard';

// ─── Dev-only image seed (NOT production) ────────────────────────────────────
// The catalog seed is intentionally imageless (commit ae68a45) — production
// images come from the enrichment pipeline → R2. This optional dev seed attaches
// ONE deterministic, category-relevant placeholder image to every active product
// that has none, so the home (For You · Bestsellers clusters · category tiles
// incl. Beauty & Personal Care + Household Essentials) shows real visuals locally.
//
// Idempotent: a stable image id per product; never clobbers a product that
// already has an image (e.g. a real pipeline/R2 image). Safe to re-run.
//   Run:  pnpm --filter @chirawa/api db:seed:images

const prisma = new PrismaClient();

// Category → loremflickr keyword(s): deterministic, category-relevant images so
// e.g. Bath & Body shows soap shots, Hair Care shows shampoo, etc.
const KEYWORDS: Record<string, string> = {
  'Grocery & Kitchen':     'grocery,flour',
  'Dairy & Bread':         'milk,dairy',
  'Snacks & Drinks':       'snacks,chips',
  'Vegetables':            'vegetables',
  'Fruits':                'fruit',
  'Mangoes & Melons':      'mango',
  'Dry Fruits & Nuts':     'nuts,almonds',
  'Bakery':                'bakery,bread',
  'Sauces & Spreads':      'sauce,condiment',
  'Sweets & Mithai':       'indian,sweets',
  'Bath & Body':           'soap,bodywash',
  'Hair Care':             'shampoo,haircare',
  'Skin & Face':           'skincare,lotion',
  'Beauty & Cosmetics':    'cosmetics,makeup',
  'Feminine Hygiene':      'hygiene,care',
  'Baby Care':             'baby,care',
  'Health & Pharma':       'medicine,pharmacy',
  'Sexual Wellness':       'wellness,care',
  'Home & Lifestyle':      'home,decor',
  'Cleaners & Repellents': 'cleaning,detergent',
  'Electronics':           'electronics,gadget',
  'Stationery & Games':    'stationery,games',
};
const DEFAULT_KW = 'product,grocery';

// Stable 36-char UUID from a seed string (mirrors shops.ts) so re-runs upsert the
// same row instead of duplicating.
function stableUuid(seed: string): string {
  const h = createHash('md5').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// Deterministic per-product lock → a varied but stable image within the category
// keyword, so a category's cluster shows distinct images.
function lockFor(seed: string): number {
  return parseInt(createHash('md5').update(seed).digest('hex').slice(0, 6), 16) % 100000;
}

function devImageUrl(categoryName: string | null, productId: string): string {
  const kw = (categoryName && KEYWORDS[categoryName]) || DEFAULT_KW;
  return `https://loremflickr.com/400/400/${encodeURIComponent(kw)}?lock=${lockFor(productId)}`;
}

async function main(): Promise<void> {
  assertSeedableEnvironment('db:seed:images'); // Phase 5 — placeholder images must never reach production
  console.log('🌱 Seeding DEV product images (placeholders)…');

  const products = await prisma.product.findMany({
    where:  { isActive: true },
    select: {
      id:       true,
      category: { select: { name: true } },
      images:   { take: 1, select: { id: true } },
    },
  });

  let created = 0;
  let skipped = 0;
  for (const p of products) {
    if (p.images.length > 0) { skipped++; continue; }   // keep any existing (real) image
    const id = stableUuid(`devimg:${p.id}`);
    await prisma.productImage.upsert({
      where:  { id },
      update: {},
      create: {
        id,
        productId: p.id,
        url:       devImageUrl(p.category?.name ?? null, p.id),
        sortOrder: 0,
        source:    'dev-seed',
        license:   'placeholder',
      },
    });
    created++;
  }

  console.log(`  ✅ Dev images: ${created} created, ${skipped} skipped (already had an image)`);
}

main()
  .catch((e) => { console.error('❌ Dev image seed failed:', e); process.exit(1); })
  .finally(() => { void prisma.$disconnect(); });
