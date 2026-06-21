import { describe, it, expect, vi, beforeEach } from 'vitest';

// P0-2 regression: a refund must never leave an order fulfillable. cancelOrder and
// sellerRejectOrder now REVOKE FULFILLABILITY FIRST — they flip the order to
// cancelled BEFORE the external Razorpay refund. These tests prove the ordering and
// that the cancelled notification still quotes the refund amount. The refund helper
// is mocked so no DB / gateway is touched.
vi.mock('../../payments/payments.service', () => ({
  refundCapturedOrderPayment: vi.fn(async () => 28500),
  refundOrderLine:            vi.fn(async (_p: unknown, _o: string, amt: number) => amt),
}));
vi.mock('../../catalog/catalog.service', () => ({
  createCatalogService: vi.fn(() => ({ invalidateShopCache: vi.fn(async () => {}) })),
}));
vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderStatusChanged:      vi.fn(),
  emitNewOrderForSeller:       vi.fn(),
  emitOrderCancelledForSeller: vi.fn(),
  emitOrderItemUnavailable:    vi.fn(),
}));

import { createOrdersService } from '../orders.service';
import { refundCapturedOrderPayment } from '../../payments/payments.service';
import { emitOrderStatusChanged } from '../../../shared/events/event-bus';

const refundMock = refundCapturedOrderPayment as unknown as { mock: { invocationCallOrder: number[] } };
const statusEmit = emitOrderStatusChanged as unknown as { mock: { calls: Record<string, unknown>[][] } };

// tx.order.updateMany is the cancel compare-and-set (the revoke-fulfillability write);
// its global invocation order must come BEFORE the mocked external refund.
function makePrisma(order: Record<string, unknown>) {
  const tx = {
    order:              { updateMany: vi.fn(async () => ({ count: 1 })) },
    orderStatusHistory: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    order: {
      findUnique:        vi.fn(async () => order),
      findUniqueOrThrow: vi.fn(async () => order),
      update:            vi.fn(async () => ({})),  // best-effort ETA write
    },
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (t: typeof tx) => Promise<unknown>)(tx)),
  };
  return { prisma, tx };
}

const prepaidOrder = (over: Record<string, unknown> = {}) => ({
  id: 'o1', status: 'confirmed', customerId: 'c1', shopId: 's1', riderId: null, batchId: null,
  paymentMethod: 'upi', totalAmount: 28500,
  payments: [{ status: 'captured', razorpayPaymentId: 'pay_rzp_1' }],
  shop: { seller: { userId: 'seller_user_1' } },
  deliveryLat: null, deliveryLng: null,
  ...over,
});

describe('cancelOrder / sellerRejectOrder — cancel BEFORE refund (P0-2)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('cancelOrder: flips the order to cancelled BEFORE issuing the refund', async () => {
    const { prisma, tx } = makePrisma(prepaidOrder());
    const svc = createOrdersService(prisma as never, {} as never);
    await svc.cancelOrder('o1', 'c1', 'changed mind');

    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'o1', status: 'confirmed' }, data: expect.objectContaining({ status: 'cancelled' }),
    }));
    expect(refundCapturedOrderPayment).toHaveBeenCalledWith(prisma, 'o1', 'changed mind');
    expect(tx.order.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(refundMock.mock.invocationCallOrder[0]!);
  });

  it('cancelOrder: the cancelled notification still quotes the exact refund amount (prepaid)', async () => {
    const { prisma } = makePrisma(prepaidOrder());
    const svc = createOrdersService(prisma as never, {} as never);
    await svc.cancelOrder('o1', 'c1', 'x');

    expect(emitOrderStatusChanged).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled', refundedPaise: 28500,
    }));
  });

  it('cancelOrder COD: cancels with NO refund amount, refund still ordered last', async () => {
    const { prisma, tx } = makePrisma(prepaidOrder({ paymentMethod: 'cod', payments: [] }));
    const svc = createOrdersService(prisma as never, {} as never);
    await svc.cancelOrder('o1', 'c1', 'x');

    expect(emitOrderStatusChanged).toHaveBeenCalledTimes(1);
    const cancelEmit = statusEmit.mock.calls[0]![0] as { status?: string; refundedPaise?: number };
    expect(cancelEmit.status).toBe('cancelled');
    expect(cancelEmit.refundedPaise).toBeUndefined();   // COD: nothing to refund
    expect(tx.order.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(refundMock.mock.invocationCallOrder[0]!);
  });

  it('sellerRejectOrder: cancels (and frees the rider) BEFORE refunding', async () => {
    const { prisma, tx } = makePrisma(prepaidOrder());
    const svc = createOrdersService(prisma as never, {} as never);
    await svc.sellerRejectOrder('o1', 'seller_user_1', 'shop closed');

    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'o1', status: 'confirmed' }, data: expect.objectContaining({ status: 'cancelled' }),
    }));
    expect(refundCapturedOrderPayment).toHaveBeenCalled();
    expect(tx.order.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(refundMock.mock.invocationCallOrder[0]!);
  });
});
