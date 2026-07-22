import { describe, it, expect, vi } from 'vitest';
import { getMorningCard } from '../morning-card.service';
import { DEFAULT_INVENTORY_CONFIG } from '../belief';

const cfg = DEFAULT_INVENTORY_CONFIG;
const NOW = new Date('2026-07-07T09:00:00Z');

// Tracked product with a controllable staleness (hours since verification).
function product(id: string, opts: { price?: number; staleHours?: number; velocityClass?: number } = {}) {
  return {
    id, name: `P-${id}`, price: opts.price ?? 2000,
    images: [],
    inventoryState: {
      expectedQty: 10, reservedQty: 0,
      velocityClass: opts.velocityClass ?? 3,
      confidenceBase: 0.95,
      lastVerifiedAt: new Date(NOW.getTime() - (opts.staleHours ?? 0) * 3_600_000),
    },
  };
}

function makePrisma(products: unknown[], freq: Array<{ productId: string; _count: { productId: number } }>) {
  return {
    product: { findMany: vi.fn(async () => products) },
    orderItem: { groupBy: vi.fn(async () => freq) },
    appConfig: { findMany: vi.fn(async () => []) },
  };
}

describe('getMorningCard — expected cost of being wrong', () => {
  it('ranks by demand × doubt × value and caps at N', async () => {
    const products = Array.from({ length: 12 }, (_, i) => product(`p${i}`, { staleHours: 30 }));
    const freq = products.map((p, i) => ({ productId: (p as { id: string }).id, _count: { productId: 12 - i } }));
    const prisma = makePrisma(products, freq);

    const card = await getMorningCard(prisma as never, 'shop1', cfg, NOW);
    expect(card).toHaveLength(cfg.morningCardN);
    // Highest 7-day demand tops the card (same doubt + value everywhere else).
    expect(card[0]!.productId).toBe('p0');
    // Priorities descend.
    for (let i = 1; i < card.length; i++) {
      expect(card[i]!.priority).toBeLessThanOrEqual(card[i - 1]!.priority);
    }
  });

  it('excludes items nobody ordered — zero demand is not worth a question', async () => {
    const prisma = makePrisma([product('quiet', { staleHours: 100 })], []);
    const card = await getMorningCard(prisma as never, 'shop1', cfg, NOW);
    expect(card).toEqual([]);
  });

  it('a fresh verification pushes an item off the card (doubt ≈ 0)', async () => {
    const prisma = makePrisma(
      [product('fresh', { staleHours: 0 }), product('stale', { staleHours: 40 })],
      [
        { productId: 'fresh', _count: { productId: 5 } },
        { productId: 'stale', _count: { productId: 5 } },
      ],
    );
    const card = await getMorningCard(prisma as never, 'shop1', cfg, NOW);
    expect(card[0]!.productId).toBe('stale');
    const fresh = card.find((c) => c.productId === 'fresh');
    const stale = card.find((c) => c.productId === 'stale');
    expect(stale!.priority).toBeGreaterThan(fresh?.priority ?? 0);
  });
});
