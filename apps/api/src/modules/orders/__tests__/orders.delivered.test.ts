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
// These MUST be different values or the test cannot catch the id-space mismatch
// (the old test used one constant for both and passed despite the prod bug).
const RIDER_PROFILE = 'rider_profile_1';
const RIDER_USER    = 'rider_user_1';

const prepaidOrder = {
  id: 'order_1', riderId: RIDER_PROFILE, paymentMethod: 'upi',
  shopId: 'shop_1', customerId: 'cust_1', status: 'out_for_delivery',
};

function makeService(order: unknown) {
  const orderUpdate = vi.fn().mockResolvedValue({});
  const historyCreate = vi.fn().mockResolvedValue({});
  const prisma = {
    order: { findUnique: vi.fn().mockResolvedValue(order), update: orderUpdate },
    orderStatusHistory: { create: historyCreate },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as Parameters<typeof createOrdersService>[0];
  const redis = {} as unknown as Parameters<typeof createOrdersService>[1];
  return { service: createOrdersService(prisma, redis), orderUpdate, historyCreate };
}

describe('markDelivered (0.1 — rider delivered path for non-COD)', () => {
  beforeEach(() => { emitOrderStatusChanged.mockClear(); });

  it('marks a prepaid order delivered: status + deliveredAt + history + event', async () => {
    const { service, orderUpdate, historyCreate } = makeService(prepaidOrder);
    const result = await service.markDelivered('order_1', RIDER_PROFILE, RIDER_USER);

    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order_1' },
        data:  expect.objectContaining({ status: 'delivered', deliveredAt: expect.any(Date) }),
      }),
    );
    // No cash recorded for a prepaid order.
    expect(orderUpdate.mock.calls[0]![0].data).not.toHaveProperty('codCollectedPaise');
    // History actor is the User.id (changedById), per the changedById convention.
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderId: 'order_1', status: 'delivered', changedByRole: 'rider', changedById: RIDER_USER }),
      }),
    );
    // The broadcast carries the RiderProfile.id (consistent with the dispatch emits).
    expect(emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order_1', status: 'delivered', riderId: RIDER_PROFILE, customerId: 'cust_1' }),
    );
    expect(result.message).toBeTruthy();
  });

  it('BUG-1 regression: rejects when given the rider User.id instead of the RiderProfile.id', async () => {
    // Pre-fix, the route passed request.auth.userId here, which never equals the
    // stored RiderProfile.id — so this path always 403'd in production.
    const { service, orderUpdate } = makeService(prepaidOrder);
    await expect(service.markDelivered('order_1', RIDER_USER, RIDER_USER)).rejects.toThrow();
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(emitOrderStatusChanged).not.toHaveBeenCalled();
  });

  it('rejects a COD order (must use cod-collected)', async () => {
    const { service, orderUpdate } = makeService({ ...prepaidOrder, paymentMethod: 'cod' });
    await expect(service.markDelivered('order_1', RIDER_PROFILE, RIDER_USER)).rejects.toThrow();
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(emitOrderStatusChanged).not.toHaveBeenCalled();
  });

  it('rejects a rider who does not own the delivery', async () => {
    const { service, orderUpdate } = makeService({ ...prepaidOrder, riderId: 'other_profile' });
    await expect(service.markDelivered('order_1', RIDER_PROFILE, RIDER_USER)).rejects.toThrow();
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('rejects a missing order', async () => {
    const { service } = makeService(null);
    await expect(service.markDelivered('nope', RIDER_PROFILE, RIDER_USER)).rejects.toThrow();
  });
});
