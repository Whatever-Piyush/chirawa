import { describe, it, expect, vi, beforeEach } from 'vitest';

// riderAdvance emits + recomputes ETA after the transaction; mock both so the unit
// test stays isolated from Redis pub/sub and the ETA DB reads.
vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderAssignedToRider: vi.fn(),
  emitOrderStatusChanged:   vi.fn(),
}));
vi.mock('../../orders/eta.service', () => ({
  computeAndPersistEta: vi.fn().mockResolvedValue(undefined),
}));

import { createDispatchService } from '../dispatch.service';

const RIDER_PROFILE = 'rider_profile_1';
const RIDER_USER    = 'rider_user_1';

// riderAdvance (markPickedUp / startDelivery) now routes through the transition
// primitive: callback-form $transaction + compare-and-set order.updateMany.
function makeService(order: unknown, flipCount = 1) {
  const orderUpdateMany = vi.fn().mockResolvedValue({ count: flipCount });
  const historyCreate   = vi.fn().mockResolvedValue({});
  const prisma = {
    riderProfile:       { findUnique: vi.fn().mockResolvedValue({ id: RIDER_PROFILE }) },
    deliveryAssignment: { findFirst:  vi.fn().mockResolvedValue({ id: 'assign_1', isActive: true }) },
    order: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(order),
      updateMany:        orderUpdateMany,
      count:             vi.fn().mockResolvedValue(0),
    },
    orderStatusHistory: { create: historyCreate },
    // Inventory hook on → picked_up commits reservations — none held here.
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return { service: createDispatchService(prisma as never, {} as never), orderUpdateMany, historyCreate };
}

const at = (status: string) => ({ id: 'order_1', status, shopId: 's1', customerId: 'c1', batchId: null });

describe('riderAdvance — terminal regression blocked (V1 / V2)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('V1: a delivered order cannot be reverted to out_for_delivery (start-delivery rejected)', async () => {
    const { service, orderUpdateMany, historyCreate } = makeService(at('delivered'));
    await expect(service.startDelivery(RIDER_USER, 'order_1')).rejects.toThrow();
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(historyCreate).not.toHaveBeenCalled();
  });

  it('V2: a delivered order cannot be reverted to picked_up (pickup rejected)', async () => {
    const { service, orderUpdateMany } = makeService(at('delivered'));
    await expect(service.markPickedUp(RIDER_USER, 'order_1')).rejects.toThrow();
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it('BUG-001 re-credit precondition is dead: delivered cannot return to out_for_delivery', async () => {
    // codCollected credits only on out_for_delivery → delivered; since a delivered
    // order can no longer be reverted to out_for_delivery, no second credit is possible.
    const { service, orderUpdateMany } = makeService(at('delivered'));
    await expect(service.startDelivery(RIDER_USER, 'order_1')).rejects.toThrow();
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it('still allows the legal picked_up → out_for_delivery advance', async () => {
    const { service, orderUpdateMany } = makeService(at('picked_up'));
    const res = await service.startDelivery(RIDER_USER, 'order_1');
    expect(res.status).toBe('out_for_delivery');
    expect(orderUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order_1', status: 'picked_up' },
      data:  expect.objectContaining({ status: 'out_for_delivery', outForDeliveryAt: expect.any(Date) }),
    }));
  });

  it('still allows the legal ready_for_pickup → picked_up advance', async () => {
    const { service, orderUpdateMany } = makeService(at('ready_for_pickup'));
    const res = await service.markPickedUp(RIDER_USER, 'order_1');
    expect(res.status).toBe('picked_up');
    expect(orderUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order_1', status: 'ready_for_pickup' },
      data:  expect.objectContaining({ status: 'picked_up', pickedUpAt: expect.any(Date) }),
    }));
  });
});
