import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../shared/middleware/auth.middleware';
import { ValidationError, NotFoundError } from '../../shared/errors/app-errors';
import { uploadImage, ALLOWED_IMAGE_MIME } from '../../services/r2.service';
import { processImage } from '../../services/image-pipeline';
import { createRequestsService } from '../catalog/requests.service';
import { createModerationService } from '../catalog/moderation.service';
import { getInventoryHealth } from '../inventory/health.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALIAS_CACHE_TTL = 3600;
const aliasExpandKey = (q: string) => `search:aliases:expanded:${q.toLowerCase().trim()}`;

export default async function routes(app: FastifyInstance): Promise<void> {
  const moderation = createModerationService(app.prisma, app.redis);
  const adminGuard = { preHandler: [authenticate, requireRole('admin')] };

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

  // ── Demand dashboard (Catalog Engine Phase 6) ──────────────────────────────
  /*
   * GET /api/v1/admin/product-requests
   * Ranked "request this item" demand — grouped by master / barcode / free text,
   * most-requested first. Drives the sourcing roadmap.
   */
  app.get(
    '/product-requests',
    { preHandler: [authenticate, requireRole('admin')] },
    async (_req, reply) => {
      const requestsService = createRequestsService(app.prisma, app.redis);
      const data = await requestsService.getDemand();
      return reply.send({ count: data.length, data });
    },
  );

  // ── Moderation, coverage & observability (Catalog Engine Phase 7) ──────────

  // GET /api/v1/admin/moderation/masters — the needs_review review queue.
  app.get('/moderation/masters', adminGuard, async (_req, reply) => {
    return reply.send({ data: await moderation.listReviewQueue() });
  });

  // PATCH /api/v1/admin/masters/:id/status  { status: 'approved' | 'rejected' }
  app.patch('/masters/:id/status', adminGuard, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) throw new NotFoundError('Master');
    const status = (request.body as { status?: unknown })?.status;
    if (status !== 'approved' && status !== 'rejected') throw new ValidationError('status must be approved or rejected');
    return reply.send(await moderation.setMasterStatus(id, status));
  });

  // GET /api/v1/admin/moderation/image-reports — open wrong-image reports.
  app.get('/moderation/image-reports', adminGuard, async (_req, reply) => {
    return reply.send({ data: await moderation.listImageReports() });
  });

  // POST /api/v1/admin/image-reports/:id/resolve  { reApprove?: boolean }
  app.post('/image-reports/:id/resolve', adminGuard, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) throw new NotFoundError('Image report');
    const reApprove = (request.body as { reApprove?: unknown })?.reApprove === true;
    return reply.send(await moderation.resolveImageReport(id, { reApprove }));
  });

  // POST /api/v1/admin/masters/:id/takedown  { replaceImageUrl?: string }
  // One-click legal takedown — replace (swap+approve) or remove (clear+re-gate).
  app.post('/masters/:id/takedown', adminGuard, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) throw new NotFoundError('Master');
    const raw = (request.body as { replaceImageUrl?: unknown })?.replaceImageUrl;
    const replaceImageUrl = typeof raw === 'string' && raw.length > 0 ? raw : undefined;
    return reply.send(await moderation.takedownImage(id, replaceImageUrl ? { replaceImageUrl } : {}));
  });

  // GET /api/v1/admin/moderation/price-outliers — price > own/master MRP.
  app.get('/moderation/price-outliers', adminGuard, async (_req, reply) => {
    return reply.send({ data: await moderation.listPriceOutliers() });
  });

  // GET /api/v1/admin/coverage — image/barcode coverage + enrichment breakdown.
  app.get('/coverage', adminGuard, async (_req, reply) => {
    return reply.send(await moderation.getCoverage());
  });

  // GET /api/v1/admin/metrics — DB-derived rates + threshold alert flags.
  app.get('/metrics', adminGuard, async (_req, reply) => {
    return reply.send(await moderation.getMetrics());
  });

  // GET /api/v1/admin/inventory/health — Inventory Engine weekly-review numbers:
  // rider-miss rate, auto-accept canary, belief bands, reservation counts, and
  // the live reserved-counter invariant (should be 0 outside reconciler runs).
  app.get('/inventory/health', adminGuard, async (_req, reply) => {
    return reply.send(await getInventoryHealth(app.prisma));
  });

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

      // Product images are normalized through the Phase 1 pipeline (square
      // ~1200px WebP, EXIF/payloads stripped, content-hash re-host). Shop
      // logos/covers keep their aspect ratio on the raw upload path.
      const url = folder === 'products'
        ? (await processImage({ buffer, source: 'manual', license: 'owned' })).url
        : await uploadImage(folder, buffer, data.mimetype);
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

  /*
   * PUT /api/v1/admin/products/:id/images  { urls: string[] }
   * Replaces ALL images for a product with the given ordered list (first = primary).
   * Powers the multi-image carousel on the product card + detail page.
   */
  app.put(
    '/products/:id/images',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!UUID_RE.test(id)) throw new NotFoundError('Product');

      const body = request.body as { urls?: unknown };
      if (!Array.isArray(body.urls) || body.urls.length === 0) {
        throw new ValidationError('urls (non-empty array) is required');
      }
      const urls = body.urls.filter(
        (u): u is string => typeof u === 'string' && /^https?:\/\//.test(u),
      );
      if (urls.length === 0) throw new ValidationError('No valid image urls provided');

      const product = await app.prisma.product.findUnique({
        where: { id }, select: { shopId: true },
      });
      if (!product) throw new NotFoundError('Product');

      await app.prisma.$transaction([
        app.prisma.productImage.deleteMany({ where: { productId: id } }),
        app.prisma.productImage.createMany({
          data: urls.map((url, i) => ({ productId: id, url, sortOrder: i })),
        }),
      ]);
      await app.redis.del(`catalog:shop:${product.shopId}:full`).catch(() => {});
      return reply.send({ productId: id, images: urls });
    },
  );

  /*
   * POST /api/v1/admin/products/import   { products: ProductImportRow[] }
   * Bulk create/update products. Idempotent on (shopId, name): re-running updates
   * the existing product rather than duplicating. Per row you can pass price, mrp,
   * unit, description, categoryName, attributes, imageUrls and variants — so a
   * whole catalog can be poured in from a spreadsheet export.
   */
  app.post(
    '/products/import',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const body = request.body as { products?: unknown };
      if (!Array.isArray(body.products) || body.products.length === 0) {
        throw new ValidationError('products (non-empty array) is required');
      }
      if (body.products.length > 500) {
        throw new ValidationError('Max 500 products per import batch');
      }

      type Row = {
        shopId?: string; name?: string; pricePaise?: number; mrpPaise?: number;
        unit?: string; description?: string; categoryName?: string;
        attributes?: { label: string; value: string }[];
        imageUrls?: string[];
        variants?: { name: string; pricePaise: number; mrpPaise?: number; stockQty?: number }[];
      };

      const rows = body.products as Row[];
      const results: { name: string; status: 'created' | 'updated' | 'error'; id?: string; error?: string }[] = [];
      const touchedShops = new Set<string>();

      // Cache shop + category lookups across the batch.
      const categoryCache = new Map<string, string>(); // `${shopId}::${name}` -> categoryId

      for (const row of rows) {
        try {
          if (!row.shopId || !UUID_RE.test(row.shopId)) throw new Error('valid shopId required');
          if (!row.name || typeof row.name !== 'string') throw new Error('name required');
          if (typeof row.pricePaise !== 'number' || row.pricePaise < 0) throw new Error('pricePaise (number) required');

          const shop = await app.prisma.shop.findUnique({ where: { id: row.shopId }, select: { id: true } });
          if (!shop) throw new Error('shop not found');

          // Resolve (find-or-create) category within the shop.
          let categoryId: string | undefined;
          if (row.categoryName) {
            const key = `${row.shopId}::${row.categoryName.toLowerCase()}`;
            categoryId = categoryCache.get(key);
            if (!categoryId) {
              const existing = await app.prisma.category.findFirst({
                where: { shopId: row.shopId, name: row.categoryName }, select: { id: true },
              });
              categoryId = existing?.id ?? (await app.prisma.category.create({
                data: { shopId: row.shopId, name: row.categoryName }, select: { id: true },
              })).id;
              categoryCache.set(key, categoryId);
            }
          }

          const attributes = Array.isArray(row.attributes)
            ? row.attributes.filter((a) => a && typeof a.label === 'string' && typeof a.value === 'string')
            : undefined;

          const scalars = {
            name:        row.name,
            price:       row.pricePaise,
            mrpPaise:    typeof row.mrpPaise === 'number' ? row.mrpPaise : null,
            unit:        row.unit ?? null,
            description: row.description ?? null,
            categoryId:  categoryId ?? null,
            ...(attributes ? { attributes } : {}),
          };

          // Idempotent on (shopId, name).
          const existing = await app.prisma.product.findFirst({
            where: { shopId: row.shopId, name: row.name }, select: { id: true },
          });

          const product = existing
            ? await app.prisma.product.update({ where: { id: existing.id }, data: scalars, select: { id: true } })
            : await app.prisma.product.create({ data: { shopId: row.shopId, ...scalars }, select: { id: true } });

          // Replace images (ordered) when provided.
          if (Array.isArray(row.imageUrls)) {
            const urls = row.imageUrls.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
            await app.prisma.productImage.deleteMany({ where: { productId: product.id } });
            if (urls.length > 0) {
              await app.prisma.productImage.createMany({
                data: urls.map((url, i) => ({ productId: product.id, url, sortOrder: i })),
              });
            }
          }

          // Replace variants when provided.
          if (Array.isArray(row.variants)) {
            await app.prisma.productVariant.deleteMany({ where: { productId: product.id } });
            if (row.variants.length > 0) {
              await app.prisma.productVariant.createMany({
                data: row.variants
                  .filter((v) => v && typeof v.name === 'string' && typeof v.pricePaise === 'number')
                  .map((v, i) => ({
                    productId: product.id,
                    name:      v.name,
                    price:     v.pricePaise,
                    mrpPaise:  typeof v.mrpPaise === 'number' ? v.mrpPaise : null,
                    stockQty:  typeof v.stockQty === 'number' ? v.stockQty : 0,
                    sortOrder: i,
                  })),
              });
            }
          }

          touchedShops.add(row.shopId);
          results.push({ name: row.name, status: existing ? 'updated' : 'created', id: product.id });
        } catch (err) {
          results.push({ name: row.name ?? '(unknown)', status: 'error', error: (err as Error).message });
        }
      }

      // Invalidate affected shop catalog caches.
      const cacheKeys = [...touchedShops].map((s) => `catalog:shop:${s}:full`);
      if (cacheKeys.length > 0) await app.redis.del(...cacheKeys, 'catalog:shops:active').catch(() => {});

      const created = results.filter((r) => r.status === 'created').length;
      const updated = results.filter((r) => r.status === 'updated').length;
      const failed  = results.filter((r) => r.status === 'error').length;
      return reply.status(201).send({ created, updated, failed, total: results.length, results });
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
