import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../shared/middleware/auth.middleware';

const ALIAS_CACHE_TTL = 3600;
const aliasExpandKey = (q: string) => `search:aliases:expanded:${q.toLowerCase().trim()}`;

export default async function routes(app: FastifyInstance): Promise<void> {

  app.get('/', async (_req, reply) => {
    return reply.send({ status: 'admin api v1' });
  });

  // ── Search Alias Management ────────────────────────────────────────────────

  /*
   * POST /api/v1/admin/search-aliases
   * Create or upsert a search alias entry.
   * If the term already exists, the provided aliases are merged into the existing set.
   */
  app.post(
    '/search-aliases',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const body = request.body as { term?: unknown; aliases?: unknown };
      if (typeof body.term !== 'string' || !Array.isArray(body.aliases)) {
        return reply.status(400).send({ error: 'term (string) and aliases (array) required' });
      }

      const normalized    = body.term.toLowerCase().trim();
      const newAliases    = (body.aliases as string[]).map((a) => a.toLowerCase().trim()).filter(Boolean);

      const existing = await app.prisma.searchAlias.findUnique({ where: { term: normalized } });

      const mergedAliases = existing
        ? Array.from(new Set([...existing.aliases, ...newAliases]))
        : newAliases;

      const result = await app.prisma.searchAlias.upsert({
        where:  { term: normalized },
        update: { aliases: mergedAliases },
        create: { term: normalized, aliases: mergedAliases },
      });

      // Invalidate cache for the canonical term and every alias
      await invalidateAliasCaches([normalized, ...mergedAliases]);

      return reply.status(201).send(result);
    },
  );

  /*
   * PATCH /api/v1/admin/search-aliases/:term/add
   * Append new aliases to an existing entry without overwriting.
   */
  app.patch(
    '/search-aliases/:term/add',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const body = request.body as { aliases?: unknown };
      if (!Array.isArray(body.aliases)) {
        return reply.status(400).send({ error: 'aliases (array) required' });
      }

      const { term } = request.params as { term: string };
      const normalized = term.toLowerCase().trim();
      const existing   = await app.prisma.searchAlias.findUnique({ where: { term: normalized } });

      if (!existing) {
        return reply.status(404).send({ error: `No alias entry found for term "${normalized}"` });
      }

      const newAliases    = (body.aliases as string[]).map((a) => a.toLowerCase().trim()).filter(Boolean);
      const mergedAliases = Array.from(new Set([...existing.aliases, ...newAliases]));

      const result = await app.prisma.searchAlias.update({
        where: { term: normalized },
        data:  { aliases: mergedAliases },
      });

      // Invalidate cache for the term and all aliases (old + new)
      await invalidateAliasCaches([normalized, ...mergedAliases]);

      return reply.send(result);
    },
  );

  /*
   * GET /api/v1/admin/search-aliases
   * List all alias entries, sorted alphabetically by term.
   */
  app.get(
    '/search-aliases',
    { preHandler: [authenticate, requireRole('admin')] },
    async (_req, reply) => {
      const aliases = await app.prisma.searchAlias.findMany({
        orderBy: { term: 'asc' },
        select:  { id: true, term: true, aliases: true, language: true, createdAt: true },
      });
      return reply.send({ count: aliases.length, data: aliases });
    },
  );

  // Invalidate Redis alias-expansion cache for a list of terms
  async function invalidateAliasCaches(terms: string[]): Promise<void> {
    const cacheKeys = [...new Set(terms)].map(aliasExpandKey);
    if (cacheKeys.length > 0) {
      await app.redis.del(...cacheKeys).catch(() => {});
    }
  }
}
