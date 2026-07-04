import type { FastifyInstance } from 'fastify';
import { createSellersService } from './sellers.service';
import { authenticate, requireRole } from '../../shared/middleware/auth.middleware';

export default async function sellersRoutes(app: FastifyInstance): Promise<void> {
  const sellersService = createSellersService(app.prisma, app.redis);

  // All seller routes require a seller-role JWT.
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole('seller'));

  // GET /api/v1/sellers/me/shop — the seller's own shop (id + open state).
  // Authoritative shop identity so the app never has to infer it from an order.
  app.get('/me/shop', async (request, reply) => {
    const shop = await sellersService.getMyShop(request.auth!.userId);
    return reply.send(shop);
  });

  // PATCH /api/v1/sellers/me/shop/open — seller opens / closes their store.
  app.patch('/me/shop/open', async (request, reply) => {
    const { isOpen } = (request.body ?? {}) as { isOpen?: unknown };
    const shop = await sellersService.setShopOpen(request.auth!.userId, isOpen as boolean);
    return reply.send(shop);
  });

  // GET /api/v1/sellers/me/sales-summary
  app.get('/me/sales-summary', async (request, reply) => {
    const summary = await sellersService.getSalesSummary(request.auth!.userId);
    return reply.send(summary);
  });

  // GET /api/v1/sellers/me/settlements
  app.get('/me/settlements', async (request, reply) => {
    const data = await sellersService.getSettlements(request.auth!.userId);
    return reply.send(data);
  });
}
