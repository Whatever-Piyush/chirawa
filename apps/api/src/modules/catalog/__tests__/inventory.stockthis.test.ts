import { describe, it, expect, vi } from 'vitest';
import { createInventoryService } from '../inventory.service';

const VALID = '8901725000011';
const INVALID = '12345';
const SHOP = 'shop_1';
const adminAuth = { userId: 'admin_1', role: 'admin' };

function makePrisma(opts: { existing?: { id: string } | null; ownerUserId?: string } = {}) {
  const productCreate = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'prod_new', ...data }));
  const productUpdate = vi.fn().mockResolvedValue({});
  const productImageCreate = vi.fn().mockResolvedValue({});
  const productImageDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const stateUpsert = vi.fn().mockResolvedValue({});
  const prisma = {
    shop: { findUnique: vi.fn().mockResolvedValue({ id: SHOP, seller: { userId: opts.ownerUserId ?? 'someone' } }) },
    // Sprint 3: findFirst resolves the shop's (pre-existing) default category so a
    // scanned add with no category still lands in one, without creating a new row.
    category: {
      findUnique: vi.fn().mockResolvedValue({ shopId: SHOP }),
      findFirst:  vi.fn().mockResolvedValue({ id: 'cat_default', shopId: SHOP }),
      create:     vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'cat_default', ...data })),
    },
    product: {
      findFirst: vi.fn().mockResolvedValue(opts.existing ?? null),
      findUnique: vi.fn().mockResolvedValue({ stockStatus: 'available' }),
      create: productCreate, update: productUpdate,
    },
    productImage: { create: productImageCreate, deleteMany: productImageDeleteMany },
    // Inventory Engine (belief writes for stockQty + binary state rows)
    inventoryState: { findUnique: vi.fn().mockResolvedValue(null), upsert: stateUpsert },
    inventoryEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    appConfig: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  };
  // Support BOTH shapes: the array form (Promise.all) and the interactive
  // callback form (tx === prisma) used by the image replace + belief writes.
  prisma.$transaction.mockImplementation((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
  );
  const redis = { del: vi.fn().mockResolvedValue(1) };
  return { prisma, redis, productCreate, productUpdate, productImageCreate, productImageDeleteMany, stateUpsert };
}
const svc = (p: ReturnType<typeof makePrisma>) => createInventoryService(p.prisma as never, p.redis as never);

describe('upsertProductByBarcode (Phase 3 "I stock this")', () => {
  const base = { shopId: SHOP, barcode: VALID, name: 'Atta', pricePaise: 28500 };

  it('creates a product with barcode + masterId when none exists for (shop, barcode)', async () => {
    const p = makePrisma({ existing: null });
    const res = await svc(p).upsertProductByBarcode({ ...base, masterId: 'mc1', stockQty: 10 } as never, adminAuth);

    expect(res).toEqual({ id: 'prod_new', created: true });
    expect(p.productCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      shopId: SHOP, barcode: VALID, masterId: 'mc1', name: 'Atta', price: 28500,
    }) });
    // Inventory Engine: the scanned count is a seller_count belief event, not
    // direct columns on create.
    expect(p.stateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ productId: 'prod_new', expectedQty: 10 }),
    }));
    expect(p.prisma.inventoryEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ eventType: 'seller_count', qtyAfter: 10 })],
    }));
    expect(p.redis.del).toHaveBeenCalled(); // cache invalidated
  });

  it('updates the existing product on a re-scan (idempotent, no duplicate)', async () => {
    const p = makePrisma({ existing: { id: 'prod_x' } });
    const res = await svc(p).upsertProductByBarcode({ ...base, pricePaise: 30000 } as never, adminAuth);

    expect(res).toEqual({ id: 'prod_x', created: false });
    expect(p.productUpdate).toHaveBeenCalledWith({ where: { id: 'prod_x' }, data: expect.objectContaining({ price: 30000 }) });
    expect(p.productCreate).not.toHaveBeenCalled();
    // No stockQty in the re-scan → binary state row ensured, no belief event.
    expect(p.stateUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: { productId: 'prod_x' } }));
    expect(p.prisma.inventoryEvent.createMany).not.toHaveBeenCalled();
  });

  it('re-scan with a new photo REPLACES the primary image (deletes sortOrder-0, then creates) — identical to updateProduct, no duplicate', async () => {
    const p = makePrisma({ existing: { id: 'prod_x' } });
    await svc(p).upsertProductByBarcode({ ...base, imageUrl: 'https://cdn.test/new.webp' } as never, adminAuth);
    expect(p.productImageDeleteMany).toHaveBeenCalledWith({ where: { productId: 'prod_x', sortOrder: 0 } });
    expect(p.productImageCreate).toHaveBeenCalledWith({ data: { productId: 'prod_x', url: 'https://cdn.test/new.webp', sortOrder: 0 } });
    expect(p.productImageCreate).toHaveBeenCalledTimes(1);
    // delete must precede create — the ordering that guarantees a single primary row.
    const delOrder = p.productImageDeleteMany.mock.invocationCallOrder[0]!;
    const crtOrder = p.productImageCreate.mock.invocationCallOrder[0]!;
    expect(delOrder).toBeLessThan(crtOrder);
  });

  it('re-scan WITHOUT a photo leaves the existing primary image untouched', async () => {
    const p = makePrisma({ existing: { id: 'prod_x' } });
    await svc(p).upsertProductByBarcode({ ...base } as never, adminAuth);
    expect(p.productImageDeleteMany).not.toHaveBeenCalled();
    expect(p.productImageCreate).not.toHaveBeenCalled();
  });

  it('rejects an invalid (non-GS1) barcode — never stored as a join key', async () => {
    await expect(svc(makePrisma()).upsertProductByBarcode({ ...base, barcode: INVALID } as never, adminAuth))
      .rejects.toThrow(/barcode/i);
  });

  it('enforces shop ownership for a seller who does not own the shop', async () => {
    const p = makePrisma({ ownerUserId: 'another_seller' });
    await expect(svc(p).upsertProductByBarcode(base as never, { userId: 'seller_me', role: 'seller' }))
      .rejects.toThrow();
    expect(p.productCreate).not.toHaveBeenCalled();
  });
});
