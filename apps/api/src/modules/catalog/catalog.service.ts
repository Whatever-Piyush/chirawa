import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { NotFoundError } from '../../shared/errors/app-errors';

const CACHE_TTL = { shopList: 600, shopDetail: 300 };

const keys = {
  shopList:   () => `catalog:shops:active`,
  shopDetail: (shopId: string) => `catalog:shop:${shopId}:full`,
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
        openTime: true, closeTime: true, isOpen: true,
        estimatedDeliveryMinutes: true, address: true,
        lat: true, lng: true,
      },
    });

    const result = shops.map((s) => ({
      ...s,
      lat: Number(s.lat),
      lng: Number(s.lng),
      isCurrentlyOpen: computeIsOpen(s),
    }));

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

    const result = {
      id: shop.id, name: shop.name, description: shop.description,
      logoUrl: shop.logoUrl, address: shop.address,
      lat: Number(shop.lat), lng: Number(shop.lng),
      isCurrentlyOpen: computeIsOpen(shop),
      openTime: shop.openTime, closeTime: shop.closeTime,
      estimatedDeliveryMinutes: shop.estimatedDeliveryMinutes,
      categories: shop.categories.map((cat) => ({
        id: cat.id, name: cat.name, sortOrder: cat.sortOrder,
        products: cat.products.map((p) => ({
          id: p.id, name: p.name, description: p.description,
          price: p.price, unit: p.unit, stockStatus: p.stockStatus,
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

  // pg_trgm-powered search returning grouped { products, shops, query }
  async function searchCatalog(rawQuery: string) {
    const q = rawQuery.trim();
    if (q.length < 2) return { products: [], shops: [], query: q };

    const like = `%${q}%`;

    type ProductRow = {
      id: string; name: string; pricePaise: number | bigint;
      shopId: string; shopName: string; imageUrl: string | null; inStock: boolean;
    };
    type ShopRow = {
      id: string; name: string; address: string;
      isOpen: boolean; openTime: string; closeTime: string;
    };

    const [productRows, shopRows] = await Promise.all([
      // Products: fuzzy match on name + shop name; only available stock
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
            GREATEST(
              word_similarity(${q}, p.name),
              similarity(p.name, ${q}),
              similarity(s.name, ${q})
            ) AS score
          FROM products p
          JOIN shops s ON s.id = p.shop_id
          LEFT JOIN LATERAL (
            SELECT url FROM product_images
            WHERE product_id = p.id
            ORDER BY sort_order ASC
            LIMIT 1
          ) pi ON true
          WHERE
            p.is_active      = true
            AND p.stock_status = 'available'
            AND s.is_active   = true
            AND (
              p.name ILIKE ${like}
              OR word_similarity(${q}, p.name) > 0.2
              OR similarity(p.name, ${q})       > 0.15
              OR similarity(s.name, ${q})       > 0.2
            )
        ) sub
        ORDER BY score DESC
        LIMIT 20
      `,

      // Shops: fuzzy match on name; only active shops
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
    ]);

    return {
      query: q,
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

  async function invalidateShopCache(shopId: string) {
    await Promise.all([
      redis.del(keys.shopDetail(shopId)),
      redis.del(keys.shopList()),
    ]);
  }

  return { getShops, getShop, searchProducts, searchCatalog, invalidateShopCache };
}
