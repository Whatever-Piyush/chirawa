import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderStatusChanged:      vi.fn(),
  emitNewOrderForSeller:       vi.fn(),
  emitOrderCancelledForSeller:  vi.fn(),
}));

import * as eventBus from '../../../shared/events/event-bus';
import { createOrdersService } from '../orders.service';

const emitOrderStatusChanged = vi.mocked(eventBus.emitOrderStatusChanged);

// BUG-1: Order.riderId holds the RiderProfile.id; the COD balance lives on
// RiderProfile (keyed by its id). User.id is only the status-history actor.
const RIDER_PROFILE = 'rider_profile_1';
const RIDER_USER    = 'rider_user_1';
const AMOUNT        = 16000;

const codOrder = {
  id: 'order_1', riderId: RIDER_PROFILE, paymentMethod: 'cod',
  shopId: 'shop_1', customerId: 'cust_1', status: 'out_for_delivery',
};

function makeService(order: unknown) {
  const orderUpdate    = vi.fn().mockResolvedValue({});
  const historyCreate  = vi.fn().mockResolvedValue({});
  const riderUpdate    = vi.fn().mockResolvedValue({});
  const prisma = {
    order: { findUnique: vi.fn().mockResolvedValue(order), update: orderUpdate },
    orderStatusHistory: { create: historyCreate },
    riderProfile: { update: riderUpdate },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as Parameters<typeof createOrdersService>[0];
  const redis = {} as unknown as Parameters<typeof createOrdersService>[1];
  return { service: createOrdersService(prisma, redis), orderUpdate, historyCreate, riderUpdate };
}

describe('codCollected (rider COD path)', () => {
  beforeEach(() => { emitOrderStatusChanged.mockClear(); });

  it('records the cash, marks delivered, and credits the COD balance by RiderProfile.id', async () => {
    const { service, orderUpdate, historyCreate, riderUpdate } = makeService(codOrder);
    const result = await service.codCollected('order_1', RIDER_PROFILE, AMOUNT, RIDER_USER);

    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order_1' },
        data:  expect.objectContaining({ status: 'delivered', deliveredAt: expect.any(Date), codCollectedPaise: AMOUNT }),
      }),
    );
    // History actor is the User.id.
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ changedById: RIDER_USER }) }),
    );
    // BUG-1 ledger fix: the COD balance is updated by RiderProfile.id (`id`), NOT
    // by `userId` (the old code used `where: { userId: <userId> }`, which no-op'd).
    expect(riderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RIDER_PROFILE },
        data:  { codBalancePaise: { increment: AMOUNT } },
      }),
    );
    expect(emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order_1', status: 'delivered', riderId: RIDER_PROFILE }),
    );
    expect(result.message).toBeTruthy();
  });

  it('BUG-1 regression: rejects when given the rider User.id instead of the RiderProfile.id', async () => {
    const { service, orderUpdate, riderUpdate } = makeService(codOrder);
    await expect(service.codCollected('order_1', RIDER_USER, AMOUNT, RIDER_USER)).rejects.toThrow();
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(riderUpdate).not.toHaveBeenCalled();
  });

  it('rejects a non-COD order (must use the delivered path)', async () => {
    const { service, orderUpdate, riderUpdate } = makeService({ ...codOrder, paymentMethod: 'upi' });
    await expect(service.codCollected('order_1', RIDER_PROFILE, AMOUNT, RIDER_USER)).rejects.toThrow();
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(riderUpdate).not.toHaveBeenCalled();
  });

  it('rejects a rider who does not own the delivery', async () => {
    const { service, orderUpdate } = makeService({ ...codOrder, riderId: 'other_profile' });
    await expect(service.codCollected('order_1', RIDER_PROFILE, AMOUNT, RIDER_USER)).rejects.toThrow();
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('rejects a missing order', async () => {
    const { service } = makeService(null);
    await expect(service.codCollected('nope', RIDER_PROFILE, AMOUNT, RIDER_USER)).rejects.toThrow();
  });
});
