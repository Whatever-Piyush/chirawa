import { describe, it, expect } from 'vitest';
import { pickDailyEssentials, DAILY_ESSENTIALS, type Essential, type AggTile } from '../aggregation.service';

// Pure resolver for the Home "Daily Essentials" rail (TOP_SELLING_SKUS.md): picks
// curated everyday SKUs from a live aggregated feed, in priority order. No DB.
const tile = (productId: string, name: string, price = 1000): AggTile => ({
  masterId: null, productId, name, imageUrl: null,
  pricePaise: price, mrpPaise: null, unit: null, brand: null, shopCount: 1,
});

describe('pickDailyEssentials', () => {
  it('returns essentials in curated priority order, exact SKU preferred', () => {
    const tiles = [
      tile('p-bread', 'Britannia Whole Wheat Bread'),
      tile('p-milk',  'Amul Taaza Toned Milk'),
      tile('p-eggs',  'Farm Fresh Eggs'),
    ];
    // Curated order is milk → bread → eggs regardless of feed order.
    expect(pickDailyEssentials(tiles).map((t) => t.productId)).toEqual(['p-milk', 'p-bread', 'p-eggs']);
  });

  it('skips essentials with no in-stock tile (out of stock → absent from feed)', () => {
    const tiles = [tile('p-milk', 'Amul Taaza Toned Milk')];
    expect(pickDailyEssentials(tiles).map((t) => t.name)).toEqual(['Amul Taaza Toned Milk']);
  });

  it('falls back to a keyword match when the exact SKU is absent', () => {
    const ess: Essential[] = [{ key: 'milk', prefer: 'Amul Taaza Toned Milk', match: /toned milk/i }];
    const tiles = [tile('p-md', 'Mother Dairy Toned Milk')];
    expect(pickDailyEssentials(tiles, ess).map((t) => t.productId)).toEqual(['p-md']);
  });

  it('cooking-oil essential does not grab hair oil (keyword fallback)', () => {
    const ess = DAILY_ESSENTIALS.filter((e) => e.key === 'oil' || e.key === 'hairoil');
    const tiles = [tile('p-hair', 'Dabur Amla Hair Oil'), tile('p-cook', 'Saffola Gold Edible Oil')];
    const out = pickDailyEssentials(tiles, ess);
    expect(out.map((t) => t.productId)).toEqual(['p-cook', 'p-hair']); // oil→edible, hairoil→hair
  });

  it('never reuses a tile and respects the limit', () => {
    const tiles = DAILY_ESSENTIALS.map((e, i) => tile(`p${i}`, e.prefer));
    const out = pickDailyEssentials(tiles, DAILY_ESSENTIALS, 5);
    expect(out).toHaveLength(5);
    expect(new Set(out.map((t) => t.productId)).size).toBe(5);
  });

  it('does not match tomato ketchup for the tomato essential', () => {
    const ess = DAILY_ESSENTIALS.filter((e) => e.key === 'tomato');
    const tiles = [tile('p-ketchup', 'Kissan Fresh Tomato Ketchup')];
    expect(pickDailyEssentials(tiles, ess)).toEqual([]);
  });
});
