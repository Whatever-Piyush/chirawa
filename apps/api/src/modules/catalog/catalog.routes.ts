import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { createCatalogService } from './catalog.service';
import { createInventoryService, type AuthCtx } from './inventory.service';
import { createMasterService } from './master.service';
import { createAggregationService } from './aggregation.service';
import { createRequestsService } from './requests.service';
import {
  createProductSchema, updateProductSchema, setStockQtySchema, verifyShelfSchema, stockThisSchema,
  bulkStockSchema,
  createCategorySchema, updateCategorySchema,
  createVariantSchema, updateVariantSchema, createRequestSchema,
} from './catalog.schema';
import { authenticate, requireRole } from '../../shared/middleware/auth.middleware';
import { ValidationError, ForbiddenError, NotFoundError } from '../../shared/errors/app-errors';
import { applyInventoryEvent } from '../inventory/apply-event';
import { getInventoryConfig } from '../inventory/inventory.config';
import { processImage } from '../../services/image-pipeline';
import { createOffLiveSource } from '../../services/off-live';
import { ALLOWED_IMAGE_MIME } from '../../services/r2.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Parse a body with a zod schema, surfacing the first issue as a ValidationError.
function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) throw new ValidationError(result.error.errors[0]?.message ?? 'Invalid input');
  return result.data;
}

export default async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const catalogService   = createCatalogService(app.prisma, app.redis);
  // Master lookup with a live OFF fallback (the only place we hit the live API).
  const masterService    = createMasterService(app.prisma, { offLive: createOffLiveSource() });
  const aggregationService = createAggregationService(app.prisma, app.redis);
  const requestsService    = createRequestsService(app.prisma, app.redis);
  // notifyRestock injected so the bulk stock endpoint fires the SAME restock
  // re-gate as the single PATCH /products/:id/stock handler (Sprint 4 parity).
  const inventoryService = createInventoryService(app.prisma, app.redis, {
    notifyRestock: (masterId) => requestsService.notifyRestock(masterId),
  });

  // Seller + admin may write inventory; ownership is enforced in the service.
  const writeGuard = { preHandler: [authenticate, requireRole('seller', 'admin')] };
  // Any authenticated user (e.g. report-wrong-image).
  const authGuard  = { preHandler: [authenticate] };
  const authCtx = (request: FastifyRequest): AuthCtx => ({ userId: request.auth!.userId, role: request.auth!.role });

  // GET /api/v1/catalog/shops — public
  app.get('/shops', async (_req, reply) => {
    return reply.send(await catalogService.getShops());
  });

  // GET /api/v1/catalog/specials — public. Chirawa Special (featured) shops shown
  // WITH branding (marketplace mode), the opposite of the aggregated feed (Phase 6).
  app.get('/specials', async (_req, reply) => {
    return reply.send(await catalogService.getSpecials());
  });

  // GET /api/v1/catalog/shops/:id — public
  app.get('/shops/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    return reply.send(await catalogService.getShop(request.params.id));
  });

  // GET /api/v1/catalog/products?category=&limit= — public (flat product list)
  app.get('/products', async (request: FastifyRequest<{ Querystring: { category?: string; limit?: string } }>, reply) => {
    const { category, limit } = request.query;
    const parsed = limit ? parseInt(limit, 10) : undefined;
    const opts: { category?: string; limit?: number } = {};
    if (category) opts.category = category;
    if (parsed !== undefined && Number.isFinite(parsed)) opts.limit = parsed;
    return reply.send(await catalogService.getProducts(opts));
  });

  // GET /api/v1/catalog/feed — public. The aggregated "one store" feed: one tile
  // per master at the lowest in-stock price, shop hidden (Catalog Engine Phase 4).
  app.get('/feed', async (_req, reply) => {
    return reply.send(await aggregationService.getFeed());
  });

  // GET /api/v1/catalog/daily-essentials — public. Curated everyday top-selling
  // SKUs for Chirawa (TOP_SELLING_SKUS.md): a VIEW over the aggregated feed,
  // ordered by buy-frequency (milk, atta, bread, eggs…). Real in-stock SKUs at
  // the aggregated lowest price, shop hidden. Powers the Home "Daily Essentials" rail.
  app.get('/daily-essentials', async (_req, reply) => {
    return reply.send(await aggregationService.getDailyEssentials());
  });

  // GET /api/v1/catalog/credits — public CC-BY-SA image attributions (legal
  // compliance for Open Food Facts pack-shots, Phase 1/7). One entry per approved
  // master whose image came from a CC-BY-SA source.
  app.get('/credits', async (_req, reply) => {
    const masters = await app.prisma.masterCatalog.findMany({
      where:   { status: 'approved', imageLicense: 'CC-BY-SA', imageAttribution: { not: null } },
      orderBy: { name: 'asc' },
      take:    1000,
      select:  { name: true, imageAttribution: true, imageLicense: true },
    });
    return reply.send({ count: masters.length, license: 'CC-BY-SA', data: masters });
  });

  // POST /api/v1/catalog/requests — "request this item" demand capture (Phase 6).
  // Authenticated so restock-notify has a target; barcode (if valid) links a master.
  app.post('/requests', authGuard, async (request, reply) => {
    const body = parse(createRequestSchema, request.body);
    return reply.send(await requestsService.createRequest(request.auth!.userId, body));
  });

  // GET /api/v1/catalog/products/:id — public (full product detail for PDP)
  app.get('/products/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    return reply.send(await catalogService.getProductDetail(request.params.id));
  });

  // GET /api/v1/catalog/categories — public (distinct categories w/ counts)
  app.get('/categories', async (_req, reply) => {
    return reply.send(await catalogService.getCategories());
  });

  // GET /api/v1/catalog/bestsellers — public. Category "bestseller" cluster cards:
  // up to 4 sample in-stock product images per category, eggs excluded, NO counts
  // (image-1 design — see 1.md). Powers the Home Bestsellers 2×2 grid.
  app.get('/bestsellers', async (_req, reply) => {
    return reply.send(await catalogService.getBestsellers());
  });

  // GET /api/v1/catalog/category-images — public. { [categoryName]: url[] } map of
  // up to 3 sample product images per category for the home category tiles
  // (image-2 design — see 2.md). Names + image URLs only (no shop/price/PII).
  app.get('/category-images', async (_req, reply) => {
    return reply.send(await catalogService.getCategoryImages());
  });

  // GET /api/v1/catalog/search — public
  app.get('/search', async (request: FastifyRequest<{ Querystring: { q?: string; shopId?: string } }>, reply) => {
    return reply.send(await catalogService.searchProducts(request.query.q ?? '', request.query.shopId));
  });

  // PATCH /api/v1/catalog/products/:id/stock — seller only
  // Route generics instead of an annotated request param — see writeGuard note.
  app.patch<{
    Params: { id: string };
    Body:   { stockStatus: 'available' | 'out_of_stock' | 'hidden' };
  }>(
    '/products/:id/stock',
    { preHandler: [authenticate, requireRole('seller', 'admin')] },
    async (request, reply) => {
      const { stockStatus } = request.body as { stockStatus: 'available' | 'out_of_stock' | 'hidden' };
      if (!['available', 'out_of_stock', 'hidden'].includes(stockStatus)) {
        throw new ValidationError('Invalid stock status');
      }

      // Verify seller owns this product
      const product = await app.prisma.product.findUnique({
        where:   { id: request.params.id },
        include: { shop: { include: { seller: { select: { userId: true } } } } },
      });

      if (!product) throw new ValidationError('Product not found');
      if (request.auth!.role === 'seller' && product.shop.seller.userId !== request.auth!.userId) {
        throw new ForbiddenError('Not your product');
      }

      const oldStatus = product.stockStatus;
      let newStatus: 'available' | 'out_of_stock' | 'hidden';

      if (stockStatus === 'hidden') {
        // Merchandising visibility — not an inventory fact. Direct write + the
        // legacy toggle log (the belief layer never touches 'hidden').
        await app.prisma.product.update({ where: { id: request.params.id }, data: { stockStatus } });
        await app.prisma.stockUpdateLog.create({
          data: {
            productId:   product.id,
            updatedById: request.auth!.userId,
            fromStatus:  oldStatus,
            toStatus:    stockStatus,
          },
        });
        newStatus = 'hidden';
      } else {
        // Availability toggles are BELIEF events (Inventory Engine): the seller
        // just looked at the shelf. seller_toggle_out zeroes a tracked belief;
        // seller_toggle_in restores the bucket default. Both project stockStatus.
        const cfg = await getInventoryConfig(app.prisma);
        const actorType = request.auth!.role === 'admin' ? 'admin' as const : 'seller' as const;
        const result = await app.prisma.$transaction(async (tx) =>
          applyInventoryEvent(tx as never, {
            productId: product.id, shopId: product.shopId,
            eventType: stockStatus === 'available' ? 'seller_toggle_in' : 'seller_toggle_out',
            actorType, actorId: request.auth!.userId,
          }, cfg),
        );
        newStatus = result.stockStatusTo;
      }

      // Invalidate catalog cache
      await catalogService.invalidateShopCache(product.shopId);

      // Restock notify (Phase 6): when a master-linked product flips back to
      // available, FCM the customers who requested it. Non-blocking — the toggle
      // must never fail on a notification hiccup.
      if (oldStatus !== 'available' && newStatus === 'available' && product.masterId) {
        void requestsService.notifyRestock(product.masterId).catch(() => {});
      }

      return reply.send({ id: product.id, stockStatus: newStatus, message: 'Stock update ho gaya' });
    },
  );

  // PATCH /api/v1/catalog/products/bulk-stock — seller/admin. Bulk stock-status
  // update; behaviourally identical to N single /products/:id/stock calls, with
  // not-found / not-owned products skipped (returned in skippedIds), not failed.
  // Static path → Fastify matches it before the parametric /products/:id.
  app.patch('/products/bulk-stock', writeGuard, async (request, reply) => {
    const input = parse(bulkStockSchema, request.body);
    return reply.send(await inventoryService.bulkSetProductStock(input.productIds, input.stockStatus, authCtx(request)));
  });

  // ── Inventory CRUD (Phase 1.1–1.3, 1.5) — seller owns shop, admin any ───────

  // POST /api/v1/catalog/products
  app.post('/products', writeGuard, async (request, reply) => {
    const input = parse(createProductSchema, request.body);
    const product = await inventoryService.createProduct(input, authCtx(request));
    return reply.status(201).send(product);
  });

  // PATCH /api/v1/catalog/products/:id
  app.patch('/products/:id', writeGuard, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const input = parse(updateProductSchema, request.body);
    const product = await inventoryService.updateProduct(request.params.id, input, authCtx(request));
    return reply.send(product);
  });

  // DELETE /api/v1/catalog/products/:id (soft delete)
  app.delete('/products/:id', writeGuard, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    return reply.send(await inventoryService.deleteProduct(request.params.id, authCtx(request)));
  });

  // PATCH /api/v1/catalog/products/:id/stock-qty
  app.patch('/products/:id/stock-qty', writeGuard, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const { stockQty } = parse(setStockQtySchema, request.body);
    return reply.send(await inventoryService.setStockQty(request.params.id, stockQty, authCtx(request)));
  });

  // PATCH /api/v1/catalog/products/:id/verify — shelf verification (Inventory
  // Engine S5): the morning card / restock prompt answer. Three thumb-sized
  // states (have/low/out) + optional exact qty for head-list counts.
  app.patch('/products/:id/verify', writeGuard, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const { state, qty } = parse(verifyShelfSchema, request.body);
    const result = await inventoryService.verifyShelf(request.params.id, state, qty, authCtx(request));
    // Restock notify (Phase 6): a verify that brings a master-linked item back
    // to available triggers the "notify me" fan-out — same as the toggle route.
    if (result.restocked && result.masterId) {
      void requestsService.notifyRestock(result.masterId).catch(() => {});
    }
    return reply.send({ id: result.id, stockQty: result.stockQty, stockStatus: result.stockStatus, message: 'Verify ho gaya' });
  });

  // POST /api/v1/catalog/categories
  app.post('/categories', writeGuard, async (request, reply) => {
    const input = parse(createCategorySchema, request.body);
    const category = await inventoryService.createCategory(input, authCtx(request));
    return reply.status(201).send(category);
  });

  // PATCH /api/v1/catalog/categories/:id
  app.patch('/categories/:id', writeGuard, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const input = parse(updateCategorySchema, request.body);
    return reply.send(await inventoryService.updateCategory(request.params.id, input, authCtx(request)));
  });

  // DELETE /api/v1/catalog/categories/:id (soft delete)
  app.delete('/categories/:id', writeGuard, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    return reply.send(await inventoryService.deleteCategory(request.params.id, authCtx(request)));
  });

  // POST /api/v1/catalog/products/:id/variants
  app.post('/products/:id/variants', writeGuard, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const input = parse(createVariantSchema, request.body);
    const variant = await inventoryService.createVariant(request.params.id, input, authCtx(request));
    return reply.status(201).send(variant);
  });

  // PATCH /api/v1/catalog/variants/:id
  app.patch('/variants/:id', writeGuard, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const input = parse(updateVariantSchema, request.body);
    return reply.send(await inventoryService.updateVariant(request.params.id, input, authCtx(request)));
  });

  // DELETE /api/v1/catalog/variants/:id (soft delete)
  app.delete('/variants/:id', writeGuard, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    return reply.send(await inventoryService.deleteVariant(request.params.id, authCtx(request)));
  });

  // POST /api/v1/catalog/products/import?shopId=<uuid> — bulk CSV import (1.4)
  app.post('/products/import', writeGuard, async (request: FastifyRequest<{ Querystring: { shopId?: string } }>, reply) => {
    const shopId = request.query.shopId;
    if (!shopId) throw new ValidationError('shopId query param is required');

    const file = await request.file();
    if (!file) throw new ValidationError('No CSV file provided');
    const buffer = await file.toBuffer();
    if (file.file.truncated) throw new ValidationError('CSV too large (max 5MB)');

    const report = await inventoryService.importProductsCsv(shopId, buffer.toString('utf8'), authCtx(request));
    return reply.send(report);
  });

  // ── Seller scan → autocomplete → toggle (Catalog Engine Phase 3) ───────────

  // GET /api/v1/catalog/master/:barcode — scan lookup → prefill (name/image/MRP).
  // Unknown barcode falls back to one live OFF lookup that bootstraps a master.
  app.get('/master/:barcode', writeGuard,
    async (request: FastifyRequest<{ Params: { barcode: string } }>, reply) => {
      return reply.send(await masterService.lookupByBarcode(request.params.barcode));
    });

  // POST /api/v1/catalog/upload-image — seller-scoped product image upload.
  // Normalized through the Phase 1 pipeline (square WebP, EXIF-stripped, re-hosted).
  app.post('/upload-image', { preHandler: [authenticate, requireRole('seller', 'admin')] },
    async (request, reply) => {
      const data = await request.file();
      if (!data) throw new ValidationError('No image file provided');
      if (!ALLOWED_IMAGE_MIME.includes(data.mimetype)) {
        throw new ValidationError(`Unsupported image type: ${data.mimetype}. Use jpg, png or webp.`);
      }
      const buffer = await data.toBuffer();
      if (data.file.truncated) throw new ValidationError('Image too large (max 5MB)');

      const { url } = await processImage({ buffer, source: 'manual', license: 'owned' });
      return reply.status(201).send({ url });
    });

  // POST /api/v1/catalog/products/stock-this — "I stock this": one idempotent
  // upsert keyed by (shopId, barcode). Re-scanning updates rather than duplicates
  // (the offline-sync queue relies on this). 201 when created, 200 when updated.
  app.post('/products/stock-this', writeGuard, async (request, reply) => {
    const input = parse(stockThisSchema, request.body);
    const result = await inventoryService.upsertProductByBarcode(input, authCtx(request));
    return reply.status(result.created ? 201 : 200).send(result);
  });

  // POST /api/v1/catalog/products/:id/report-image — "report wrong image". Any
  // authenticated user; records the report and re-gates the linked master to
  // needs_review (pulls it from the public pool until an admin fixes it, Phase 7).
  app.post('/products/:id/report-image', authGuard,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) throw new NotFoundError('Product');
      const product = await app.prisma.product.findUnique({ where: { id }, select: { id: true, masterId: true } });
      if (!product) throw new NotFoundError('Product');

      const body = request.body as { reason?: unknown } | undefined;
      const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 255) : null;
      await app.prisma.imageReport.create({
        data: { productId: id, masterId: product.masterId, reportedById: request.auth!.userId, reason },
      });
      // Re-gate the master so the suspect image leaves the public pool.
      if (product.masterId) {
        await app.prisma.masterCatalog.update({ where: { id: product.masterId }, data: { status: 'needs_review' } });
      }
      return reply.status(201).send({ reported: true });
    });
}
