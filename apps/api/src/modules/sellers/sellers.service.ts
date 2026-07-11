import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { NotFoundError, ValidationError } from '../../shared/errors/app-errors';
import { createCatalogService } from '../catalog/catalog.service';

// Order statuses that represent a real sale (exclude pending_payment + cancelled).
const SOLD_STATUSES = [
  'paid', 'confirmed', 'preparing', 'ready_for_pickup',
  'picked_up', 'out_for_delivery', 'delivered',
] as const;

export function createSellersService(prisma: PrismaClient, redis: Redis) {
  // Resolve the shop owned by the authenticated seller user.
  async function resolveShop(userId: string) {
    const profile = await prisma.sellerProfile.findUnique({
      where:   { userId },
      include: { shop: { select: { id: true, name: true } } },
    });
    if (!profile?.shop) throw new NotFoundError('Shop');
    return { sellerId: profile.id, shopId: profile.shop.id, shopName: profile.shop.name };
  }

  // ── The seller's own shop (Seller Sprint 0 P0-1) ──────────────────────────
  // Authoritative shop identity from the seller PROFILE — not inferred from the
  // first order. A freshly provisioned seller with zero orders resolves their
  // shop here, so inventory (add product) works from day one.
  async function getMyShop(userId: string) {
    const profile = await prisma.sellerProfile.findUnique({
      where:  { userId },
      select: {
        shop: {
          select: { id: true, name: true, isOpen: true, openTime: true, closeTime: true },
        },
      },
    });
    if (!profile?.shop) throw new NotFoundError('Shop');
    return profile.shop;
  }

  // ── Seller-controlled open / close (Seller Sprint 0 P0-2) ─────────────────
  // Flips Shop.isOpen — the manual hard gate that computeIsOpen() and the order
  // resolver already honour (a closed shop is excluded from ordering). Reuses
  // the existing shop-cache invalidation so the customer feed reflects it.
  async function setShopOpen(userId: string, isOpen: boolean) {
    if (typeof isOpen !== 'boolean') throw new ValidationError('isOpen must be a boolean');
    const { shopId } = await resolveShop(userId);
    const updated = await prisma.shop.update({
      where:  { id: shopId },
      data:   { isOpen },
      select: { id: true, name: true, isOpen: true, openTime: true, closeTime: true },
    });
    await createCatalogService(prisma, redis).invalidateShopCache(shopId);
    return updated;
  }

  // ── Sales summary (Task 8.4) ──────────────────────────────────────────────
  // Today / this week (Mon-anchored) / this month order counts + product value,
  // plus the best-selling product this week. Value is goods value
  // (cartSubtotalAtPricing) — what the seller is owed, since delivery fee is the
  // platform's and commission is currently 0.
  async function getSalesSummary(userId: string) {
    const { shopId, shopName } = await resolveShop(userId);

    const now = new Date();
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek  = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7)); // Monday
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const windowStats = async (from: Date) => {
      const agg = await prisma.order.aggregate({
        where:  { shopId, status: { in: SOLD_STATUSES as unknown as never }, createdAt: { gte: from } },
        _count: { _all: true },
        _sum:   { cartSubtotalAtPricing: true },
      });
      return { orders: agg._count._all, valuePaise: agg._sum.cartSubtotalAtPricing ?? 0 };
    };

    const [today, week, month] = await Promise.all([
      windowStats(startOfToday), windowStats(startOfWeek), windowStats(startOfMonth),
    ]);

    // Best-selling product this week, by quantity.
    const weekOrders = await prisma.order.findMany({
      where:  { shopId, status: { in: SOLD_STATUSES as unknown as never }, createdAt: { gte: startOfWeek } },
      select: { id: true },
    });
    let bestSeller: { productName: string; quantity: number } | null = null;
    if (weekOrders.length > 0) {
      const grouped = await prisma.orderItem.groupBy({
        by:      ['productName'],
        where:   { orderId: { in: weekOrders.map((o) => o.id) } },
        _sum:    { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take:    1,
      });
      if (grouped[0]) bestSeller = { productName: grouped[0].productName, quantity: grouped[0]._sum.quantity ?? 0 };
    }

    return { shopName, today, week, month, bestSeller };
  }

  // ── Settlement history (Task 8.5) ─────────────────────────────────────────
  // Last 8 settlement periods for this seller plus a live "current" running
  // total = goods value of delivered orders newer than the latest settled
  // period (i.e. not yet paid out). Commission stays 0 (platformFeePaise).
  async function getSettlements(userId: string) {
    const { sellerId, shopId } = await resolveShop(userId);

    const settlements = await prisma.settlement.findMany({
      where:   { sellerId },
      orderBy: { periodDate: 'desc' },
      take:    8,
      select: {
        id: true, periodDate: true, totalOrders: true, totalProductPaise: true,
        platformFeePaise: true, netPayablePaise: true, status: true, paidAt: true,
      },
    });

    const lastSettled = settlements[0]?.periodDate ?? new Date(0);
    const pending = await prisma.order.aggregate({
      where: {
        shopId, status: 'delivered' as never,
        deliveredAt: { gt: lastSettled },
      },
      _count: { _all: true },
      _sum:   { cartSubtotalAtPricing: true },
    });

    return {
      settlements,
      current: {
        orders:           pending._count._all,
        totalProductPaise: pending._sum.cartSubtotalAtPricing ?? 0,
        platformFeePaise: 0,
        netPayablePaise:  pending._sum.cartSubtotalAtPricing ?? 0,
      },
    };
  }

  return { getMyShop, setShopOpen, getSalesSummary, getSettlements };
}
