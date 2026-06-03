import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../shared/middleware/auth.middleware';
import { ValidationError, NotFoundError } from '../../shared/errors/app-errors';
import { uploadImage, ALLOWED_IMAGE_MIME } from '../../services/r2.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
        throw new ValidationError('term (string) and aliases (array) required');
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
        throw new ValidationError('aliases (array) required');
      }

      const { term } = request.params as { term: string };
      const normalized = term.toLowerCase().trim();
      const existing   = await app.prisma.searchAlias.findUnique({ where: { term: normalized } });

      if (!existing) {
        throw new NotFoundError(`Alias entry for term "${normalized}"`);
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

  // ── Dispatch live-ops view (Chunk 5.6) ────────────────────────────────────
  /*
   * GET /api/v1/admin/dispatch
   * Real-time operational snapshot for the founders: active orders (last 24h)
   * with status + assigned rider (unassigned ones flagged), and online riders
   * with their current delivery load. JSON only — the full UI is Chunk 9.
   */
  app.get(
    '/dispatch',
    { preHandler: [authenticate, requireRole('admin')] },
    async (_req, reply) => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const ACTIVE = ['paid', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'out_for_delivery'];
      // An order needs a rider once it's confirmed but none is assigned yet.
      const NEEDS_RIDER = ['confirmed', 'preparing', 'ready_for_pickup'];

      const orders = await app.prisma.order.findMany({
        where:   { status: { in: ACTIVE as never }, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, status: true, totalAmount: true, deliveryLocality: true,
          paymentMethod: true, riderId: true, createdAt: true,
          shop: { select: { name: true } },
        },
      });

      // riderId is denormalized (no relation) — resolve names in one batch query.
      const riderIds = [...new Set(orders.map((o) => o.riderId).filter((id): id is string => !!id))];
      const riderProfiles = riderIds.length
        ? await app.prisma.riderProfile.findMany({ where: { id: { in: riderIds } }, select: { id: true, fullName: true } })
        : [];
      const riderName = new Map(riderProfiles.map((r) => [r.id, r.fullName]));

      const activeOrders = orders.map((o) => ({
        id:            o.id,
        shortId:       o.id.slice(-6).toUpperCase(),
        status:        o.status,
        shopName:      o.shop?.name ?? null,
        riderName:     o.riderId ? riderName.get(o.riderId) ?? null : null,
        totalAmount:   o.totalAmount,
        deliveryLocality: o.deliveryLocality,
        paymentMethod: o.paymentMethod,
        createdAt:     o.createdAt,
        unassigned:    !o.riderId && (NEEDS_RIDER as string[]).includes(o.status),
      }));

      // Online riders + active delivery load.
      const online = await app.prisma.riderAvailability.findMany({
        where:  { status: 'online' },
        select: { riderId: true, lastSeenAt: true, rider: { select: { fullName: true } } },
      });
      const riders = await Promise.all(
        online.map(async (a) => ({
          riderId:      a.riderId,
          name:         a.rider?.fullName ?? null,
          lastSeenAt:   a.lastSeenAt,
          activeOrders: await app.prisma.deliveryAssignment.count({ where: { riderId: a.riderId, isActive: true } }),
        })),
      );

      return reply.send({
        generatedAt:      new Date().toISOString(),
        activeOrderCount: activeOrders.length,
        unassignedCount:  activeOrders.filter((o) => o.unassigned).length,
        onlineRiderCount: riders.length,
        activeOrders,
        riders,
      });
    },
  );

  // ── Image management (shop onboarding) ─────────────────────────────────────

  /*
   * POST /api/v1/admin/upload-image?folder=products|shops
   * Multipart image upload → Cloudflare R2. Returns { url }.
   */
  app.post(
    '/upload-image',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const folderRaw = (request.query as { folder?: string }).folder;
      const folder: 'shops' | 'products' = folderRaw === 'shops' ? 'shops' : 'products';

      const data = await request.file();
      if (!data) throw new ValidationError('No image file provided');
      if (!ALLOWED_IMAGE_MIME.includes(data.mimetype)) {
        throw new ValidationError(`Unsupported image type: ${data.mimetype}. Use jpg, png or webp.`);
      }
      const buffer = await data.toBuffer();
      if (data.file.truncated) throw new ValidationError('Image too large (max 5MB)');

      const url = await uploadImage(folder, buffer, data.mimetype);
      return reply.status(201).send({ url });
    },
  );

  /*
   * PATCH /api/v1/admin/shops/:id/images  { logoUrl?, coverImageUrl? }
   */
  app.patch(
    '/shops/:id/images',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!UUID_RE.test(id)) throw new NotFoundError('Shop');

      const body = request.body as { logoUrl?: unknown; coverImageUrl?: unknown };
      const data: { logoUrl?: string; coverImageUrl?: string } = {};
      if (typeof body.logoUrl === 'string') data.logoUrl = body.logoUrl;
      if (typeof body.coverImageUrl === 'string') data.coverImageUrl = body.coverImageUrl;
      if (Object.keys(data).length === 0) {
        throw new ValidationError('Provide logoUrl and/or coverImageUrl');
      }

      const shop = await app.prisma.shop.findUnique({ where: { id }, select: { id: true } });
      if (!shop) throw new NotFoundError('Shop');

      const updated = await app.prisma.shop.update({
        where: { id },
        data,
        select: { id: true, logoUrl: true, coverImageUrl: true },
      });
      await app.redis.del(`catalog:shop:${id}:full`, 'catalog:shops:active').catch(() => {});
      return reply.send(updated);
    },
  );

  /*
   * PUT /api/v1/admin/products/:id/image  { url }
   * Sets the product's primary image (replaces existing images).
   */
  app.put(
    '/products/:id/image',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!UUID_RE.test(id)) throw new NotFoundError('Product');

      const body = request.body as { url?: unknown };
      if (typeof body.url !== 'string' || !/^https?:\/\//.test(body.url)) {
        throw new ValidationError('A valid image url is required');
      }

      const product = await app.prisma.product.findUnique({
        where: { id },
        select: { shopId: true },
      });
      if (!product) throw new NotFoundError('Product');

      await app.prisma.$transaction([
        app.prisma.productImage.deleteMany({ where: { productId: id } }),
        app.prisma.productImage.create({ data: { productId: id, url: body.url, sortOrder: 0 } }),
      ]);
      await app.redis.del(`catalog:shop:${product.shopId}:full`).catch(() => {});
      return reply.send({ productId: id, url: body.url });
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
