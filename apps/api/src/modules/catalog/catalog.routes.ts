import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { createCatalogService } from './catalog.service';
import { createInventoryService, type AuthCtx } from './inventory.service';
import {
  createProductSchema, updateProductSchema, setStockQtySchema,
  createCategorySchema, updateCategorySchema,
  createVariantSchema, updateVariantSchema,
} from './catalog.schema';
import { authenticate, requireRole } from '../../shared/middleware/auth.middleware';
import { ValidationError, ForbiddenError } from '../../shared/errors/app-errors';

// Parse a body with a zod schema, surfacing the first issue as a ValidationError.
function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) throw new ValidationError(result.error.errors[0]?.message ?? 'Invalid input');
  return result.data;
}

export default async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const catalogService   = createCatalogService(app.prisma, app.redis);
  const inventoryService = createInventoryService(app.prisma, app.redis);

  // Seller + admin may write inventory; ownership is enforced in the service.
  const writeGuard = { preHandler: [authenticate, requireRole('seller', 'admin')] };
  const authCtx = (request: FastifyRequest): AuthCtx => ({ userId: request.auth!.userId, role: request.auth!.role });

  // GET /api/v1/catalog/shops — public
  app.get('/shops', async (_req, reply) => {
    return reply.send(await catalogService.getShops());
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

  // GET /api/v1/catalog/products/:id — public (full product detail for PDP)
  app.get('/products/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    return reply.send(await catalogService.getProductDetail(request.params.id));
  });

  // GET /api/v1/catalog/categories — public (distinct categories w/ counts)
  app.get('/categories', async (_req, reply) => {
    return reply.send(await catalogService.getCategories());
  });

  // GET /api/v1/catalog/search — public
  app.get('/search', async (request: FastifyRequest<{ Querystring: { q?: string; shopId?: string } }>, reply) => {
    return reply.send(await catalogService.searchProducts(request.query.q ?? '', request.query.shopId));
  });

  // PATCH /api/v1/catalog/products/:id/stock — seller only
  app.patch(
    '/products/:id/stock',
    { preHandler: [authenticate, requireRole('seller', 'admin')] },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body:   { stockStatus: 'available' | 'out_of_stock' | 'hidden' };
      }>,
      reply,
    ) => {
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
      const updated   = await app.prisma.product.update({
        where: { id: request.params.id },
        data:  { stockStatus },
      });

      // Log stock change
      await app.prisma.stockUpdateLog.create({
        data: {
          productId:   product.id,
          updatedById: request.auth!.userId,
          fromStatus:  oldStatus,
          toStatus:    stockStatus,
        },
      });

      // Invalidate catalog cache
      await catalogService.invalidateShopCache(product.shopId);

      return reply.send({ id: updated.id, stockStatus: updated.stockStatus, message: 'Stock update ho gaya' });
    },
  );

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
}
