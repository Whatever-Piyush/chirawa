import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BusinessRuleError } from '../../../shared/errors/app-errors';

// Mock the cross-module helpers the safety net calls so we can assert behavior
// without a DB or Razorpay. createOrdersService is imported AFTER the mocks.
vi.mock('../../payments/payments.service', () => ({
  refundCapturedOrderPayment: vi.fn(async () => 5000),
  refundOrderLine:            vi.fn(async (_p: unknown, _o: string, amt: number) => amt),
}));
vi.mock('../../catalog/catalog.service', () => ({
  createCatalogService: vi.fn(() => ({ invalidateShopCache: vi.fn(async () => {}) })),
}));
vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderStatusChanged:     vi.fn(),
  emitNewOrderForSeller:      vi.fn(),
  emitOrderCancelledForSeller: vi.fn(),
  emitOrderItemUnavailable:   vi.fn(),
}));

import { createOrdersService } from '../orders.service';
import { refundCapturedOrderPayment, refundOrderLine } from '../../payments/payments.service';
import { emitOrderItemUnavailable } from '../../../shared/events/event-bus';

// One order line. subtotal defaults to 2000 paise (₹20).
const mkLine = (over: Record<string, unknown> = {}) => ({
  id: 'item1', productId: 'prod1', productName: 'Maggi', unitPrice: 2000,
  quantity: 1, subtotal: 2000, fulfillmentStatus: 'fulfilled', refundedPaise: 0, ...over,
});

// Build a mock prisma whose order.findUnique returns the given order. riderId is
// null so the single-line path skips releaseOrderAssignment (tested elsewhere).
function makePrisma(order: Record<string, unknown>, lineClaimCount = 1) {
  const tx = {
    order:              { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })), count: vi.fn(async () => 0) },
    orderItem:          { update: vi.fn(async () => ({})) },
    orderStatusHistory: { create: vi.fn(async () => ({})) },
    deliveryAssignment: { updateMany: vi.fn(async () => ({ count: 1 })) },
    batch:              { update: vi.fn(async () => ({})) },
    promoRedemption:    { create: vi.fn(async () => ({})) },
    promoCode:          { update: vi.fn(async () => ({})) },
    // Inventory Engine (rider-miss belief update + reservation release)
    $queryRaw:          vi.fn(async () => []),
    inventoryState:     { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    inventoryEvent:     { createMany: vi.fn(async () => ({ count: 1 })) },
    product:            { findUnique: vi.fn(async () => ({ stockStatus: 'available' })), update: vi.fn(async () => ({})) },
  };
  const prisma = {
    riderProfile:       { findUnique: vi.fn(async () => ({ id: 'rp1' })) },
    deliveryAssignment: { findFirst: vi.fn(async () => ({ id: 'a1' })) },
    order: {
      findUnique:        vi.fn(async () => order),
      findUniqueOrThrow: vi.fn(async () => order),
      update:            vi.fn(async () => ({})),
    },
    orderItem:          { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: lineClaimCount })) },
    orderStatusHistory: { create: vi.fn(async () => ({})) }, // used by updateOrderStatus
    product: {
      update:    vi.fn(async () => ({})),
      findUnique: vi.fn(async () => ({ masterId: 'm1' })),
      findFirst:  vi.fn(async () => ({ id: 'altProd', name: 'Maggi (Sharma Kirana)', price: 1900 })),
    },
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (t: typeof tx) => Promise<unknown>)(tx)),
  };
  return { prisma, tx };
}

describe('riderReportItemUnavailable (Phase 5 stale-stock safety net)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('multi-line PREPAID: refunds only the line, keeps the order, suggests a sub', async () => {
    const { prisma, tx } = makePrisma({
      id: 'o1', status: 'preparing', shopId: 's1', customerId: 'c1', riderId: null,
      batchId: null, paymentMethod: 'upi', items: [mkLine(), mkLine({ id: 'item2', productId: 'prod2' })],
    });
    const svc = createOrdersService(prisma as never, {} as never);
    const res = await svc.riderReportItemUnavailable('rider1', 'o1', 'item1');

    expect(res.cancelled).toBe(false);
    expect(res.refundedPaise).toBe(2000);
    expect(res.suggestion).toMatchObject({ productId: 'altProd', pricePaise: 1900 });
    // Rider miss is a truth-grade belief event: the product is projected out of
    // stock (via applyInventoryEvent, inside the belief transaction) and the
    // event row is appended.
    expect(tx.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'prod1' }, data: expect.objectContaining({ stockStatus: 'out_of_stock' }),
    }));
    expect(tx.inventoryEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ eventType: 'rider_reported_missing', orderItemId: 'item1' })],
    }));
    expect(refundOrderLine).toHaveBeenCalledWith(prisma, 'o1', 2000, expect.any(String));
    expect(refundCapturedOrderPayment).not.toHaveBeenCalled();
    expect(emitOrderItemUnavailable).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'c1', orderId: 'o1', cancelled: false, refundedPaise: 2000,
    }));
  });

  it('multi-line COD: no Razorpay refund — the line is deducted from cash due', async () => {
    const { prisma } = makePrisma({
      id: 'o1', status: 'confirmed', shopId: 's1', customerId: 'c1', riderId: null,
      batchId: null, paymentMethod: 'cod', items: [mkLine(), mkLine({ id: 'item2', productId: 'prod2' })],
    });
    const svc = createOrdersService(prisma as never, {} as never);
    const res = await svc.riderReportItemUnavailable('rider1', 'o1', 'item1');

    expect(res.cancelled).toBe(false);
    expect(res.refundedPaise).toBe(2000);
    expect(refundOrderLine).not.toHaveBeenCalled();
    // Order total decremented by the line subtotal so the rider collects less.
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('single-line order: cancels the whole order with a full refund — CANCEL BEFORE REFUND (P0-2)', async () => {
    const { prisma, tx } = makePrisma({
      id: 'o1', status: 'confirmed', shopId: 's1', customerId: 'c1', riderId: null,
      batchId: null, paymentMethod: 'upi', totalAmount: 2000,
      payments: [{ status: 'captured', razorpayPaymentId: 'pay_rzp_1' }], items: [mkLine()],
    });
    const svc = createOrdersService(prisma as never, {} as never);
    const res = await svc.riderReportItemUnavailable('rider1', 'o1', 'item1');

    expect(res.cancelled).toBe(true);
    expect(refundCapturedOrderPayment).toHaveBeenCalledWith(prisma, 'o1', expect.any(String));
    expect(emitOrderItemUnavailable).toHaveBeenCalledWith(expect.objectContaining({ cancelled: true }));
    // P0-2: the order is flipped to cancelled BEFORE the external refund runs, so a
    // refund can never leave the single-line order still fulfillable.
    const refundOrder = (refundCapturedOrderPayment as unknown as { mock: { invocationCallOrder: number[] } })
      .mock.invocationCallOrder[0]!;
    expect(tx.order.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(refundOrder);
  });

  it('rejects a line that was already reported (line claim CAS finds 0 rows)', async () => {
    const { prisma } = makePrisma({
      id: 'o1', status: 'preparing', shopId: 's1', customerId: 'c1', riderId: null,
      batchId: null, paymentMethod: 'upi', items: [mkLine({ fulfillmentStatus: 'unavailable_refunded' })],
    }, 0);
    const svc = createOrdersService(prisma as never, {} as never);
    await expect(svc.riderReportItemUnavailable('rider1', 'o1', 'item1')).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('#4 concurrent double-report: the second report loses the line claim (no double refund)', async () => {
    // lineClaimCount=0 simulates the atomic CAS finding the line already claimed by a
    // concurrent report (rider double-tap / retry) — the loser must NOT refund.
    const { prisma } = makePrisma({
      id: 'o1', status: 'preparing', shopId: 's1', customerId: 'c1', riderId: null,
      batchId: null, paymentMethod: 'upi', items: [mkLine(), mkLine({ id: 'item2', productId: 'prod2' })],
    }, 0);
    const svc = createOrdersService(prisma as never, {} as never);
    await expect(svc.riderReportItemUnavailable('rider1', 'o1', 'item1')).rejects.toBeInstanceOf(BusinessRuleError);
    expect(refundOrderLine).not.toHaveBeenCalled();
    expect(refundCapturedOrderPayment).not.toHaveBeenCalled();
  });

  it('rejects once the order has moved past pickup', async () => {
    const { prisma } = makePrisma({
      id: 'o1', status: 'out_for_delivery', shopId: 's1', customerId: 'c1', riderId: null,
      batchId: null, paymentMethod: 'upi', items: [mkLine()],
    });
    const svc = createOrdersService(prisma as never, {} as never);
    await expect(svc.riderReportItemUnavailable('rider1', 'o1', 'item1')).rejects.toBeInstanceOf(BusinessRuleError);
  });
});
