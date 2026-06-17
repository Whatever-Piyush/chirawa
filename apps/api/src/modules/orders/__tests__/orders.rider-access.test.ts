import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderStatusChanged:      vi.fn(),
  emitNewOrderForSeller:       vi.fn(),
  emitOrderCancelledForSeller:  vi.fn(),
}));

import { createOrdersService } from '../orders.service';

// BUG-1: a rider's read access + order list must key off RiderProfile.id (what
// Order.riderId stores), not the User.id. Distinct values are required to catch it.
const RIDER_PROFILE = 'rider_profile_1';
const RIDER_USER    = 'rider_user_1';

// BUG-2: getOrder surfaces the assigned rider's name + phone (fullName on
// RiderProfile, phone on its User).
const RIDER_RECORD = { fullName: 'Ramesh Kumar', user: { phone: '7700110001' } };
const RIDER = { name: 'Ramesh Kumar', phone: '7700110001' };

// Default: an actively-delivering order assigned to RIDER_PROFILE, owned by cust_1.
const baseOrder = {
  id: 'order_1', riderId: RIDER_PROFILE, customerId: 'cust_1', shopId: 'shop_1',
  status: 'out_for_delivery', items: [], statusHistory: [], payments: [],
};

function makeService(opts: {
  order?: unknown;
  findMany?: ReturnType<typeof vi.fn>;
  profile?: unknown;            // riderProfile.findUnique resolved value (default record)
  profileThrows?: boolean;      // make riderProfile.findUnique reject (defensive test)
  sellerShop?: { id: string };  // sellerProfile.shop, to make a seller "allowed"
} = {}) {
  const findMany = opts.findMany ?? vi.fn().mockResolvedValue([]);
  const riderProfileFind = opts.profileThrows
    ? vi.fn().mockRejectedValue(new Error('db unavailable'))
    : vi.fn().mockResolvedValue('profile' in opts ? opts.profile : RIDER_RECORD);
  const prisma = {
    order: {
      findUnique: vi.fn().mockResolvedValue(opts.order ?? baseOrder),
      findMany,
    },
    riderProfile: { findUnique: riderProfileFind },
    sellerProfile: {
      findUnique: vi.fn().mockResolvedValue(opts.sellerShop ? { shop: opts.sellerShop } : null),
    },
  } as unknown as Parameters<typeof createOrdersService>[0];
  const redis = {} as unknown as Parameters<typeof createOrdersService>[1];
  return { service: createOrdersService(prisma, redis), findMany, riderProfileFind };
}

describe('getOrder — rider access (BUG-1)', () => {
  it('allows the assigned rider when given their RiderProfile.id', async () => {
    const { service } = makeService();
    const order = await service.getOrder('order_1', RIDER_USER, 'rider', RIDER_PROFILE);
    expect(order.id).toBe('order_1');
  });

  it('BUG-1 regression: 403s when given the rider User.id instead of the RiderProfile.id', async () => {
    const { service } = makeService();
    await expect(service.getOrder('order_1', RIDER_USER, 'rider', RIDER_USER)).rejects.toThrow();
  });
});

describe('getMyOrders — rider list (BUG-1)', () => {
  it('filters orders by RiderProfile.id, not User.id', async () => {
    const { service, findMany } = makeService();
    await service.getMyOrders(RIDER_USER, 'rider', RIDER_PROFILE);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { riderId: RIDER_PROFILE } }),
    );
  });
});

describe('getOrder — rider details visibility (BUG-2 + privacy hardening)', () => {
  // ── Exposed: active delivery + allowed viewer ───────────────────────────────
  it.each(['picked_up', 'out_for_delivery'])(
    'exposes rider to the customer during active delivery (status %s)',
    async (status) => {
      const { service, riderProfileFind } = makeService({ order: { ...baseOrder, status } });
      const order = await service.getOrder('order_1', 'cust_1', 'customer', '') as { rider?: typeof RIDER };
      expect(riderProfileFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: RIDER_PROFILE } }));
      expect(order.rider).toEqual(RIDER);
    },
  );

  it('exposes rider to admin during active delivery', async () => {
    const { service } = makeService();
    const order = await service.getOrder('order_1', 'admin_user', 'admin', '') as { rider?: typeof RIDER };
    expect(order.rider).toEqual(RIDER);
  });

  it('exposes rider to the assigned rider during active delivery', async () => {
    const { service } = makeService();
    const order = await service.getOrder('order_1', RIDER_USER, 'rider', RIDER_PROFILE) as { rider?: typeof RIDER };
    expect(order.rider).toEqual(RIDER);
  });

  // ── Hidden by STATUS: not during active delivery → no expose, no lookup ──────
  it.each(['confirmed', 'preparing', 'ready_for_pickup', 'delivered', 'cancelled'])(
    'hides rider (and skips the lookup) for status %s',
    async (status) => {
      const { service, riderProfileFind } = makeService({ order: { ...baseOrder, status } });
      const order = await service.getOrder('order_1', 'cust_1', 'customer', '') as { rider?: unknown };
      expect(order.rider).toBeUndefined();
      expect(riderProfileFind).not.toHaveBeenCalled();
    },
  );

  // ── Hidden by ROLE: seller never sees rider, even when allowed + active ──────
  it('hides rider from the seller (and skips the lookup) even during active delivery', async () => {
    const { service, riderProfileFind } = makeService({ sellerShop: { id: 'shop_1' } });
    const order = await service.getOrder('order_1', 'seller_user', 'seller', '') as { id: string; rider?: unknown };
    expect(order.id).toBe('order_1');            // seller is still authorized to read the order
    expect(order.rider).toBeUndefined();         // …but never gets the rider's personal phone
    expect(riderProfileFind).not.toHaveBeenCalled();
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────
  it('hides rider (and skips the lookup) when the order is unassigned', async () => {
    const { service, riderProfileFind } = makeService({ order: { ...baseOrder, riderId: null } });
    const order = await service.getOrder('order_1', 'cust_1', 'customer', '') as { rider?: unknown };
    expect(order.rider).toBeUndefined();
    expect(riderProfileFind).not.toHaveBeenCalled();
  });

  it('hides rider defensively when the profile lookup returns nothing', async () => {
    const { service } = makeService({ profile: null });
    const order = await service.getOrder('order_1', 'cust_1', 'customer', '') as { rider?: unknown };
    expect(order.rider).toBeUndefined();
  });

  it('still returns the order (does not throw) when the rider lookup fails', async () => {
    const { service } = makeService({ profileThrows: true });
    const order = await service.getOrder('order_1', 'cust_1', 'customer', '') as { id: string; rider?: unknown };
    expect(order.id).toBe('order_1');   // order retrieval succeeds despite the failed lookup
    expect(order.rider).toBeUndefined();
  });
});
