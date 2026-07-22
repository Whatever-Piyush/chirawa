import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BusinessRuleError } from '../../../shared/errors/app-errors';

// Accept-screen chips (Inventory Engine S2): lineOverrides on seller accept.
// Cross-module helpers mocked; createOrdersService imported AFTER the mocks.
vi.mock('../../payments/payments.service', () => ({
  refundCapturedOrderPayment: vi.fn(async () => 5000),
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
vi.mock('../eta.service', () => ({
  computeAndPersistEta: vi.fn(async () => undefined),
  etaResponse:          vi.fn(),
}));

import { createOrdersService } from '../orders.service';
import { refundOrderLine } from '../../payments/payments.service';
import { emitOrderItemUnavailable } from '../../../shared/events/event-bus';

const SELLER = 'seller_user_1';

const mkLine = (id: string, over: Record<string, unknown> = {}) => ({
  id, productId: `prod-${id}`, productName: `Item ${id}`, unitPrice: 2000,
  quantity: 5, subtotal: 10000, fulfillmentStatus: 'fulfilled', refundedPaise: 0,
  verificationFlag: 'accept_verify_requested', ...over,
});

function makePrisma(items: Array<Record<string, unknown>>) {
  const order = {
    id: 'o1', status: 'confirmed', shopId: 's1', customerId: 'c1',
    paymentMethod: 'upi', totalAmount: 20000, riderId: null, batchId: null,
    shop: { seller: { userId: SELLER } },
    items,
  };
  const tx = {
    order:              { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    orderItem:          { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    orderStatusHistory: { create: vi.fn(async () => ({})) },
    $queryRaw:          vi.fn(async () => [{ productId: 'prod-item1', freed: 3 }]),
    $executeRaw:        vi.fn(async () => 1),
    inventoryState:     { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    inventoryEvent:     { createMany: vi.fn(async () => ({ count: 1 })) },
    product:            { findUnique: vi.fn(async () => ({ stockStatus: 'available' })), update: vi.fn(async () => ({})) },
  };
  const prisma = {
    order: {
      findUnique:        vi.fn(async () => order),
      findUniqueOrThrow: vi.fn(async () => order),
      update:            vi.fn(async () => ({})),
    },
    orderItem: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    orderStatusHistory: { create: vi.fn(async () => ({})) },
    product: {
      findUnique: vi.fn(async () => ({ masterId: null })), // no substitute path
      findFirst:  vi.fn(async () => null),
      update:     vi.fn(async () => ({})),
    },
    appConfig: { findMany: vi.fn(async () => []) },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg as Promise<unknown>[]) : (arg as (t: typeof tx) => Promise<unknown>)(tx)),
  };
  return { prisma, tx };
}

const svc = (p: { prisma: unknown }) => createOrdersService(p.prisma as never, {} as never);

describe('sellerAcceptOrder — accept-screen chips (lineOverrides)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('plain accept implicitly confirms every flagged line (no chips touched)', async () => {
    const { prisma } = makePrisma([mkLine('item1'), mkLine('item2')]);
    const res = await svc({ prisma }).sellerAcceptOrder('o1', SELLER);
    expect(res.message).toMatch(/accept/i);
    expect(prisma.orderItem.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', verificationFlag: 'accept_verify_requested' },
      data:  { verificationFlag: 'accept_confirmed' },
    });
  });

  it('"है" (availableQty ≥ ordered) just confirms the line', async () => {
    const { prisma } = makePrisma([mkLine('item1'), mkLine('item2')]);
    await svc({ prisma }).sellerAcceptOrder('o1', SELLER, [{ orderItemId: 'item1', availableQty: 9 }]);
    expect(prisma.orderItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'item1' }, data: { verificationFlag: 'accept_confirmed' },
    }));
    expect(refundOrderLine).not.toHaveBeenCalled();
  });

  it('"सिर्फ 2" shrinks the line: reservation, qty, money, and belief move together', async () => {
    const { prisma, tx } = makePrisma([mkLine('item1'), mkLine('item2')]);
    await svc({ prisma }).sellerAcceptOrder('o1', SELLER, [{ orderItemId: 'item1', availableQty: 2 }]);

    // Residual 3 × ₹20 = 6000 paise refunded through the line-refund rail.
    expect(refundOrderLine).toHaveBeenCalledWith(prisma, 'o1', 6000, expect.any(String));
    // Line rewritten to the confirmed quantity.
    expect(tx.orderItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'item1' },
      data: expect.objectContaining({
        quantity: 2, subtotal: 4000, refundedPaise: { increment: 6000 },
        verificationFlag: 'accept_confirmed',
      }),
    }));
    // Order totals shrink by the residual.
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { cartSubtotalAtPricing: { decrement: 6000 }, totalAmount: { decrement: 6000 } },
    }));
    // Belief: the seller just looked — seller_count(2) resets the drift clock.
    expect(tx.inventoryEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ eventType: 'seller_count', qtyAfter: 2, orderItemId: 'item1' })],
    }));
    expect(emitOrderItemUnavailable).toHaveBeenCalledWith(expect.objectContaining({
      cancelled: false, refundedPaise: 6000,
    }));
  });

  it('"नहीं" refunds the whole line and records a trusted zero', async () => {
    const { prisma, tx } = makePrisma([mkLine('item1'), mkLine('item2')]);
    await svc({ prisma }).sellerAcceptOrder('o1', SELLER, [{ orderItemId: 'item1', availableQty: 0 }]);

    // Line claimed exactly once (CAS) with the full subtotal recorded.
    expect(prisma.orderItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'item1', fulfillmentStatus: 'fulfilled' },
      data:  expect.objectContaining({ fulfillmentStatus: 'unavailable_refunded', refundedPaise: 10000 }),
    }));
    expect(refundOrderLine).toHaveBeenCalledWith(prisma, 'o1', 10000, expect.any(String));
    // seller_toggle_out: trust the seller's zero fully.
    expect(tx.inventoryEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ eventType: 'seller_toggle_out', orderItemId: 'item1' })],
    }));
  });

  it('refuses to zero out EVERY line — that is a rejection, not an accept', async () => {
    const { prisma } = makePrisma([mkLine('item1'), mkLine('item2')]);
    await expect(svc({ prisma }).sellerAcceptOrder('o1', SELLER, [
      { orderItemId: 'item1', availableQty: 0 },
      { orderItemId: 'item2', availableQty: 0 },
    ])).rejects.toBeInstanceOf(BusinessRuleError);
    expect(refundOrderLine).not.toHaveBeenCalled();
  });

  it('COD cap: no external refund — totals shrink so the rider collects less', async () => {
    const { prisma, tx } = makePrisma([mkLine('item1'), mkLine('item2')]);
    (prisma.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'o1', status: 'confirmed', shopId: 's1', customerId: 'c1',
      paymentMethod: 'cod', totalAmount: 20000, riderId: null, batchId: null,
      shop: { seller: { userId: SELLER } },
      items: [mkLine('item1'), mkLine('item2')],
    });
    await svc({ prisma }).sellerAcceptOrder('o1', SELLER, [{ orderItemId: 'item1', availableQty: 2 }]);
    expect(refundOrderLine).not.toHaveBeenCalled();
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { cartSubtotalAtPricing: { decrement: 6000 }, totalAmount: { decrement: 6000 } },
    }));
  });
});
