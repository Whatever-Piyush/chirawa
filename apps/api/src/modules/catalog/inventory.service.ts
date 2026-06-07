import type { PrismaClient, Prisma } from '@prisma/client';
import type Redis from 'ioredis';
import { NotFoundError, ForbiddenError, ValidationError } from '../../shared/errors/app-errors';
import { createCatalogService } from './catalog.service';
import type {
  CreateProductInput, UpdateProductInput,
  CreateCategoryInput, UpdateCategoryInput,
  CreateVariantInput, UpdateVariantInput,
} from './catalog.schema';

export interface AuthCtx { userId: string; role: string }

// 0 stock => out_of_stock, otherwise available. (Restocking re-enables an item;
// the explicit hide/show toggle lives in the separate /stock endpoint.)
const statusForQty = (qty: number): 'available' | 'out_of_stock' =>
  qty > 0 ? 'available' : 'out_of_stock';

/**
 * Inventory writes for the catalog module (Phase 1.1–1.3, 1.5).
 * Every mutation enforces seller-owns-shop (admin bypass), validates paise
 * integers (via the zod schemas at the route), and invalidates the shop's
 * catalog cache so changes are visible to customers within seconds.
 */
export function createInventoryService(prisma: PrismaClient, redis: Redis) {
  const catalog = createCatalogService(prisma, redis);
  const invalidate = (shopId: string) => catalog.invalidateShopCache(shopId);

  async function assertShopOwner(shopId: string, auth: AuthCtx): Promise<void> {
    if (auth.role === 'admin') return;
    const shop = await prisma.shop.findUnique({
      where: { id: shopId }, include: { seller: { select: { userId: true } } },
    });
    if (!shop) throw new NotFoundError('Shop');
    if (shop.seller.userId !== auth.userId) throw new ForbiddenError('Not your shop');
  }

  async function loadOwnedProduct(productId: string, auth: AuthCtx) {
    const product = await prisma.product.findUnique({
      where: { id: productId }, include: { shop: { include: { seller: { select: { userId: true } } } } },
    });
    if (!product) throw new NotFoundError('Product');
    if (auth.role !== 'admin' && product.shop.seller.userId !== auth.userId) {
      throw new ForbiddenError('Not your product');
    }
    return product;
  }

  // A category must belong to the same shop as the product it's assigned to.
  async function assertCategoryInShop(categoryId: string, shopId: string): Promise<void> {
    const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { shopId: true } });
    if (!cat || cat.shopId !== shopId) throw new ValidationError('Category does not belong to this shop');
  }

  // ── Products ────────────────────────────────────────────────────────────────

  async function createProduct(input: CreateProductInput, auth: AuthCtx) {
    await assertShopOwner(input.shopId, auth);
    if (input.categoryId) await assertCategoryInShop(input.categoryId, input.shopId);

    const qty = input.stockQty ?? 0;
    const product = await prisma.product.create({
      data: {
        shopId:      input.shopId,
        name:        input.name,
        price:       input.pricePaise,
        mrpPaise:    input.mrpPaise ?? null,
        unit:        input.unit ?? null,
        categoryId:  input.categoryId ?? null,
        description: input.description ?? null,
        stockQty:    qty,
        stockStatus: statusForQty(qty),
        ...(input.imageUrl ? { images: { create: { url: input.imageUrl, sortOrder: 0 } } } : {}),
      },
    });
    await invalidate(input.shopId);
    return product;
  }

  async function updateProduct(productId: string, input: UpdateProductInput, auth: AuthCtx) {
    const existing = await loadOwnedProduct(productId, auth);
    if (input.categoryId) await assertCategoryInShop(input.categoryId, existing.shopId);

    const data: Prisma.ProductUpdateInput = {};
    if (input.name        !== undefined) data.name        = input.name;
    if (input.pricePaise  !== undefined) data.price       = input.pricePaise;
    if (input.mrpPaise    !== undefined) data.mrpPaise    = input.mrpPaise;
    if (input.unit        !== undefined) data.unit        = input.unit;
    if (input.description !== undefined) data.description = input.description;
    if (input.categoryId  !== undefined) {
      data.category = input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true };
    }
    if (input.stockQty !== undefined) {
      data.stockQty    = input.stockQty;
      data.stockStatus = statusForQty(input.stockQty);
    }
    // MRP must stay >= effective price.
    const effPrice = input.pricePaise ?? existing.price;
    const effMrp   = input.mrpPaise !== undefined ? input.mrpPaise : existing.mrpPaise;
    if (effMrp != null && effMrp < effPrice) throw new ValidationError('MRP must be greater than or equal to price');

    const updated = await prisma.product.update({ where: { id: productId }, data });
    if (input.imageUrl) {
      await prisma.productImage.create({ data: { productId, url: input.imageUrl, sortOrder: 0 } });
    }
    await invalidate(existing.shopId);
    return updated;
  }

  // Soft delete — keep the row so historical orders still resolve the product.
  async function deleteProduct(productId: string, auth: AuthCtx) {
    const existing = await loadOwnedProduct(productId, auth);
    await prisma.product.update({ where: { id: productId }, data: { isActive: false } });
    await invalidate(existing.shopId);
    return { id: productId, isActive: false };
  }

  async function setStockQty(productId: string, stockQty: number, auth: AuthCtx) {
    const existing = await loadOwnedProduct(productId, auth);
    const updated = await prisma.product.update({
      where: { id: productId },
      data:  { stockQty, stockStatus: statusForQty(stockQty) },
    });
    await invalidate(existing.shopId);
    return { id: updated.id, stockQty: updated.stockQty, stockStatus: updated.stockStatus };
  }

  // ── Categories ──────────────────────────────────────────────────────────────

  async function createCategory(input: CreateCategoryInput, auth: AuthCtx) {
    await assertShopOwner(input.shopId, auth);
    const category = await prisma.category.create({
      data: { shopId: input.shopId, name: input.name, sortOrder: input.sortOrder ?? 0 },
    });
    await invalidate(input.shopId);
    return category;
  }

  async function updateCategory(categoryId: string, input: UpdateCategoryInput, auth: AuthCtx) {
    const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { shopId: true } });
    if (!cat) throw new NotFoundError('Category');
    await assertShopOwner(cat.shopId, auth);
    const data: Prisma.CategoryUpdateInput = {};
    if (input.name      !== undefined) data.name      = input.name;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.isActive  !== undefined) data.isActive  = input.isActive;
    const updated = await prisma.category.update({ where: { id: categoryId }, data });
    await invalidate(cat.shopId);
    return updated;
  }

  async function deleteCategory(categoryId: string, auth: AuthCtx) {
    const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { shopId: true } });
    if (!cat) throw new NotFoundError('Category');
    await assertShopOwner(cat.shopId, auth);
    // Soft delete; detach products so they don't point at a hidden category.
    await prisma.$transaction([
      prisma.product.updateMany({ where: { categoryId }, data: { categoryId: null } }),
      prisma.category.update({ where: { id: categoryId }, data: { isActive: false } }),
    ]);
    await invalidate(cat.shopId);
    return { id: categoryId, isActive: false };
  }

  // ── Variants ────────────────────────────────────────────────────────────────

  async function createVariant(productId: string, input: CreateVariantInput, auth: AuthCtx) {
    const product = await loadOwnedProduct(productId, auth);
    const variant = await prisma.productVariant.create({
      data: {
        productId,
        name:      input.name,
        price:     input.pricePaise,
        mrpPaise:  input.mrpPaise ?? null,
        stockQty:  input.stockQty ?? 0,
        sku:       input.sku ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    await invalidate(product.shopId);
    return variant;
  }

  async function updateVariant(variantId: string, input: UpdateVariantInput, auth: AuthCtx) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId }, select: { id: true, productId: true },
    });
    if (!variant) throw new NotFoundError('Variant');
    const product = await loadOwnedProduct(variant.productId, auth);
    const data: Prisma.ProductVariantUpdateInput = {};
    if (input.name       !== undefined) data.name      = input.name;
    if (input.pricePaise !== undefined) data.price     = input.pricePaise;
    if (input.mrpPaise   !== undefined) data.mrpPaise  = input.mrpPaise;
    if (input.stockQty   !== undefined) data.stockQty  = input.stockQty;
    if (input.sku        !== undefined) data.sku       = input.sku;
    if (input.sortOrder  !== undefined) data.sortOrder = input.sortOrder;
    if (input.isActive   !== undefined) data.isActive  = input.isActive;
    const updated = await prisma.productVariant.update({ where: { id: variantId }, data });
    await invalidate(product.shopId);
    return updated;
  }

  async function deleteVariant(variantId: string, auth: AuthCtx) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId }, select: { id: true, productId: true },
    });
    if (!variant) throw new NotFoundError('Variant');
    const product = await loadOwnedProduct(variant.productId, auth);
    await prisma.productVariant.update({ where: { id: variantId }, data: { isActive: false } });
    await invalidate(product.shopId);
    return { id: variantId, isActive: false };
  }

  return {
    createProduct, updateProduct, deleteProduct, setStockQty,
    createCategory, updateCategory, deleteCategory,
    createVariant, updateVariant, deleteVariant,
    // exported for reuse/testing
    statusForQty,
  };
}
