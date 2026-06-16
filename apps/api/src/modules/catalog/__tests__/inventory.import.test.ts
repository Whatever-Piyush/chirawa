import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInventoryService, parseCsv } from '../inventory.service';

const adminAuth = { userId: 'admin_1', role: 'admin' };
const SHOP = 'shop_1';

describe('parseCsv', () => {
  it('parses a simple table', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });
  it('handles quoted fields with commas and escaped quotes', () => {
    expect(parseCsv('name,note\n"Atta, 5kg","says ""hi"""')).toEqual([
      ['name', 'note'], ['Atta, 5kg', 'says "hi"'],
    ]);
  });
  it('handles CRLF line endings and skips blank lines', () => {
    expect(parseCsv('a,b\r\n1,2\r\n\r\n3,4\r\n')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });
});

// Prisma double for the importer. `existingProduct` toggles create-vs-update.
function makePrisma(opts: { existingProduct?: boolean } = {}) {
  const productFindFirst = vi.fn().mockResolvedValue(opts.existingProduct ? { id: 'prod_existing' } : null);
  const productCreate = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'prod_new', ...data }));
  const productUpdate = vi.fn().mockResolvedValue({});
  const prisma = {
    shop: { findUnique: vi.fn().mockResolvedValue({ id: SHOP, seller: { userId: 'someone' } }) },
    category: {
      findFirst: vi.fn().mockResolvedValue(null),
      create:    vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'cat_' + data.name })),
    },
    product: { findFirst: productFindFirst, create: productCreate, update: productUpdate },
    productVariant: {
      findFirst: vi.fn().mockResolvedValue(null),
      create:    vi.fn().mockResolvedValue({ id: 'var_new' }),
      update:    vi.fn().mockResolvedValue({}),
    },
  };
  const redis = { del: vi.fn().mockResolvedValue(1) };
  return { prisma, redis, productCreate, productUpdate, categoryCreate: prisma.category.create, variantCreate: prisma.productVariant.create };
}

const svc = (p: ReturnType<typeof makePrisma>) => createInventoryService(p.prisma as never, p.redis as never);

const CSV =
  'name,category,unit,price_rupees,mrp_rupees,stock_qty,image_url,variant_name,variant_price_rupees\n' +
  'Aashirvaad Atta,Grocery,5 kg,285,320,40,,,\n' +
  'Amul Milk,Dairy,,62,65,100,,500 ml,32\n' +
  'Amul Milk,Dairy,,62,65,100,,1 L,62\n';

describe('importProductsCsv (Phase 1.4)', () => {
  let p: ReturnType<typeof makePrisma>;
  beforeEach(() => { p = makePrisma(); });

  it('imports products + variants, auto-creates categories, converts rupees→paise', async () => {
    const report = await svc(p).importProductsCsv(SHOP, CSV, adminAuth);

    // 1 product-only row (Atta) + 2 variant rows that both upsert the Amul product.
    expect(report.created).toBeGreaterThanOrEqual(1);
    expect(report.errors).toHaveLength(0);
    // rupees→paise: Atta price 285 → 28500
    expect(p.productCreate.mock.calls[0]![0].data).toMatchObject({ price: 28500, mrpPaise: 32000, stockQty: 40 });
    // Two variants created for Amul Milk (32→3200, 62→6200)
    expect(p.variantCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: '500 ml', price: 3200 }) }));
    expect(p.variantCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: '1 L', price: 6200 }) }));
    // Category auto-created
    expect(p.categoryCreate).toHaveBeenCalled();
    expect(p.redis.del).toHaveBeenCalled(); // cache invalidated
  });

  it('reports bad rows but still imports the good ones', async () => {
    const bad =
      'name,price_rupees\n' +
      'Good Item,50\n' +
      ',99\n' +              // missing name
      'Bad Price,abc\n';     // invalid price
    const report = await svc(p).importProductsCsv(SHOP, bad, adminAuth);

    expect(report.created).toBe(1);
    expect(report.skipped).toBe(2);
    expect(report.errors.map((e) => e.row)).toEqual([3, 4]); // header is row 1
  });

  it('is idempotent: an existing product is updated, not duplicated', async () => {
    const existing = makePrisma({ existingProduct: true });
    const report = await svc(existing).importProductsCsv(SHOP, 'name,price_rupees\nAtta,100\n', adminAuth);
    expect(report.updated).toBe(1);
    expect(report.created).toBe(0);
    expect(existing.productCreate).not.toHaveBeenCalled();
    expect(existing.productUpdate).toHaveBeenCalled();
  });

  it('rejects a CSV missing required columns', async () => {
    await expect(svc(p).importProductsCsv(SHOP, 'foo,bar\n1,2\n', adminAuth)).rejects.toThrow();
  });
});

// A `where`-aware product double so we can assert barcode-vs-name match order.
// `seed` are pre-existing products the importer may find by barcode or name.
function makeBarcodePrisma(seed: Array<{ id: string; name?: string; barcode?: string }> = []) {
  const findFirst = vi.fn().mockImplementation(({ where }: { where: { barcode?: string; name?: string } }) => {
    const hit = seed.find((row) =>
      where.barcode !== undefined ? row.barcode === where.barcode
        : where.name !== undefined ? row.name === where.name
          : false);
    return Promise.resolve(hit ? { id: hit.id } : null);
  });
  const create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'prod_new', ...data }));
  const update = vi.fn().mockResolvedValue({});
  const prisma = {
    shop: { findUnique: vi.fn().mockResolvedValue({ id: SHOP, seller: { userId: 'someone' } }) },
    category: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'cat_x' }) },
    product: { findFirst, create, update },
    productVariant: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'v' }), update: vi.fn() },
  };
  const redis = { del: vi.fn().mockResolvedValue(1) };
  return { prisma, redis, create, update, findFirst };
}

const svcB = (p: ReturnType<typeof makeBarcodePrisma>) =>
  createInventoryService(p.prisma as never, p.redis as never);

describe('importProductsCsv — barcode (Catalog Engine Phase 0)', () => {
  it('stores a valid GTIN on create and looks the product up by barcode first', async () => {
    const p = makeBarcodePrisma();
    const report = await svcB(p).importProductsCsv(SHOP, 'name,price_rupees,barcode\nMaggi,14,8901725000011\n', adminAuth);

    expect(report.created).toBe(1);
    expect(report.errors).toHaveLength(0);
    expect(p.create.mock.calls[0]![0].data).toMatchObject({ name: 'Maggi', barcode: '8901725000011' });
    expect(p.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { shopId: SHOP, barcode: '8901725000011' } }));
  });

  it('flags an invalid barcode, drops it, but still imports the row (by name)', async () => {
    const p = makeBarcodePrisma();
    const report = await svcB(p).importProductsCsv(SHOP, 'name,price_rupees,barcode\nLoose Atta,40,12345\n', adminAuth);

    expect(report.created).toBe(1);
    expect(report.errors.some((e) => /Invalid barcode/.test(e.reason))).toBe(true);
    expect(p.create.mock.calls[0]![0].data.barcode).toBeNull();           // bogus code never stored
    // never queried by the bogus barcode — only by name
    expect(p.findFirst).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ barcode: '12345' }) }));
  });

  it('is idempotent by barcode even when the CSV display name differs', async () => {
    const p = makeBarcodePrisma([{ id: 'prod_99', name: 'Old Name', barcode: '8901639000282' }]);
    const report = await svcB(p).importProductsCsv(SHOP, 'name,price_rupees,barcode\nNew Display Name,30,8901639000282\n', adminAuth);

    expect(report.updated).toBe(1);
    expect(report.created).toBe(0);
    expect(p.create).not.toHaveBeenCalled();
    expect(p.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'prod_99' } }));
  });

  it('backfills the barcode onto a product previously imported by name', async () => {
    const p = makeBarcodePrisma([{ id: 'prod_named', name: 'Tata Salt' }]); // no barcode yet
    const report = await svcB(p).importProductsCsv(SHOP, 'name,price_rupees,barcode\nTata Salt,28,8901639000282\n', adminAuth);

    expect(report.updated).toBe(1);
    // barcode lookup misses → name lookup hits → barcode written on update
    expect(p.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'prod_named' },
      data:  expect.objectContaining({ barcode: '8901639000282' }),
    }));
  });
});

describe('importProductsCsv — image re-hosting (Catalog Engine Phase 1)', () => {
  const CSV_WITH_IMG = 'name,price_rupees,image_url\nMaggi,14,https://images.example.com/maggi.png\n';

  it('routes image_url through the pipeline and stores the normalized url + provenance', async () => {
    const p = makeBarcodePrisma();
    const pipe = vi.fn(async () => ({ url: 'https://cdn.test/products/abc.webp', hash: 'abc', source: 'distributor', license: null, attribution: null }));
    const svc = createInventoryService(p.prisma as never, p.redis as never, { processImage: pipe as never });

    const report = await svc.importProductsCsv(SHOP, CSV_WITH_IMG, adminAuth);

    expect(report.created).toBe(1);
    expect(report.errors).toHaveLength(0);
    expect(pipe).toHaveBeenCalledWith({ url: 'https://images.example.com/maggi.png', source: 'distributor' });
    // The re-hosted (not the original) URL + provenance land on ProductImage.
    expect(p.create.mock.calls[0]![0].data.images).toEqual({
      create: { url: 'https://cdn.test/products/abc.webp', sortOrder: 0, source: 'distributor', license: null, attribution: null },
    });
  });

  it('is non-fatal when the pipeline fails: product imports without an image, row flagged', async () => {
    const p = makeBarcodePrisma();
    const pipe = vi.fn(async () => { throw new Error('fetch timed out'); });
    const svc = createInventoryService(p.prisma as never, p.redis as never, { processImage: pipe as never });

    const report = await svc.importProductsCsv(SHOP, CSV_WITH_IMG, adminAuth);

    expect(report.created).toBe(1);                                  // product still created
    expect(p.create.mock.calls[0]![0].data.images).toBeUndefined();  // no broken/hotlinked image
    expect(report.errors.some((e) => /Image skipped/.test(e.reason))).toBe(true);
  });
});
