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

export interface ImportReport {
  created: number; updated: number; skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

// Minimal quote-aware CSV parser (handles "quoted, fields", escaped "" quotes,
// and CRLF/CR/LF). Exported for unit testing. Good enough for the ≤MBs catalog
// uploads the multipart plugin already size-caps.
export function parseCsv(text: string): string[][] {
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // Drop blank lines.
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ''));
}

// Rupees (what sellers type) → integer paise (what we store). Returns null when
// the value is blank/invalid so the caller can decide (skip vs treat as absent).
function rupeesToPaise(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function parseIntOrNull(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw.trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

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

    // Numeric stock is opt-in: only set stockQty (and derive status from it) when
    // the seller provides one. Otherwise the product is status-only (untracked).
    const data: Prisma.ProductUncheckedCreateInput = {
      shopId:      input.shopId,
      name:        input.name,
      price:       input.pricePaise,
      mrpPaise:    input.mrpPaise ?? null,
      unit:        input.unit ?? null,
      categoryId:  input.categoryId ?? null,
      description: input.description ?? null,
    };
    if (input.stockQty != null) {
      data.stockQty    = input.stockQty;
      data.stockStatus = statusForQty(input.stockQty);
    }
    if (input.imageUrl) {
      data.images = { create: { url: input.imageUrl, sortOrder: 0 } };
    }
    const product = await prisma.product.create({ data });
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

  // ── Bulk CSV import (Phase 1.4) ───────────────────────────────────────────
  // Columns: name,category,unit,price_rupees,mrp_rupees,stock_qty,image_url,
  //          variant_name,variant_price_rupees
  // Rupees in → paise stored. Categories auto-created. Idempotent: upsert product
  // by (shopId,name) and variant by (productId,variant_name), so re-uploading the
  // same file updates rather than duplicates. Returns a per-row report.
  async function importProductsCsv(shopId: string, csvText: string, auth: AuthCtx): Promise<ImportReport> {
    await assertShopOwner(shopId, auth);

    const rows = parseCsv(csvText);
    if (rows.length < 2) throw new ValidationError('CSV has a header but no data rows');

    const header = rows[0]!.map((h) => h.trim().toLowerCase());
    const col = (name: string): number => header.indexOf(name);
    if (col('name') === -1 || col('price_rupees') === -1) {
      throw new ValidationError('CSV must include at least "name" and "price_rupees" columns');
    }

    const report: ImportReport = { created: 0, updated: 0, skipped: 0, errors: [] };
    const categoryCache = new Map<string, string>(); // lower(name) → id

    async function ensureCategory(nameRaw: string): Promise<string> {
      const key = nameRaw.toLowerCase();
      const cached = categoryCache.get(key);
      if (cached) return cached;
      const existing = await prisma.category.findFirst({ where: { shopId, name: nameRaw }, select: { id: true } });
      const id = existing?.id
        ?? (await prisma.category.create({ data: { shopId, name: nameRaw } })).id;
      categoryCache.set(key, id);
      return id;
    }

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]!;
      const rowNum = i + 1; // human-friendly (1-based, includes header row)
      const at = (c: string) => (col(c) >= 0 ? r[col(c)] : undefined);
      try {
        const name = at('name')?.trim();
        if (!name) { report.skipped++; report.errors.push({ row: rowNum, reason: 'Missing product name' }); continue; }

        const pricePaise = rupeesToPaise(at('price_rupees'));
        if (pricePaise == null) { report.skipped++; report.errors.push({ row: rowNum, reason: 'Invalid price_rupees' }); continue; }

        const mrpPaise = rupeesToPaise(at('mrp_rupees'));
        if (mrpPaise != null && mrpPaise < pricePaise) {
          report.skipped++; report.errors.push({ row: rowNum, reason: 'mrp_rupees is less than price_rupees' }); continue;
        }

        const unit         = at('unit')?.trim() || null;
        const imageUrl     = at('image_url')?.trim() || null;
        const stockQty     = parseIntOrNull(at('stock_qty'));
        const variantName  = at('variant_name')?.trim() || null;
        const variantPaise = rupeesToPaise(at('variant_price_rupees'));
        const catNameRaw   = at('category')?.trim() || null;
        const categoryId   = catNameRaw ? await ensureCategory(catNameRaw) : null;

        // Upsert product by (shopId, name).
        const existing = await prisma.product.findFirst({ where: { shopId, name }, select: { id: true } });
        let productId: string;
        if (existing) {
          const data: Prisma.ProductUpdateInput = { price: pricePaise, mrpPaise, unit };
          if (categoryId) data.category = { connect: { id: categoryId } };
          // Product-level stock only applies when this row isn't a variant row.
          if (!variantName && stockQty != null) { data.stockQty = stockQty; data.stockStatus = statusForQty(stockQty); }
          await prisma.product.update({ where: { id: existing.id }, data });
          productId = existing.id;
          report.updated++;
        } else {
          const data: Prisma.ProductUncheckedCreateInput = { shopId, name, price: pricePaise, mrpPaise, unit, categoryId };
          if (!variantName && stockQty != null) { data.stockQty = stockQty; data.stockStatus = statusForQty(stockQty); }
          if (imageUrl) data.images = { create: { url: imageUrl, sortOrder: 0 } };
          const prod = await prisma.product.create({ data });
          productId = prod.id;
          report.created++;
        }

        // Upsert variant by (productId, variant_name) when present.
        if (variantName) {
          if (variantPaise == null) { report.errors.push({ row: rowNum, reason: 'variant_name set but variant_price_rupees missing/invalid' }); continue; }
          const ev = await prisma.productVariant.findFirst({ where: { productId, name: variantName }, select: { id: true } });
          const vData = { price: variantPaise, stockQty: stockQty ?? 0 };
          if (ev) await prisma.productVariant.update({ where: { id: ev.id }, data: vData });
          else    await prisma.productVariant.create({ data: { productId, name: variantName, ...vData } });
        }
      } catch (err) {
        report.skipped++;
        report.errors.push({ row: rowNum, reason: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    await invalidate(shopId);
    return report;
  }

  return {
    createProduct, updateProduct, deleteProduct, setStockQty,
    createCategory, updateCategory, deleteCategory,
    createVariant, updateVariant, deleteVariant,
    importProductsCsv,
    // exported for reuse/testing
    statusForQty,
  };
}
