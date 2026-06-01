import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createCatalogService } from './catalog.service';
import { authenticate, requireRole } from '../../shared/middleware/auth.middleware';
import { ValidationError, ForbiddenError } from '../../shared/errors/app-errors';

export default async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const catalogService = createCatalogService(app.prisma, app.redis);

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
}
