import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createCatalogService } from './catalog.service';
import { ValidationError } from '../../shared/errors/app-errors';
import { env } from '../../config/env';

/**
 * Mounted at /api/v1 → exposes GET /api/v1/search
 * Separate 30 req/min rate limit so it doesn't eat the global quota.
 */
export default async function searchRoutes(app: FastifyInstance): Promise<void> {
  const catalogService = createCatalogService(app.prisma, app.redis);

  app.get(
    '/search',
    {
      config: {
        rateLimit: {
          max:        env.NODE_ENV === 'development' ? 1000 : 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: { q?: string; limit?: string } }>,
      reply,
    ) => {
      const q = (request.query.q ?? '').trim();
      if (q.length < 2) {
        throw new ValidationError('Query must be at least 2 characters');
      }
      const results = await catalogService.searchCatalog(q);
      return reply.send(results);
    },
  );
}
