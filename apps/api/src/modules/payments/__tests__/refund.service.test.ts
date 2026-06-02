import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Razorpay layer so the helper never hits the network. The factory is
// hoisted, so mocks are defined inline and then read back via vi.mocked. All
// named imports used by payments.service must be provided or module load fails.
vi.mock('../razorpay.service', () => ({
  createRefund:           vi.fn().mockResolvedValue({ id: 'rfnd_test_1', amount: 28500 }),
  isRazorpayConfigured:   vi.fn(() => true),
  createRazorpayOrder:    vi.fn(),
  verifyPaymentSignature: vi.fn(),
  fetchPaymentsByOrderId: vi.fn(),
}));

import * as razorpay from '../razorpay.service';
import { refundCapturedOrderPayment } from '../payments.service';

const createRefund = vi.mocked(razorpay.createRefund);
const isRazorpayConfigured = vi.mocked(razorpay.isRazorpayConfigured);

type AnyPrisma = Parameters<typeof refundCapturedOrderPayment>[0];

function makePrisma(order: unknown) {
  const payment = { update: vi.fn().mockResolvedValue({}) };
  const transaction = { create: vi.fn().mockResolvedValue({}) };
  return {
    prisma: {
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      payment,
      transaction,
      $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as AnyPrisma,
    payment,
    transaction,
  };
}

const capturedUpiOrder = {
  id: 'order_1', paymentMethod: 'upi', totalAmount: 28500,
  payments: [{ id: 'pay_1', status: 'captured', razorpayPaymentId: 'pay_rzp_1' }],
};

describe('refundCapturedOrderPayment (Chunk 3.5)', () => {
  beforeEach(() => { createRefund.mockClear(); isRazorpayConfigured.mockReturnValue(true); });

  it('refunds a captured prepaid payment and returns the amount', async () => {
    const { prisma, payment, transaction } = makePrisma(capturedUpiOrder);
    const refunded = await refundCapturedOrderPayment(prisma, 'order_1', 'Customer cancelled');
    expect(refunded).toBe(28500);
    expect(createRefund).toHaveBeenCalledWith('pay_rzp_1', 28500, expect.objectContaining({ orderId: 'order_1' }));
    expect(payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'refunded', refundedPaise: 28500 }) }),
    );
    expect(transaction.create).toHaveBeenCalled();
  });

  it('returns null for a COD order (nothing to refund)', async () => {
    const { prisma } = makePrisma({ ...capturedUpiOrder, paymentMethod: 'cod' });
    const refunded = await refundCapturedOrderPayment(prisma, 'order_1', 'x');
    expect(refunded).toBeNull();
    expect(createRefund).not.toHaveBeenCalled();
  });

  it('returns null when there is no captured payment', async () => {
    const { prisma } = makePrisma({ ...capturedUpiOrder, payments: [{ id: 'p', status: 'pending', razorpayPaymentId: null }] });
    const refunded = await refundCapturedOrderPayment(prisma, 'order_1', 'x');
    expect(refunded).toBeNull();
    expect(createRefund).not.toHaveBeenCalled();
  });

  it('still records the refund in dev-mock mode (Razorpay not configured)', async () => {
    isRazorpayConfigured.mockReturnValue(false);
    const { prisma, payment } = makePrisma(capturedUpiOrder);
    const refunded = await refundCapturedOrderPayment(prisma, 'order_1', 'x');
    expect(refunded).toBe(28500);
    expect(createRefund).not.toHaveBeenCalled();           // skipped — no real keys
    expect(payment.update).toHaveBeenCalled();             // but state still updated
  });
});
