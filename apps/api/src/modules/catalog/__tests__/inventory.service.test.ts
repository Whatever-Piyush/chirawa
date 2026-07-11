import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInventoryService } from '../inventory.service';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors/app-errors';

const SELLER = 'seller_user_1';
const SHOP   = 'shop_1';

// Prisma double. `owner` controls who the shop/product belongs to.
function makePrisma(owner: string = SELLER) {
  const sellerSel = { seller: { userId: owner } };
  const product = {
    findUnique: vi.fn().mockResolvedValue({ id: 'prod_1', shopId: SHOP, price: 5000, mrpPaise: 6000, shop: sellerSel }),
    create:     vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'prod_new', ...data })),
    update:     vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'prod_1', ...data })),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const prisma = {
    shop:     { findUnique: vi.fn().mockResolvedValue({ id: SHOP, seller: { userId: owner } }) },
    product,
    productImage:   { create: vi.fn().mockResolvedValue({}) },
    category:       {
      findUnique: vi.fn().mockResolvedValue({ id: 'cat_1', shopId: SHOP }),
      create:     vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'cat_new', ...data })),
      update:     vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'cat_1', ...data })),
    },
    productVariant: {
      findUnique: vi.fn().mockResolvedValue({ id: 'var_1', productId: 'prod_1' }),
      create:     vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'var_new', ...data })),
      update:     vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'var_1', ...data })),
    },
    // Inventory Engine: numeric stock writes flow through applyInventoryEvent.
    inventoryState: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert:     vi.fn().mockResolvedValue({}),
    },
    inventoryEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    appConfig:      { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  };
  // Supports both the array form (Promise.all) and the interactive form
  // (recordSellerCount passes a function; the fake prisma doubles as its tx).
  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
      : Promise.all(arg as Promise<unknown>[]));
  const redis = { del: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null) };
  return { prisma, redis };
}

const sellerAuth = { userId: SELLER, role: 'seller' };
const adminAuth  = { userId: 'admin_1', role: 'admin' };
const svc = (p: ReturnType<typeof makePrisma>) =>
  createInventoryService(p.prisma as never, p.redis as never);

describe('inventory.service — products (1.1 / 1.5)', () => {
  let p: ReturnType<typeof makePrisma>;
  beforeEach(() => { p = makePrisma(); });

  it('creates a product owned by the seller, mapping pricePaise→price, tracking stock via a seller_count event', async () => {
    const out = await svc(p).createProduct(
      { shopId: SHOP, name: 'Atta', pricePaise: 28500, mrpPaise: 32000, stockQty: 40 }, sellerAuth,
    );
    expect(p.prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ price: 28500, shopId: SHOP }) }),
    );
    // Inventory Engine: the count is a belief event — state upsert + event row +
    // legacy stockQty mirror on the product, never direct stockQty in create.
    expect(p.prisma.inventoryState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ productId: 'prod_new', expectedQty: 40 }),
    }));
    expect(p.prisma.inventoryEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ eventType: 'seller_count', qtyAfter: 40, actorType: 'seller' })],
    }));
    expect(p.prisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'prod_new' }, data: expect.objectContaining({ stockQty: 40 }),
    }));
    expect(p.redis.del).toHaveBeenCalled(); // cache invalidated
    expect(out.id).toBe('prod_new');
  });

  it('leaves stock untracked when stockQty omitted — binary state row only', async () => {
    await svc(p).createProduct({ shopId: SHOP, name: 'Atta', pricePaise: 100 }, sellerAuth);
    const data = p.prisma.product.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty('stockQty');
    expect(data).not.toHaveProperty('stockStatus');
    // The reservation CAS needs a state row even for binary items.
    expect(p.prisma.inventoryState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { productId: 'prod_new' },
    }));
    expect(p.prisma.inventoryEvent.createMany).not.toHaveBeenCalled();
  });

  it('tracks stock and projects out_of_stock when stockQty is explicitly 0', async () => {
    await svc(p).createProduct({ shopId: SHOP, name: 'Atta', pricePaise: 100, stockQty: 0 }, sellerAuth);
    expect(p.prisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'prod_new' },
      data:  expect.objectContaining({ stockQty: 0, stockStatus: 'out_of_stock' }),
    }));
  });

  it('rejects a seller who does not own the shop', async () => {
    const other = makePrisma('someone_else');
    await expect(svc(other).createProduct({ shopId: SHOP, name: 'X', pricePaise: 100 }, sellerAuth))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(other.prisma.product.create).not.toHaveBeenCalled();
  });

  it('lets an admin create a product for any shop', async () => {
    const other = makePrisma('someone_else');
    await svc(other).createProduct({ shopId: SHOP, name: 'X', pricePaise: 100 }, adminAuth);
    expect(other.prisma.product.create).toHaveBeenCalled();
    expect(other.prisma.shop.findUnique).not.toHaveBeenCalled(); // admin bypass
  });

  it('soft-deletes a product (isActive=false), never a hard delete', async () => {
    const out = await svc(p).deleteProduct('prod_1', sellerAuth);
    expect(p.prisma.product.update).toHaveBeenCalledWith({ where: { id: 'prod_1' }, data: { isActive: false } });
    expect(out).toEqual({ id: 'prod_1', isActive: false });
  });

  it('setStockQty projects status through the belief layer: 0→out_of_stock, >0→available', async () => {
    const zero = await svc(p).setStockQty('prod_1', 0, sellerAuth);
    expect(zero).toEqual({ id: 'prod_1', stockQty: 0, stockStatus: 'out_of_stock' });
    expect(p.prisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'prod_1' }, data: expect.objectContaining({ stockQty: 0, stockStatus: 'out_of_stock' }),
    }));
    const seven = await svc(p).setStockQty('prod_1', 7, sellerAuth);
    expect(seven).toEqual({ id: 'prod_1', stockQty: 7, stockStatus: 'available' });
    expect(p.prisma.inventoryEvent.createMany).toHaveBeenCalledTimes(2);
  });

  it('verifyShelf: "out" writes a trusted zero via seller_toggle_out', async () => {
    const out = await svc(p).verifyShelf('prod_1', 'out', undefined, sellerAuth);
    expect(p.prisma.inventoryEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ eventType: 'seller_toggle_out' })],
    }));
    expect(out.stockStatus).toBe('out_of_stock');
  });

  it('verifyShelf: "low" writes the bucket default, never asks for a count', async () => {
    await svc(p).verifyShelf('prod_1', 'low', undefined, sellerAuth);
    expect(p.prisma.inventoryEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ eventType: 'seller_bucket', qtyAfter: 8 })],
    }));
  });

  it('verifyShelf: an exact qty upgrades the answer to a seller_count', async () => {
    const out = await svc(p).verifyShelf('prod_1', 'have', 17, sellerAuth);
    expect(p.prisma.inventoryEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ eventType: 'seller_count', qtyAfter: 17 })],
    }));
    expect(out.stockQty).toBe(17);
  });

  it('rejects an update that would push price above MRP', async () => {
    // existing price 5000, mrp 6000; bumping price to 7000 violates MRP>=price
    await expect(svc(p).updateProduct('prod_1', { pricePaise: 7000 }, sellerAuth))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('404s when updating a missing product', async () => {
    p.prisma.product.findUnique.mockResolvedValueOnce(null);
    await expect(svc(p).updateProduct('nope', { name: 'x' }, sellerAuth)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('inventory.service — categories & variants (1.2 / 1.3)', () => {
  let p: ReturnType<typeof makePrisma>;
  beforeEach(() => { p = makePrisma(); });

  it('creates a category for an owned shop and invalidates cache', async () => {
    await svc(p).createCategory({ shopId: SHOP, name: 'Dairy', sortOrder: 2 }, sellerAuth);
    expect(p.prisma.category.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { shopId: SHOP, name: 'Dairy', sortOrder: 2 } }),
    );
    expect(p.redis.del).toHaveBeenCalled();
  });

  it('soft-deletes a category and detaches its products', async () => {
    await svc(p).deleteCategory('cat_1', sellerAuth);
    expect(p.prisma.product.updateMany).toHaveBeenCalledWith({ where: { categoryId: 'cat_1' }, data: { categoryId: null } });
    expect(p.prisma.category.update).toHaveBeenCalledWith({ where: { id: 'cat_1' }, data: { isActive: false } });
  });

  it('creates a variant under an owned product (pricePaise→price)', async () => {
    await svc(p).createVariant('prod_1', { name: '1 L', pricePaise: 6200, stockQty: 10 }, sellerAuth);
    expect(p.prisma.productVariant.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ productId: 'prod_1', price: 6200, stockQty: 10 }) }),
    );
  });

  it('rejects a variant create on a product the seller does not own', async () => {
    const other = makePrisma('someone_else');
    await expect(svc(other).createVariant('prod_1', { name: 'x', pricePaise: 1 }, sellerAuth))
      .rejects.toBeInstanceOf(ForbiddenError);
  });
});
