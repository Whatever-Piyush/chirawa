import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aggregateTiles, createAggregationService, type AggInputProduct } from '../aggregation.service';

const img = (url: string) => [{ url }];
const approvedMaster = (over: Record<string, unknown> = {}) => ({
  id: 'm_maggi', status: 'approved', name: 'Maggi Noodles', imageUrl: 'https://cdn/maggi.webp',
  mrpPaise: 1500, unit: '70 g', brand: 'Nestlé', ...over,
});

function prod(over: Partial<AggInputProduct>): AggInputProduct {
  return { id: 'p', name: 'X', price: 1400, mrpPaise: null, unit: null, images: [], master: null, ...over };
}

describe('aggregateTiles', () => {
  it('collapses the same master across 3 shops into ONE tile at the lowest in-stock price', () => {
    const tiles = aggregateTiles([
      prod({ id: 'p1', price: 1600, master: approvedMaster() }),
      prod({ id: 'p2', price: 1400, master: approvedMaster() }), // cheapest
      prod({ id: 'p3', price: 1500, master: approvedMaster() }),
    ]);

    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      masterId: 'm_maggi', name: 'Maggi Noodles', imageUrl: 'https://cdn/maggi.webp',
      pricePaise: 1400,            // lowest in-stock
      productId: 'p2',             // cheapest shop's product (the representative)
      shopCount: 3,                // shop identity hidden, count surfaced
    });
  });

  it('passes through products whose master is NOT approved (needs_review gate)', () => {
    const tiles = aggregateTiles([
      prod({ id: 'p1', name: 'Local Pede', price: 5000, master: null }),
      prod({ id: 'p2', name: 'Unapproved', price: 2000, master: approvedMaster({ id: 'm2', status: 'needs_review', name: 'Should NOT show' }) }),
    ]);
    // Both become passthrough tiles using the PRODUCT's own name (not the master's).
    expect(tiles).toHaveLength(2);
    expect(tiles.map((t) => t.name).sort()).toEqual(['Local Pede', 'Unapproved']);
    expect(tiles.every((t) => t.masterId === null)).toBe(true);
  });

  it('mixes aggregated + passthrough tiles, sorted by name', () => {
    const tiles = aggregateTiles([
      prod({ id: 'p1', name: 'Zzz Item', price: 100, master: null }),
      prod({ id: 'p2', price: 1400, master: approvedMaster() }),
      prod({ id: 'p3', price: 1500, master: approvedMaster() }),
    ]);
    expect(tiles.map((t) => t.name)).toEqual(['Maggi Noodles', 'Zzz Item']);
  });
});

describe('createAggregationService.getFeed', () => {
  const tileJson = JSON.stringify([{ masterId: 'm', productId: 'p', name: 'Cached', imageUrl: null, pricePaise: 100, mrpPaise: null, unit: null, brand: null, shopCount: 1 }]);

  function makeRedis(over: Record<string, unknown> = {}) {
    return { get: vi.fn(), set: vi.fn(), setex: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1), ...over };
  }
  const prisma = { product: { findMany: vi.fn().mockResolvedValue([
    { id: 'p2', name: 'X', price: 1400, mrpPaise: null, unit: null, images: img('u'), master: approvedMaster() },
  ]) } };

  beforeEach(() => { prisma.product.findMany.mockClear(); });

  it('returns the cached feed without hitting the DB', async () => {
    const redis = makeRedis({ get: vi.fn().mockResolvedValue(tileJson) });
    const svc = createAggregationService(prisma as never, redis as never);
    const feed = await svc.getFeed();
    expect(feed[0]!.name).toBe('Cached');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('on a cache miss, takes the lock, builds, and caches with a jittered TTL', async () => {
    const redis = makeRedis({ get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') });
    const svc = createAggregationService(prisma as never, redis as never, { ttlSeconds: 100, jitterSeconds: 20 });
    const feed = await svc.getFeed();

    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ masterId: 'm_maggi', pricePaise: 1400 });
    expect(redis.set).toHaveBeenCalledWith(expect.any(String), '1', 'PX', expect.any(Number), 'NX'); // lock
    const ttl = (redis.setex as ReturnType<typeof vi.fn>).mock.calls[0]![1] as number;
    expect(ttl).toBeGreaterThanOrEqual(100);
    expect(ttl).toBeLessThanOrEqual(120);
    expect(redis.del).toHaveBeenCalled(); // lock released
  });

  it('under lock contention, waits for the holder’s cache instead of rebuilding', async () => {
    // get: miss, miss (during poll), then the holder populated it.
    const get = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(tileJson);
    const redis = makeRedis({ get, set: vi.fn().mockResolvedValue(null) }); // lock NOT acquired
    const sleep = vi.fn().mockResolvedValue(undefined);
    const svc = createAggregationService(prisma as never, redis as never, { sleep });

    const feed = await svc.getFeed();
    expect(feed[0]!.name).toBe('Cached');          // got the holder's result
    expect(prisma.product.findMany).not.toHaveBeenCalled(); // did NOT rebuild
    expect(sleep).toHaveBeenCalled();
  });
});
