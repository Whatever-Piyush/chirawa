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

const assignedOrder = {
  id: 'order_1', riderId: RIDER_PROFILE, customerId: 'cust_1', shopId: 'shop_1',
  status: 'out_for_delivery', items: [], statusHistory: [], payments: [],
};

function makeService(opts: { order?: unknown; findMany?: ReturnType<typeof vi.fn> } = {}) {
  const findMany = opts.findMany ?? vi.fn().mockResolvedValue([]);
  const prisma = {
    order: {
      findUnique: vi.fn().mockResolvedValue(opts.order ?? assignedOrder),
      findMany,
    },
    sellerProfile: { findUnique: vi.fn().mockResolvedValue(null) },
  } as unknown as Parameters<typeof createOrdersService>[0];
  const redis = {} as unknown as Parameters<typeof createOrdersService>[1];
  return { service: createOrdersService(prisma, redis), findMany };
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
