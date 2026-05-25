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

  async function searchProducts(query: string, shopId?: string) {
    if (query.trim().length < 2) return [];

    // Build where clause
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
      id:          p.id,
      name:        p.name,
      price:       p.price,
      stockStatus: p.stockStatus,
      unit:        p.unit,
      shopId:      p.shopId,
      shopName:    p.shop.name,
      imageUrl:    p.images[0]?.url ?? null,
    }));
  }

  async function invalidateShopCache(shopId: string) {
    await Promise.all([
      redis.del(keys.shopDetail(shopId)),
      redis.del(keys.shopList()),
    ]);
  }

  return { getShops, getShop, searchProducts, invalidateShopCache };
}
