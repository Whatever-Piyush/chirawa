import type { FastifyInstance } from 'fastify';
import { createSellersService } from './sellers.service';
import { authenticate, requireRole } from '../../shared/middleware/auth.middleware';

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
}
