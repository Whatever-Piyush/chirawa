import type { FastifyInstance } from 'fastify';
import { createSellersService } from './sellers.service';
import { authenticate, requireRole } from '../../shared/middleware/auth.middleware';
import { getMorningCard } from '../inventory/morning-card.service';
import { NotFoundError } from '../../shared/errors/app-errors';

export default async function sellersRoutes(app: FastifyInstance): Promise<void> {
  const sellersService = createSellersService(app.prisma);

  // All seller routes require a seller-role JWT.
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole('seller'));

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

  // GET /api/v1/sellers/me/morning-card — today's ≤N most-doubted tracked items
  // (Inventory Engine S5). Computed fresh on every read — answering an item via
  // PATCH /catalog/products/:id/verify drops it off the card immediately.
  app.get('/me/morning-card', async (request, reply) => {
    const seller = await app.prisma.sellerProfile.findUnique({
      where:   { userId: request.auth!.userId },
      include: { shop: { select: { id: true } } },
    });
    if (!seller?.shop) throw new NotFoundError('Shop');
    const items = await getMorningCard(app.prisma, seller.shop.id);
    return reply.send({ items });
  });
}
