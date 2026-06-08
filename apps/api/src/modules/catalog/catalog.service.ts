import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { NotFoundError } from '../../shared/errors/app-errors';

const CACHE_TTL = { shopList: 600, shopDetail: 300 };
const ALIAS_CACHE_TTL = 3600;

// Validate UUIDs before hitting Prisma so a malformed :id returns 404, not 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Search filters & sort (Chunk 4 — Task 4.1) ──────────────────────────────
export type SearchSort = 'relevance' | 'priceLow' | 'priceHigh' | 'rating';

export interface SearchOpts {
  category?: string;   // category NAME — categories are per-shop, deduped by name app-wide
  shopId?:   string;
  minPrice?: number;   // paise (inclusive)
  maxPrice?: number;   // paise (inclusive)
  inStock?:  boolean;  // honored implicitly: search already returns only in-stock products
  sort?:     SearchSort;
}

const VALID_SORTS: readonly SearchSort[] = ['relevance', 'priceLow', 'priceHigh', 'rating'];

// Coerce an untrusted ?sort= value to a known sort, defaulting to relevance.
export function parseSearchSort(raw?: string): SearchSort {
  return raw != null && (VALID_SORTS as readonly string[]).includes(raw)
    ? (raw as SearchSort)
    : 'relevance';
}

// Parse a price query param (rupees-free, already paise) into a non-negative int,
// or undefined when absent/invalid so the filter is simply skipped.
export function parsePricePaise(raw?: string): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

const keys = {
  shopList:    ()           => `catalog:shops:active`,
  shopDetail:  (shopId: string) => `catalog:shop:${shopId}:full`,
  aliasExpand: (q: string)  => `search:aliases:expanded:${q.toLowerCase().trim()}`,
};

function computeIsOpen(shop: {
  isOpen: boolean; openTime: string; closeTime: string;
}): boolean {
  if (!shop.isOpen) return false;
  const now  = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  return hhmm >= shop.openTime && hhmm <= shop.closeTime;
}

export function createCatalogService(prisma: PrismaClient, redis: Redis) {

  async function getShops() {
    const cached = await redis.get(keys.shopList()).catch(() => null);
    if (cached) return JSON.parse(cached) as unknown[];

    const shops = await prisma.shop.findMany({
      where:   { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, description: true, logoUrl: true,
        openTime: true, closeTime: true, isOpen: true, isFeatured: true,
        estimatedDeliveryMinutes: true, address: true,
        lat: true, lng: true,
      },
    });

    // Aggregate customer ratings (Order.rating) per shop in one query.
    const ratingRows = await prisma.order.groupBy({
      by:     ['shopId'],
      where:  { rating: { not: null } },
      _avg:   { rating: true },
      _count: { rating: true },
    });
    const ratingMap = new Map(
      ratingRows.map((r) => [r.shopId, { average: r._avg.rating, count: r._count.rating }]),
    );

    const result = shops.map((s) => {
      const r = ratingMap.get(s.id);
      return {
        ...s,
        lat: Number(s.lat),
        lng: Number(s.lng),
        isCurrentlyOpen: computeIsOpen(s),
        rating: {
          average: r?.average != null ? Math.round(r.average * 10) / 10 : null,
          count: r?.count ?? 0,
        },
      };
    });

    await redis.setex(keys.shopList(), CACHE_TTL.shopList, JSON.stringify(result));
    return result;
  }

  async function getShop(shopId: string) {
    const cached = await redis.get(keys.shopDetail(shopId)).catch(() => null);
    if (cached) return JSON.parse(cached) as unknown;

    const shop = await prisma.shop.findUnique({
      where: { id: shopId, isActive: true },
      include: {
        categories: {
          where:   { isActive: true, parentId: null },
          orderBy: { sortOrder: 'asc' },
          include: {
            products: {
              where:   { isActive: true, stockStatus: { not: 'hidden' } },
              orderBy: { sortOrder: 'asc' },
              include: {
                images: {
                  orderBy: { sortOrder: 'asc' },
                  take:    1,
                  select:  { url: true },
                },
              },
            },
          },
        },
      },
    });

    if (!shop) throw new NotFoundError('Shop');

    const ratingAgg = await prisma.order.aggregate({
      where:  { shopId, rating: { not: null } },
      _avg:   { rating: true },
      _count: { rating: true },
    });

    const result = {
      id: shop.id, name: shop.name, description: shop.description,
      logoUrl: shop.logoUrl, address: shop.address,
      lat: Number(shop.lat), lng: Number(shop.lng),
      isCurrentlyOpen: computeIsOpen(shop),
      openTime: shop.openTime, closeTime: shop.closeTime,
      estimatedDeliveryMinutes: shop.estimatedDeliveryMinutes,
      rating: {
        average: ratingAgg._avg.rating != null ? Math.round(ratingAgg._avg.rating * 10) / 10 : null,
        count: ratingAgg._count.rating,
      },
      categories: shop.categories.map((cat) => ({
        id: cat.id, name: cat.name, sortOrder: cat.sortOrder,
        products: cat.products.map((p) => ({
          id: p.id, name: p.name, description: p.description,
          price: p.price, mrpPaise: p.mrpPaise, unit: p.unit, stockStatus: p.stockStatus,
          imageUrl: p.images[0]?.url ?? null, sortOrder: p.sortOrder,
        })),
      })),
    };

    await redis.setex(keys.shopDetail(shopId), CACHE_TTL.shopDetail, JSON.stringify(result));
    return result;
  }

  // Legacy simple search kept for the catalog/search route (seller tools)
  async function searchProducts(query: string, shopId?: string) {
    if (query.trim().length < 2) return [];
    const where = {
      isActive:    true,
      stockStatus: { not: 'hidden' as const },
      shop:        { isActive: true },
      name:        { contains: query, mode: 'insensitive' as const },
      ...(shopId ? { shopId } : {}),
    };
    const products = await prisma.product.findMany({
      where,
      take: 20,
      include: {
        shop:   { select: { id: true, name: true } },
        images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
      },
    });
    return products.map((p) => ({
      id: p.id, name: p.name, price: p.price,
      stockStatus: p.stockStatus, unit: p.unit,
      shopId: p.shopId, shopName: p.shop.name,
      imageUrl: p.images[0]?.url ?? null,
    }));
  }

  // Expand a query using the search_aliases table; results are Redis-cached.
  async function expandSearchTerms(query: string): Promise<string[]> {
    const norm = query.toLowerCase().trim();
    const cacheKey = keys.aliasExpand(norm);

    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as string[];

    const terms = new Set<string>([norm]);

    const matches = await prisma.searchAlias.findMany({
      where: {
        OR: [
          { term: { contains: query, mode: 'insensitive' } },
          { aliases: { has: query.toLowerCase() } },
          { aliases: { has: query } },
        ],
      },
    });

    for (const match of matches) {
      terms.add(match.term.toLowerCase());
      match.aliases.forEach((a: string) => terms.add(a.toLowerCase()));
    }

    const result = Array.from(terms);
    await redis.setex(cacheKey, ALIAS_CACHE_TTL, JSON.stringify(result)).catch(() => {});
    return result;
  }

  // pg_trgm-powered search with alias expansion + optional filters/sort.
  // Returns { products, shops, query, total } where total is the full count of
  // matching products (results themselves are capped at 20 for the list).
  async function searchCatalog(rawQuery: string, opts: SearchOpts = {}) {
    const q = rawQuery.trim();
    if (q.length < 2) return { products: [], shops: [], query: q, total: 0 };

    const like = `%${q}%`;
    const sort = parseSearchSort(opts.sort);

    // Expand the query via alias table (Redis-backed, 1 hour TTL)
    const expandedTerms = await expandSearchTerms(q);

    // Build GREATEST(…) score across original + all alias expansions
    const scoreFragments = [
      Prisma.sql`word_similarity(${q}, p.name)`,
      Prisma.sql`similarity(p.name, ${q})`,
      Prisma.sql`similarity(s.name, ${q})`,
      ...expandedTerms.map((t) => Prisma.sql`word_similarity(${t}, p.name)`),
    ];
    const scoreExpr = Prisma.sql`GREATEST(${Prisma.join(scoreFragments, ', ')})`;

    // ILIKE match on any expanded term (exact alias hit)
    const likeParts = expandedTerms.map((t) => Prisma.sql`p.name ILIKE ${'%' + t + '%'}`);
    const aliasFilter = Prisma.join(likeParts, ' OR ');

    // ── Optional filter fragments (each pre-pended with AND) ────────────────
    const extra: Prisma.Sql[] = [];
    // shopId — guard the UUID so a malformed value can't blow up the ::uuid cast.
    if (opts.shopId && UUID_RE.test(opts.shopId)) {
      extra.push(Prisma.sql`AND p.shop_id = ${opts.shopId}::uuid`);
    }
    if (opts.category) extra.push(Prisma.sql`AND c.name = ${opts.category}`);
    if (opts.minPrice != null) extra.push(Prisma.sql`AND p.price >= ${opts.minPrice}`);
    if (opts.maxPrice != null) extra.push(Prisma.sql`AND p.price <= ${opts.maxPrice}`);
    const extraSql = extra.length ? Prisma.join(extra, ' ') : Prisma.empty;

    // Shared joins + WHERE so the list query and the COUNT stay in lockstep.
    // LEFT JOIN categories so the category filter works without dropping rows.
    const joins = Prisma.sql`
      JOIN shops s ON s.id = p.shop_id
      LEFT JOIN categories c ON c.id = p.category_id
    `;
    const whereBody = Prisma.sql`
      p.is_active        = true
      AND p.stock_status = 'available'
      AND s.is_active    = true
      AND (
        ${aliasFilter}
        OR word_similarity(${q}, p.name) > 0.2
        OR similarity(p.name, ${q})      > 0.15
        OR similarity(s.name, ${q})      > 0.2
      )
      ${extraSql}
    `;

    // ORDER BY references the inner subquery's output columns (score / shopRating
    // are projected there even though the outer SELECT doesn't list them).
    let orderExpr: Prisma.Sql;
    switch (sort) {
      case 'priceLow':  orderExpr = Prisma.sql`"pricePaise" ASC, score DESC`;  break;
      case 'priceHigh': orderExpr = Prisma.sql`"pricePaise" DESC, score DESC`; break;
      case 'rating':    orderExpr = Prisma.sql`"shopRating" DESC, score DESC`; break;
      default:          orderExpr = Prisma.sql`score DESC`;
    }

    type ProductRow = {
      id: string; name: string; pricePaise: number | bigint;
      shopId: string; shopName: string; imageUrl: string | null; inStock: boolean;
    };
    type ShopRow = {
      id: string; name: string; address: string;
      isOpen: boolean; openTime: string; closeTime: string;
    };
    type CountRow = { count: number | bigint };

    const [productRows, shopRows, countRows] = await Promise.all([
      prisma.$queryRaw<ProductRow[]>`
        SELECT id, name, "pricePaise", "shopId", "shopName", "imageUrl", "inStock"
        FROM (
          SELECT
            p.id::text,
            p.name,
            p.price            AS "pricePaise",
            p.shop_id::text    AS "shopId",
            s.name             AS "shopName",
            pi.url             AS "imageUrl",
            (p.stock_status = 'available') AS "inStock",
            ${scoreExpr}       AS score,
            COALESCE((
              SELECT AVG(o.rating) FROM orders o
              WHERE o.shop_id = p.shop_id AND o.rating IS NOT NULL
            ), 0)              AS "shopRating"
          FROM products p
          ${joins}
          LEFT JOIN LATERAL (
            SELECT url FROM product_images
            WHERE product_id = p.id
            ORDER BY sort_order ASC
            LIMIT 1
          ) pi ON true
          WHERE ${whereBody}
        ) sub
        ORDER BY ${orderExpr}
        LIMIT 20
      `,

      // Shops: fuzzy match on name only (shop names are in English)
      prisma.$queryRaw<ShopRow[]>`
        SELECT
          id::text,
          name,
          address,
          is_open    AS "isOpen",
          open_time  AS "openTime",
          close_time AS "closeTime"
        FROM shops
        WHERE
          is_active = true
          AND (
            name ILIKE ${like}
            OR word_similarity(${q}, name) > 0.2
            OR similarity(name, ${q})      > 0.15
          )
        ORDER BY GREATEST(word_similarity(${q}, name), similarity(name, ${q})) DESC
        LIMIT 5
      `,

      // Full match count (ignores the LIMIT 20) for the "Showing X results" label
      prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::int AS count
        FROM products p
        ${joins}
        WHERE ${whereBody}
      `,
    ]);

    return {
      query: q,
      total: Number(countRows[0]?.count ?? 0),
      products: productRows.map((p) => ({
        id:         p.id,
        name:       p.name,
        pricePaise: Number(p.pricePaise),
        shopId:     p.shopId,
        shopName:   p.shopName,
        imageUrl:   p.imageUrl,
        inStock:    p.inStock,
      })),
      shops: shopRows.map((s) => ({
        id:      s.id,
        name:    s.name,
        address: s.address,
        isOpen:  computeIsOpen(s),
      })),
    };
  }

  // Flat product list across all active shops, optionally filtered by category
  // NAME (categories are per-shop, so we match on name). Shaped for ProductCard.
  async function getProducts(opts: { category?: string; limit?: number }) {
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    const products = await prisma.product.findMany({
      where: {
        isActive:    true,
        stockStatus: { not: 'hidden' },
        shop:        { isActive: true },
        ...(opts.category ? { category: { name: opts.category } } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take:    limit,
      include: {
        shop:     { select: { id: true, name: true } },
        // Up to 8 images per card so the customer card can show a swipeable
        // carousel. imageUrl stays as the first for back-compat.
        images:   { orderBy: { sortOrder: 'asc' }, take: 8, select: { url: true } },
        variants: { where: { isActive: true }, take: 1, select: { id: true } },
      },
    });

    return products.map((p) => ({
      id:          p.id,
      name:        p.name,
      pricePaise:  p.price,
      mrpPaise:    p.mrpPaise,
      unit:        p.unit,
      stockStatus: p.stockStatus,
      inStock:     p.stockStatus === 'available',
      hasVariants: p.variants.length > 0,
      imageUrl:    p.images[0]?.url ?? null,
      images:      p.images.map((i) => i.url),
      shopId:      p.shopId,
      shopName:    p.shop.name,
    }));
  }

  // Distinct category NAMES across active shops, aggregated (count + a sample
  // image), ordered by sortOrder. Powers the Categories tab and Bestsellers.
  async function getCategories() {
    const cats = await prisma.category.findMany({
      where:   { isActive: true, shop: { isActive: true } },
      orderBy: { sortOrder: 'asc' },
      select: {
        name:      true,
        sortOrder: true,
        products: {
          where:   { isActive: true, stockStatus: { not: 'hidden' } },
          orderBy: { sortOrder: 'asc' },
          select:  { id: true, images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } } },
        },
      },
    });

    const byName = new Map<string, { name: string; sortOrder: number; productCount: number; imageUrl: string | null }>();
    for (const c of cats) {
      const firstImg = c.products.find((p) => p.images[0]?.url)?.images[0]?.url ?? null;
      const existing = byName.get(c.name);
      if (existing) {
        existing.productCount += c.products.length;
        if (!existing.imageUrl && firstImg) existing.imageUrl = firstImg;
      } else {
        byName.set(c.name, { name: c.name, sortOrder: c.sortOrder, productCount: c.products.length, imageUrl: firstImg });
      }
    }

    return [...byName.values()]
      .filter((c) => c.productCount > 0)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  // Single product detail for the Product Detail Page (PDP). Returns the full
  // product + all its images + up to 6 related products from the same shop.
  async function getProductDetail(productId: string) {
    // Guard malformed IDs so a bad URL returns 404, not a Prisma 500.
    if (!UUID_RE.test(productId)) throw new NotFoundError('Product');

    const p = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        shop:     { select: { id: true, name: true, isActive: true } },
        images:   { orderBy: { sortOrder: 'asc' }, select: { url: true } },
        variants: {
          where:   { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select:  { id: true, name: true, price: true, mrpPaise: true, stockQty: true },
        },
      },
    });
    if (!p || !p.isActive || !p.shop.isActive || p.stockStatus === 'hidden') {
      throw new NotFoundError('Product');
    }

    const related = await prisma.product.findMany({
      where:   { shopId: p.shopId, isActive: true, stockStatus: { not: 'hidden' }, id: { not: p.id } },
      orderBy: { sortOrder: 'asc' },
      take:    6,
      include: { images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } } },
    });

    return {
      id:          p.id,
      name:        p.name,
      description: p.description,
      price:       p.price,
      mrpPaise:    p.mrpPaise,
      unit:        p.unit,
      stockStatus: p.stockStatus,
      shopId:      p.shopId,
      shopName:    p.shop.name,
      imageUrl:    p.images[0]?.url ?? null,
      images:      p.images.map((i) => i.url),
      attributes:  Array.isArray(p.attributes) ? p.attributes : undefined,
      variants: p.variants.map((v) => ({
        id:       v.id,
        name:     v.name,
        price:    v.price,
        mrpPaise: v.mrpPaise,
        inStock:  v.stockQty > 0,
      })),
      related: related.map((r) => ({
        id:          r.id,
        name:        r.name,
        price:       r.price,
        mrpPaise:    r.mrpPaise,
        unit:        r.unit,
        stockStatus: r.stockStatus,
        imageUrl:    r.images[0]?.url ?? null,
      })),
    };
  }

  async function invalidateShopCache(shopId: string) {
    await Promise.all([
      redis.del(keys.shopDetail(shopId)),
      redis.del(keys.shopList()),
    ]);
  }

  return { getShops, getShop, getProducts, getCategories, getProductDetail, searchProducts, searchCatalog, invalidateShopCache };
}
