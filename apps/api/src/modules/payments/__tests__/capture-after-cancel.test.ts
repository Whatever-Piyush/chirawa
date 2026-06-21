import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Razorpay layer + event bus so the webhook path never hits the network.
vi.mock('../razorpay.service', () => ({
  createRefund:           vi.fn().mockResolvedValue({ id: 'rfnd_1', amount: 28500 }),
  isRazorpayConfigured:   vi.fn(() => true),
  createRazorpayOrder:    vi.fn(),
  verifyPaymentSignature: vi.fn(),
  fetchPaymentsByOrderId: vi.fn(),
}));
vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderStatusChanged: vi.fn(),
  emitNewOrderForSeller:  vi.fn(),
}));

import * as razorpay from '../razorpay.service';
import { createPaymentsService } from '../payments.service';

const createRefund = vi.mocked(razorpay.createRefund);
const isRazorpayConfigured = vi.mocked(razorpay.isRazorpayConfigured);

// A payment.captured webhook for an order whose status we control.
const capturedEvent = (id = 'evt_cap_1') => JSON.stringify({
  id, event: 'payment.captured',
  payload: { payment: { entity: { id: 'pay_rzp_1', order_id: 'rzp_order_1', method: 'upi', amount: 28500, status: 'captured' } } },
});

// orderStatus is returned for BOTH the settle-loop status read and the
// refundCancelledCapture totalAmount read. claimCount simulates the pending-payment
// CAS (1 = this call claims it; 0 = a retry/concurrent settle already did).
// The cancelled-order branch (refundCancelledCapture) only touches these — no
// $transaction / markOrderPaid path is reached when the order is cancelled.
function makePrisma(orderStatus: string, claimCount = 1) {
  const paymentUpdateMany = vi.fn().mockResolvedValue({ count: claimCount });
  const transactionCreate = vi.fn().mockResolvedValue({});
  const prisma = {
    paymentWebhookEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    payment: { findMany: vi.fn().mockResolvedValue([{ orderId: 'order_1' }]), updateMany: paymentUpdateMany },
    order:   { findUnique: vi.fn().mockResolvedValue({ status: orderStatus, totalAmount: 28500 }) },
    transaction: { create: transactionCreate },
  };
  return { prisma, paymentUpdateMany, transactionCreate };
}

describe('capture-after-cancel — refund a payment captured on a cancelled order', () => {
  beforeEach(() => {
    createRefund.mockReset();
    createRefund.mockResolvedValue({ id: 'rfnd_1', amount: 28500 });
    isRazorpayConfigured.mockReturnValue(true);
  });

  it('claims the pending payment (pending→refunded), then refunds it, on a cancelled order', async () => {
    const { prisma, paymentUpdateMany, transactionCreate } = makePrisma('cancelled');
    const svc = createPaymentsService(prisma as never);
    await svc.processWebhook(capturedEvent(), 'sig');

    expect(paymentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderId: 'order_1', status: 'pending' },
      data:  expect.objectContaining({ status: 'refunded', razorpayPaymentId: 'pay_rzp_1', refundedPaise: 28500 }),
    }));
    expect(createRefund).toHaveBeenCalledWith('pay_rzp_1', 28500, expect.objectContaining({ orderId: 'order_1' }));
    expect(transactionCreate).toHaveBeenCalled();
    // Claim ran strictly BEFORE the external refund.
    expect(paymentUpdateMany.mock.invocationCallOrder[0]!)
      .toBeLessThan(createRefund.mock.invocationCallOrder[0]!);
  });

  it('is idempotent: a retry where the pending row is already claimed (count 0) does NOT double-refund', async () => {
    const { prisma, transactionCreate } = makePrisma('cancelled', 0);
    const svc = createPaymentsService(prisma as never);
    await svc.processWebhook(capturedEvent(), 'sig');

    expect(createRefund).not.toHaveBeenCalled();
    expect(transactionCreate).not.toHaveBeenCalled();
  });

  it('reverts the claim (payment retryable) when the external refund fails', async () => {
    createRefund.mockRejectedValueOnce(new Error('gateway down'));
    const { prisma, paymentUpdateMany, transactionCreate } = makePrisma('cancelled');
    const svc = createPaymentsService(prisma as never);

    await expect(svc.processWebhook(capturedEvent(), 'sig')).rejects.toThrow('gateway down');
    // claim (pending→refunded) then revert (refunded→pending)
    expect(paymentUpdateMany).toHaveBeenCalledTimes(2);
    expect(paymentUpdateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { orderId: 'order_1', status: 'refunded' },
      data:  expect.objectContaining({ status: 'pending', refundedPaise: 0 }),
    }));
    expect(transactionCreate).not.toHaveBeenCalled();
  });
});
