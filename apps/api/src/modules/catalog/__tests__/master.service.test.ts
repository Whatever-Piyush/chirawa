import { describe, it, expect, vi } from 'vitest';
import { createMasterService } from '../master.service';
import type { OffProduct } from '../../../services/off-source';

const VALID = '8901725000011';   // valid GS1 check digit
const INVALID = '12345';

const masterRow = (over: Record<string, unknown> = {}) => ({
  id: 'mc1', barcode: VALID, name: 'Atta', brand: 'Aashirvaad', unit: '5 kg',
  mrpPaise: 32000, imageUrl: 'https://cdn/atta.webp', status: 'approved',
  categoryName: null, imageSource: null, imageLicense: null, imageAttribution: null,
  enrichmentStatus: null, enrichmentAttemptedAt: null, enrichmentNote: null,
  createdAt: new Date(), updatedAt: new Date(), ...over,
});

const offHit = (over: Partial<OffProduct> = {}): OffProduct => ({
  barcode: VALID, name: 'Atta (OFF)', brand: 'Aashirvaad', categoryName: 'Flours',
  imageUrl: null, source: 'open_food_facts', license: 'CC-BY-SA',
  attribution: `https://world.openfoodfacts.org/product/${VALID}`, ...over,
});

function makePrisma(opts: { existing?: ReturnType<typeof masterRow> | null } = {}) {
  const findUnique = vi.fn().mockResolvedValue(opts.existing ?? null);
  const create = vi.fn().mockImplementation(({ data }) => Promise.resolve(masterRow({ id: 'mc_new', imageUrl: null, ...data })));
  return { prisma: { masterCatalog: { findUnique, create } }, findUnique, create };
}

describe('createMasterService.lookupByBarcode', () => {
  it('returns an existing master as prefill (no OFF call)', async () => {
    const p = makePrisma({ existing: masterRow() });
    const offLive = vi.fn();
    const res = await createMasterService(p.prisma as never, { offLive }).lookupByBarcode(VALID);

    expect(res).toMatchObject({ found: true, source: 'master', master: { barcode: VALID, name: 'Atta', mrpPaise: 32000 } });
    expect(offLive).not.toHaveBeenCalled();
    expect(p.create).not.toHaveBeenCalled();
  });

  it('bootstraps a needs_review master from OFF when the barcode is unknown', async () => {
    const p = makePrisma({ existing: null });
    const offLive = vi.fn(async () => offHit());
    const res = await createMasterService(p.prisma as never, { offLive }).lookupByBarcode(VALID);

    expect(offLive).toHaveBeenCalledWith(VALID);
    expect(p.create).toHaveBeenCalledWith({ data: expect.objectContaining({ barcode: VALID, name: 'Atta (OFF)', brand: 'Aashirvaad', categoryName: 'Flours', status: 'needs_review' }) });
    expect(res).toMatchObject({ found: true, source: 'off_live', master: { barcode: VALID, imageUrl: null } });
  });

  it('does NOT hit OFF for an invalid (non-GTIN) barcode', async () => {
    const p = makePrisma({ existing: null });
    const offLive = vi.fn();
    const res = await createMasterService(p.prisma as never, { offLive }).lookupByBarcode(INVALID);

    expect(res.found).toBe(false);
    expect(offLive).not.toHaveBeenCalled();
  });

  it('returns not-found when OFF has no match (and creates nothing)', async () => {
    const p = makePrisma({ existing: null });
    const res = await createMasterService(p.prisma as never, { offLive: vi.fn(async () => null) }).lookupByBarcode(VALID);
    expect(res).toEqual({ found: false, source: null, master: null });
    expect(p.create).not.toHaveBeenCalled();
  });

  it('returns not-found when no live source is wired (offline)', async () => {
    const p = makePrisma({ existing: null });
    const res = await createMasterService(p.prisma as never, {}).lookupByBarcode(VALID);
    expect(res.found).toBe(false);
  });

  it('recovers from a unique-barcode race by reading back the winner', async () => {
    const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(masterRow({ id: 'mc_raced' }));
    const create = vi.fn().mockRejectedValue(new Error('unique violation'));
    const prisma = { masterCatalog: { findUnique, create } };
    const res = await createMasterService(prisma as never, { offLive: vi.fn(async () => offHit()) }).lookupByBarcode(VALID);

    expect(res).toMatchObject({ found: true, source: 'master', master: { id: 'mc_raced' } });
  });
});
