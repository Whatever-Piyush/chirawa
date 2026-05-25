import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createCatalogService } from './catalog.service';

export default async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const catalogService = createCatalogService(app.prisma, app.redis);

  // GET /api/v1/catalog/shops — public, no auth required
  app.get('/shops', async (_req, reply) => {
    const shops = await catalogService.getShops();
    return reply.send(shops);
  });

  // GET /api/v1/catalog/shops/:id
  app.get(
    '/shops/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const shop = await catalogService.getShop(request.params.id);
      return reply.send(shop);
    },
  );

  // GET /api/v1/catalog/search?q=aloo&shopId=optional
  app.get(
    '/search',
    async (
      request: FastifyRequest<{ Querystring: { q?: string; shopId?: string } }>,
      reply,
    ) => {
      const q      = request.query.q ?? '';
      const shopId = request.query.shopId;
      const results = await catalogService.searchProducts(q, shopId);
      return reply.send(results);
    },
  );
}
