import { describe, it, expect, vi, beforeEach } from 'vitest';

// updateOrderStatus recomputes ETA + emits after the transaction; mock both so the
// unit test is isolated from Redis pub/sub and the ETA DB reads.
vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderStatusChanged:      vi.fn(),
  emitNewOrderForSeller:       vi.fn(),
  emitOrderCancelledForSeller: vi.fn(),
  emitOrderItemUnavailable:    vi.fn(),
}));
vi.mock('../eta.service', () => ({
  computeAndPersistEta: vi.fn().mockResolvedValue(undefined),
  etaResponse:          vi.fn(),
}));

import * as eventBus from '../../../shared/events/event-bus';
import { createOrdersService } from '../orders.service';

const emitOrderStatusChanged = vi.mocked(eventBus.emitOrderStatusChanged);

// updateOrderStatus now routes through the CAS primitive: callback-form $transaction
// + compare-and-set order.updateMany (returns { count }). flipCount=0 simulates a
// concurrent transition having already moved the row.
function makeService(order: unknown, flipCount = 1) {
  const orderUpdateMany = vi.fn().mockResolvedValue({ count: flipCount });
  const historyCreate   = vi.fn().mockResolvedValue({});
  const prisma = {
    order: { findUniqueOrThrow: vi.fn().mockResolvedValue(order), updateMany: orderUpdateMany },
    orderStatusHistory: { create: historyCreate },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return { service: createOrdersService(prisma as never, {} as never), orderUpdateMany, historyCreate };
}

const order = (status: string) => ({ id: 'o1', status, shopId: 's1', riderId: null, customerId: 'c1' });

describe('updateOrderStatus — CAS-protected (defect #1)', () => {
  beforeEach(() => { emitOrderStatusChanged.mockClear(); });

  it('writes via a compare-and-set on the current status (WHERE status = from)', async () => {
    const { service, orderUpdateMany, historyCreate } = makeService(order('confirmed'));
    await service.updateOrderStatus('o1', 'preparing', 'seller', 'seller_1');

    expect(orderUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'o1', status: 'confirmed' },
      data:  expect.objectContaining({ status: 'preparing', preparingAt: expect.any(Date) }),
    }));
    expect(historyCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ orderId: 'o1', status: 'preparing', changedById: 'seller_1' }),
    }));
    expect(emitOrderStatusChanged).toHaveBeenCalledTimes(1);
  });

  it('throws and does NOT emit when the CAS loses the race (count 0)', async () => {
    const { service, orderUpdateMany } = makeService(order('confirmed'), 0);
    await expect(service.updateOrderStatus('o1', 'preparing', 'seller', 'seller_1')).rejects.toThrow();
    expect(orderUpdateMany).toHaveBeenCalled();          // the CAS was attempted …
    expect(emitOrderStatusChanged).not.toHaveBeenCalled(); // … but nothing was broadcast
  });

  it('rejects an illegal transition before any write (delivered → preparing)', async () => {
    const { service, orderUpdateMany } = makeService(order('delivered'));
    await expect(service.updateOrderStatus('o1', 'preparing', 'admin', 'a1')).rejects.toThrow();
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(emitOrderStatusChanged).not.toHaveBeenCalled();
  });

  it('carries cancelReason on a cancel transition', async () => {
    const { service, orderUpdateMany } = makeService(order('confirmed'));
    await service.updateOrderStatus('o1', 'cancelled', 'customer', 'c1', 'changed my mind');
    expect(orderUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'o1', status: 'confirmed' },
      data:  expect.objectContaining({ status: 'cancelled', cancelledAt: expect.any(Date), cancelReason: 'changed my mind' }),
    }));
  });
});
