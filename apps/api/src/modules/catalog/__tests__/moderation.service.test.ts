import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createModerationService } from '../moderation.service';
import { AGG_CACHE_KEY } from '../aggregation.service';

const redisMock = () => ({ del: vi.fn(async () => 1) });

describe('setMasterStatus (Phase 7 approve gate)', () => {
  it('updates status and busts the aggregated feed cache', async () => {
    const prisma = { masterCatalog: { update: vi.fn(async () => ({ id: 'm1', status: 'approved' })) } };
    const redis = redisMock();
    const svc = createModerationService(prisma as never, redis as never);

    await svc.setMasterStatus('m1', 'approved');
    expect(prisma.masterCatalog.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1' }, data: { status: 'approved' } }));
    expect(redis.del).toHaveBeenCalledWith(AGG_CACHE_KEY);
  });
});

describe('takedownImage (Phase 7 legal takedown)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function setup(updateReturn: Record<string, unknown>) {
    const prisma = {
      masterCatalog: { update: vi.fn(async () => updateReturn) },
      imageReport:   { updateMany: vi.fn(async () => ({ count: 2 })) },
    };
    const redis = redisMock();
    return { prisma, redis, svc: createModerationService(prisma as never, redis as never) };
  }

  it('REPLACE swaps in an owned image and approves', async () => {
    const { prisma, redis, svc } = setup({ id: 'm1', status: 'approved', imageUrl: 'NEW' });
    const res = await svc.takedownImage('m1', { replaceImageUrl: 'NEW' });

    expect(prisma.masterCatalog.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ imageUrl: 'NEW', imageSource: 'manual', imageLicense: 'owned', imageAttribution: null, status: 'approved' }),
    }));
    expect(prisma.imageReport.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { masterId: 'm1', resolvedAt: null } }));
    expect(redis.del).toHaveBeenCalledWith(AGG_CACHE_KEY);
    expect(res.replaced).toBe(true);
  });

  it('REMOVE clears the image + provenance and re-gates to needs_review', async () => {
    const { prisma, svc } = setup({ id: 'm1', status: 'needs_review', imageUrl: null });
    const res = await svc.takedownImage('m1');

    expect(prisma.masterCatalog.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ imageUrl: null, imageSource: null, status: 'needs_review' }),
    }));
    expect(res.replaced).toBe(false);
  });
});

describe('listPriceOutliers (Phase 7)', () => {
  it('flags price over own MRP and over master MRP, ignores compliant rows', async () => {
    const prisma = {
      product: {
        findMany: vi.fn(async () => [
          { id: 'p1', shopId: 's1', name: 'Over own',     price: 1200, mrpPaise: 1000, master: null },
          { id: 'p2', shopId: 's1', name: 'Compliant',    price: 900,  mrpPaise: 1000, master: null },
          { id: 'p3', shopId: 's2', name: 'Over master',  price: 1500, mrpPaise: null, master: { mrpPaise: 1000 } },
        ]),
      },
    };
    const svc = createModerationService(prisma as never, redisMock() as never);

    const out = await svc.listPriceOutliers();
    expect(out.map((o) => o.productId)).toEqual(['p1', 'p3']);
    expect(out[0]!.reason).toBe('price_over_mrp');
    expect(out[1]!.reason).toBe('price_over_master_mrp');
  });
});

describe('getCoverage (Phase 7 dashboard)', () => {
  it('computes image/barcode pct + enrichment success from counts', async () => {
    const prisma = {
      product: {
        count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          where.OR ? 80 : where.barcode ? 60 : 100),
      },
      masterCatalog: {
        groupBy: vi.fn(async ({ by }: { by: string[] }) =>
          by[0] === 'status'
            ? [{ status: 'approved', _count: { _all: 50 } }, { status: 'needs_review', _count: { _all: 30 } }]
            : [{ enrichmentStatus: 'enriched', _count: { _all: 40 } }, { enrichmentStatus: 'needs_manual', _count: { _all: 10 } }, { enrichmentStatus: null, _count: { _all: 20 } }]),
      },
    };
    const svc = createModerationService(prisma as never, redisMock() as never);

    const cov = await svc.getCoverage();
    expect(cov.activeProducts).toBe(100);
    expect(cov.withImagePct).toBe(80);
    expect(cov.withBarcodePct).toBe(60);
    expect(cov.masterStatus.approved).toBe(50);
    expect(cov.enrichment).toMatchObject({ enriched: 40, needs_manual: 10, unattempted: 20 });
    expect(cov.enrichmentSuccessRate).toBe(80); // 40 / (40+10+0)
    expect(cov.needsManualCount).toBe(10);
  });
});

describe('getMetrics (Phase 7 alerts)', () => {
  it('computes rates and flags threshold breaches', async () => {
    const prisma = {
      masterCatalog: {
        groupBy: vi.fn(async () => [
          { enrichmentStatus: 'enriched', _count: { _all: 40 } },
          { enrichmentStatus: 'needs_manual', _count: { _all: 30 } },
          { enrichmentStatus: 'error', _count: { _all: 30 } },
        ]),
      },
      orderItem: { count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => (where.fulfillmentStatus ? 10 : 100)) },
      imageReport: { count: vi.fn(async () => 5) },
    };
    const svc = createModerationService(prisma as never, redisMock() as never);

    const m = await svc.getMetrics();
    const byKey = Object.fromEntries(m.metrics.map((x) => [x.key, x]));
    expect(byKey.enrichmentFailRate!.value).toBe(0.6);   // (30+30)/100
    expect(byKey.enrichmentFailRate!.breached).toBe(true); // > 0.5
    expect(byKey.failedPickupRate!.value).toBe(0.1);      // 10/100
    expect(byKey.failedPickupRate!.breached).toBe(true);  // > 0.05
    expect(byKey.openImageReports!.breached).toBe(false); // 5 < 10
    expect(m.alerts).toHaveLength(2);
  });
});
