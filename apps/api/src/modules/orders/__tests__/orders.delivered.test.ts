import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the event bus so markDelivered never touches Redis pub/sub. The factory is
// hoisted, so all named imports orders.service pulls from event-bus must be
// provided here or module load fails.
vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderStatusChanged:     vi.fn(),
  emitNewOrderForSeller:      vi.fn(),
  emitOrderCancelledForSeller: vi.fn(),
}));

import * as eventBus from '../../../shared/events/event-bus';
import { createOrdersService } from '../orders.service';

const emitOrderStatusChanged = vi.mocked(eventBus.emitOrderStatusChanged);

// BUG-1 regression: Order.riderId stores the RiderProfile.id, NOT the User.id.
const RIDER_PROFILE = 'rider_profile_1';
const RIDER_USER    = 'rider_user_1';

const prepaidOrder = {
  id: 'order_1', riderId: RIDER_PROFILE, paymentMethod: 'upi',
  shopId: 'shop_1', customerId: 'cust_1', status: 'out_for_delivery', totalAmount: 28500,
};

// markDelivered now routes through the transition primitive: callback-form
// $transaction + compare-and-set order.updateMany (returns { count }).
function makeService(order: unknown, flipCount = 1) {
  const orderUpdateMany = vi.fn().mockResolvedValue({ count: flipCount });
  const historyCreate   = vi.fn().mockResolvedValue({});
  const prisma = {
    order: { findUnique: vi.fn().mockResolvedValue(order), updateMany: orderUpdateMany },
    orderStatusHistory: { create: historyCreate },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const redis = {} as unknown as Parameters<typeof createOrdersService>[1];
  return { service: createOrdersService(prisma as unknown as Parameters<typeof createOrdersService>[0], redis), orderUpdateMany, historyCreate };
}

describe('markDelivered (0.1 — rider delivered path for non-COD)', () => {
  beforeEach(() => { emitOrderStatusChanged.mockClear(); });

  it('marks a prepaid order delivered via the transition primitive (compare-and-set)', async () => {
    const { service, orderUpdateMany, historyCreate } = makeService(prepaidOrder);
    const result = await service.markDelivered('order_1', RIDER_PROFILE, RIDER_USER);

    expect(orderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order_1', status: 'out_for_delivery' },
        data:  expect.objectContaining({ status: 'delivered', deliveredAt: expect.any(Date) }),
      }),
    );
    // No cash recorded for a prepaid order.
    expect(orderUpdateMany.mock.calls[0]![0].data).not.toHaveProperty('codCollectedPaise');
    // History actor is the User.id (changedById).
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderId: 'order_1', status: 'delivered', changedByRole: 'rider', changedById: RIDER_USER }),
      }),
    );
    expect(emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order_1', status: 'delivered', riderId: RIDER_PROFILE, customerId: 'cust_1' }),
    );
    expect(result.message).toBeTruthy();
  });

  it('V5: re-delivering an already-delivered order is idempotent (no re-stamp, no event)', async () => {
    const { service, orderUpdateMany } = makeService({ ...prepaidOrder, status: 'delivered' });
    const result = await service.markDelivered('order_1', RIDER_PROFILE, RIDER_USER);
    expect(result.message).toBeTruthy();
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(emitOrderStatusChanged).not.toHaveBeenCalled();
  });

  it('V5: rejects an illegal forward-skip (picked_up → delivered)', async () => {
    const { service, orderUpdateMany } = makeService({ ...prepaidOrder, status: 'picked_up' });
    await expect(service.markDelivered('order_1', RIDER_PROFILE, RIDER_USER)).rejects.toThrow();
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(emitOrderStatusChanged).not.toHaveBeenCalled();
  });

  it('BUG-1 regression: rejects when given the rider User.id instead of the RiderProfile.id', async () => {
    const { service, orderUpdateMany } = makeService(prepaidOrder);
    await expect(service.markDelivered('order_1', RIDER_USER, RIDER_USER)).rejects.toThrow();
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(emitOrderStatusChanged).not.toHaveBeenCalled();
  });

  it('rejects a COD order (must use cod-collected)', async () => {
    const { service, orderUpdateMany } = makeService({ ...prepaidOrder, paymentMethod: 'cod' });
    await expect(service.markDelivered('order_1', RIDER_PROFILE, RIDER_USER)).rejects.toThrow();
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(emitOrderStatusChanged).not.toHaveBeenCalled();
  });

  it('rejects a rider who does not own the delivery', async () => {
    const { service, orderUpdateMany } = makeService({ ...prepaidOrder, riderId: 'other_profile' });
    await expect(service.markDelivered('order_1', RIDER_PROFILE, RIDER_USER)).rejects.toThrow();
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects a missing order', async () => {
    const { service } = makeService(null);
    await expect(service.markDelivered('nope', RIDER_PROFILE, RIDER_USER)).rejects.toThrow();
  });
});
