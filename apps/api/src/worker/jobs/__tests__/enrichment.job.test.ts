import { describe, it, expect, vi } from 'vitest';
import { runCatalogEnrichment } from '../enrichment.job';
import type { OffProduct } from '../../../services/off-source';

const NOW = new Date('2026-06-14T00:00:00Z');

function master(over: Partial<{ id: string; barcode: string; brand: string | null; categoryName: string | null }> = {}) {
  return { id: 'm1', barcode: '8901725000011', brand: null, categoryName: null, ...over };
}

function offHit(over: Partial<OffProduct> = {}): OffProduct {
  return {
    barcode: '8901725000011', name: 'Atta', brand: 'Aashirvaad', categoryName: 'Flours',
    imageUrl: 'https://images.openfoodfacts.org/atta.jpg',
    source: 'open_food_facts', license: 'CC-BY-SA',
    attribution: 'https://world.openfoodfacts.org/product/8901725000011',
    ...over,
  };
}

function makePrisma(rows: ReturnType<typeof master>[]) {
  const update = vi.fn().mockResolvedValue({});
  const findMany = vi.fn().mockResolvedValue(rows);
  const prisma = { masterCatalog: { findMany, update } };
  return { prisma, update, findMany };
}

const baseDeps = (over: Record<string, unknown> = {}) => ({
  now: () => NOW,
  sleep: vi.fn().mockResolvedValue(undefined),
  minIntervalMs: 5,
  ...over,
});

describe('runCatalogEnrichment (Catalog Engine Phase 2)', () => {
  it('enriches a master found in OFF: re-hosted image + provenance, status stays needs_review', async () => {
    const p = makePrisma([master()]);
    const processImage = vi.fn(async () => ({ url: 'https://cdn.test/products/hash.webp', hash: 'hash', source: 'open_food_facts', license: 'CC-BY-SA', attribution: offHit().attribution }));
    const source = vi.fn(async () => offHit());
    const deps = baseDeps({ source, processImage });

    const res = await runCatalogEnrichment(p.prisma as never, deps as never);

    expect(res).toMatchObject({ scanned: 1, enriched: 1, needsManual: 0, errors: 0 });
    expect(processImage).toHaveBeenCalledWith({ url: offHit().imageUrl, source: 'open_food_facts', license: 'CC-BY-SA', attribution: offHit().attribution });
    expect(p.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: expect.objectContaining({
        imageUrl: 'https://cdn.test/products/hash.webp',
        imageSource: 'open_food_facts', imageLicense: 'CC-BY-SA', imageAttribution: offHit().attribution,
        enrichmentStatus: 'enriched', enrichmentNote: null, enrichmentAttemptedAt: NOW,
        brand: 'Aashirvaad', categoryName: 'Flours',  // backfilled (were null)
      }),
    });
    // status is NOT touched → stays needs_review (the moderation gate).
    expect(p.update.mock.calls[0]![0].data).not.toHaveProperty('status');
    expect(deps.sleep).toHaveBeenCalledWith(5);       // rate-limit gap after the fetch
  });

  it('marks needs_manual when OFF has no match (no image fetched)', async () => {
    const p = makePrisma([master()]);
    const processImage = vi.fn();
    const deps = baseDeps({ source: vi.fn(async () => null), processImage });

    const res = await runCatalogEnrichment(p.prisma as never, deps as never);

    expect(res).toMatchObject({ enriched: 0, needsManual: 1, errors: 0 });
    expect(processImage).not.toHaveBeenCalled();
    expect(p.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: expect.objectContaining({ enrichmentStatus: 'needs_manual', enrichmentAttemptedAt: NOW }) });
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('records error (retryable) when the image pipeline throws, without aborting the sweep', async () => {
    const p = makePrisma([master({ id: 'm1' }), master({ id: 'm2', barcode: '8901639000282' })]);
    const processImage = vi.fn()
      .mockRejectedValueOnce(new Error('fetch timed out'))   // m1 fails
      .mockResolvedValueOnce({ url: 'https://cdn.test/products/h2.webp', hash: 'h2', source: 'open_food_facts', license: 'CC-BY-SA', attribution: 'a' });
    const deps = baseDeps({ source: vi.fn(async (bc: string) => offHit({ barcode: bc })), processImage });

    const res = await runCatalogEnrichment(p.prisma as never, deps as never);

    expect(res).toMatchObject({ scanned: 2, enriched: 1, errors: 1 });
    expect(p.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: expect.objectContaining({ enrichmentStatus: 'error', enrichmentNote: 'fetch timed out' }) });
    expect(p.update).toHaveBeenCalledWith({ where: { id: 'm2' }, data: expect.objectContaining({ enrichmentStatus: 'enriched' }) });
  });

  it('selects only un-imaged, non-rejected, never-tried-or-errored rows (resumable)', async () => {
    const p = makePrisma([]);
    await runCatalogEnrichment(p.prisma as never, baseDeps({ source: vi.fn() }) as never);

    const where = p.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ imageUrl: null, status: { not: 'rejected' } });
    expect(where.OR).toEqual([{ enrichmentStatus: null }, { enrichmentStatus: 'error' }]);
  });

  it('re-attempts needs_manual rows when includeNeedsManual is set', async () => {
    const p = makePrisma([]);
    await runCatalogEnrichment(p.prisma as never, baseDeps({ source: vi.fn(), includeNeedsManual: true }) as never);

    expect(p.findMany.mock.calls[0]![0].where.OR).toEqual([
      { enrichmentStatus: null }, { enrichmentStatus: 'error' }, { enrichmentStatus: 'needs_manual' },
    ]);
  });
});
