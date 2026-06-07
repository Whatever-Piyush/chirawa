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
