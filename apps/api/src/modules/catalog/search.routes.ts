import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createCatalogService, parseSearchSort, parsePricePaise, type SearchOpts } from './catalog.service';
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
      request: FastifyRequest<{
        Querystring: {
          q?: string; limit?: string;
          category?: string; shopId?: string;
          minPrice?: string; maxPrice?: string;
          inStock?: string; sort?: string;
        };
      }>,
      reply,
    ) => {
      const { query } = request;
      const q = (query.q ?? '').trim();
      if (q.length < 2) {
        throw new ValidationError('Query must be at least 2 characters');
      }
      const opts: SearchOpts = { sort: parseSearchSort(query.sort) };
      if (query.category) opts.category = query.category;
      if (query.shopId)   opts.shopId   = query.shopId;
      const minPrice = parsePricePaise(query.minPrice);
      const maxPrice = parsePricePaise(query.maxPrice);
      if (minPrice !== undefined) opts.minPrice = minPrice;
      if (maxPrice !== undefined) opts.maxPrice = maxPrice;
      if (query.inStock === 'true') opts.inStock = true;

      const results = await catalogService.searchCatalog(q, opts);
      return reply.send(results);
    },
  );

  // GET /api/v1/search/suggest?q= — lightweight autocomplete for the dropdown.
  // Tiny payload (≤8 names + thumb + price), Redis-cached → answers in a few ms.
  app.get(
    '/search/suggest',
    {
      config: {
        rateLimit: {
          max:        env.NODE_ENV === 'development' ? 2000 : 90,
          timeWindow: '1 minute',
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { q?: string } }>, reply) => {
      const q = (request.query.q ?? '').trim();
      if (q.length < 2) return reply.send({ query: q, suggestions: [] });
      const results = await catalogService.suggestCatalog(q);
      return reply.send(results);
    },
  );
}
