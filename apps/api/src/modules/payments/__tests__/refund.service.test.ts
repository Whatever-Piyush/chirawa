import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Razorpay layer so the helper never hits the network.
vi.mock('../razorpay.service', () => ({
  createRefund:           vi.fn().mockResolvedValue({ id: 'rfnd_test_1', amount: 28500 }),
  isRazorpayConfigured:   vi.fn(() => true),
  createRazorpayOrder:    vi.fn(),
  verifyPaymentSignature: vi.fn(),
  fetchPaymentsByOrderId: vi.fn(),
}));

// initiateRefund emits on success; mock the bus so the test never touches Redis.
vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderStatusChanged: vi.fn(),
  emitNewOrderForSeller:  vi.fn(),
}));

import * as razorpay from '../razorpay.service';
import { refundCapturedOrderPayment, createPaymentsService } from '../payments.service';

const createRefund = vi.mocked(razorpay.createRefund);
const isRazorpayConfigured = vi.mocked(razorpay.isRazorpayConfigured);

type AnyPrisma = Parameters<typeof refundCapturedOrderPayment>[0];

// refundCapturedOrderPayment now CLAIMS the payment via a CAS (payment.updateMany
// WHERE status='captured') before the external refund. claimCount lets a test
// simulate losing that race (a concurrent refund already claimed it).
function makePrisma(order: unknown, claimCount = 1) {
  const paymentUpdateMany = vi.fn().mockResolvedValue({ count: claimCount });
  const transactionCreate = vi.fn().mockResolvedValue({});
  return {
    prisma: {
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      payment: { updateMany: paymentUpdateMany },
      transaction: { create: transactionCreate },
    } as unknown as AnyPrisma,
    paymentUpdateMany,
    transactionCreate,
  };
}

const capturedUpiOrder = {
  id: 'order_1', paymentMethod: 'upi', totalAmount: 28500,
  payments: [{ id: 'pay_1', status: 'captured', razorpayPaymentId: 'pay_rzp_1', refundedPaise: 0 }],
};

describe('refundCapturedOrderPayment — claim-before-refund (defect #2)', () => {
  beforeEach(() => {
    createRefund.mockReset();
    createRefund.mockResolvedValue({ id: 'rfnd_test_1', amount: 28500 });
    isRazorpayConfigured.mockReturnValue(true);
  });

  it('claims the payment (CAS captured→refunded), then refunds, and returns the amount', async () => {
    const { prisma, paymentUpdateMany, transactionCreate } = makePrisma(capturedUpiOrder);
    const refunded = await refundCapturedOrderPayment(prisma, 'order_1', 'Customer cancelled');

    expect(refunded).toBe(28500);
    expect(paymentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pay_1', status: 'captured' },
      data:  expect.objectContaining({ status: 'refunded', refundedPaise: 28500 }),
    }));
    expect(createRefund).toHaveBeenCalledWith('pay_rzp_1', 28500, expect.objectContaining({ orderId: 'order_1' }));
    expect(transactionCreate).toHaveBeenCalled();
    // Proof: the claim ran strictly BEFORE the external refund.
    expect(paymentUpdateMany.mock.invocationCallOrder[0]!)
      .toBeLessThan(createRefund.mock.invocationCallOrder[0]!);
  });

  it('#2 duplicate race: a caller that LOSES the claim (count 0) does NOT refund', async () => {
    const { prisma, paymentUpdateMany, transactionCreate } = makePrisma(capturedUpiOrder, 0);
    const refunded = await refundCapturedOrderPayment(prisma, 'order_1', 'x');

    expect(refunded).toBeNull();
    expect(paymentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pay_1', status: 'captured' } }));
    expect(createRefund).not.toHaveBeenCalled();      // no external refund on the loser
    expect(transactionCreate).not.toHaveBeenCalled();
  });

  it('#1 failed createRefund reverts the claim (payment retryable) and rethrows', async () => {
    createRefund.mockRejectedValueOnce(new Error('gateway down'));
    const { prisma, paymentUpdateMany, transactionCreate } = makePrisma(capturedUpiOrder);

    await expect(refundCapturedOrderPayment(prisma, 'order_1', 'x')).rejects.toThrow('gateway down');
    // claim (captured→refunded) then revert (refunded→captured)
    expect(paymentUpdateMany).toHaveBeenCalledTimes(2);
    expect(paymentUpdateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: 'pay_1', status: 'captured' }, data: expect.objectContaining({ status: 'refunded' }),
    }));
    expect(paymentUpdateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: 'pay_1', status: 'refunded' }, data: expect.objectContaining({ status: 'captured', refundedPaise: 0 }),
    }));
    expect(transactionCreate).not.toHaveBeenCalled();  // no ledger when the refund failed
  });

  it('returns null for a COD order (nothing to refund — no claim, no refund)', async () => {
    const { prisma, paymentUpdateMany } = makePrisma({ ...capturedUpiOrder, paymentMethod: 'cod' });
    const refunded = await refundCapturedOrderPayment(prisma, 'order_1', 'x');
    expect(refunded).toBeNull();
    expect(paymentUpdateMany).not.toHaveBeenCalled();
    expect(createRefund).not.toHaveBeenCalled();
  });

  it('returns null when there is no captured payment', async () => {
    const { prisma } = makePrisma({ ...capturedUpiOrder, payments: [{ id: 'p', status: 'pending', razorpayPaymentId: null, refundedPaise: 0 }] });
    const refunded = await refundCapturedOrderPayment(prisma, 'order_1', 'x');
    expect(refunded).toBeNull();
    expect(createRefund).not.toHaveBeenCalled();
  });

  it('still records the refund in dev-mock mode (Razorpay not configured)', async () => {
    isRazorpayConfigured.mockReturnValue(false);
    const { prisma, paymentUpdateMany, transactionCreate } = makePrisma(capturedUpiOrder);
    const refunded = await refundCapturedOrderPayment(prisma, 'order_1', 'x');
    expect(refunded).toBe(28500);
    expect(createRefund).not.toHaveBeenCalled();    // skipped — no real keys
    expect(paymentUpdateMany).toHaveBeenCalled();   // but the claim still records the refund
    expect(transactionCreate).toHaveBeenCalled();
  });
});

// ── initiateRefund (admin) — claim-before-refund + retryable failure (#1/#2/#3) ──
describe('initiateRefund (admin)', () => {
  beforeEach(() => {
    createRefund.mockReset();
    createRefund.mockResolvedValue({ id: 'rfnd_test_1', amount: 28500 });
    isRazorpayConfigured.mockReturnValue(true);
  });

  function makeService(order: unknown, paymentClaimCount = 1, orderFlipCount = 1) {
    const paymentUpdateMany = vi.fn().mockResolvedValue({ count: paymentClaimCount });
    const orderUpdateMany   = vi.fn().mockResolvedValue({ count: orderFlipCount });
    const historyCreate     = vi.fn().mockResolvedValue({});
    const txnCreate         = vi.fn().mockResolvedValue({});
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(order), updateMany: orderUpdateMany },
      payment: { updateMany: paymentUpdateMany },
      orderStatusHistory: { create: historyCreate },
      transaction: { create: txnCreate },
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
    return { service: createPaymentsService(prisma as never), paymentUpdateMany, orderUpdateMany, txnCreate };
  }

  const captured = (status: string) => ({
    id: 'order_1', status, paymentMethod: 'upi', totalAmount: 28500,
    shopId: 's1', riderId: null, customerId: 'c1',
    payments: [{ id: 'pay_1', status: 'captured', razorpayPaymentId: 'pay_rzp_1', refundedPaise: 0 }],
  });

  it('V4: rejects an already-delivered order BEFORE any claim or external refund', async () => {
    const { service, paymentUpdateMany, orderUpdateMany } = makeService(captured('delivered'));
    await expect(service.initiateRefund('order_1', 'admin_1', 'dup')).rejects.toThrow();
    expect(createRefund).not.toHaveBeenCalled();
    expect(paymentUpdateMany).not.toHaveBeenCalled();
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it('#3: a caller that LOSES the payment claim (CAS count 0) does NOT refund', async () => {
    const { service, paymentUpdateMany, orderUpdateMany } = makeService(captured('confirmed'), 0);
    await expect(service.initiateRefund('order_1', 'admin_1', 'dup')).rejects.toThrow();
    expect(paymentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pay_1', status: 'captured' } }));
    expect(createRefund).not.toHaveBeenCalled();
    expect(orderUpdateMany).not.toHaveBeenCalled();   // order not cancelled by the loser
  });

  it('#2 (P0-2): claims the payment AND cancels the order BEFORE createRefund', async () => {
    const { service, paymentUpdateMany, orderUpdateMany } = makeService(captured('confirmed'));
    const res = await service.initiateRefund('order_1', 'admin_1', 'dup');

    expect(paymentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pay_1', status: 'captured' }, data: expect.objectContaining({ status: 'refunded' }),
    }));
    expect(orderUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order_1', status: 'confirmed' },
      data:  expect.objectContaining({ status: 'cancelled', cancelledAt: expect.any(Date), cancelReason: 'dup' }),
    }));
    expect(createRefund).toHaveBeenCalledTimes(1);
    // Revoke-first: BOTH the claim and the cancel precede the external refund, so a
    // crash or failure after the refund can never leave the order fulfillable.
    expect(paymentUpdateMany.mock.invocationCallOrder[0]!)
      .toBeLessThan(createRefund.mock.invocationCallOrder[0]!);
    expect(orderUpdateMany.mock.invocationCallOrder[0]!)
      .toBeLessThan(createRefund.mock.invocationCallOrder[0]!);
    expect(res.message).toBeTruthy();
  });

  it('#1 (P0-2): createRefund fails AFTER the cancel → claim reverted (retryable), order STAYS cancelled', async () => {
    createRefund.mockRejectedValueOnce(new Error('gateway down'));
    const { service, paymentUpdateMany, orderUpdateMany } = makeService(captured('confirmed'));

    await expect(service.initiateRefund('order_1', 'admin_1', 'dup')).rejects.toThrow('gateway down');
    // The order was cancelled BEFORE the refund attempt (revoke-first) and is NOT un-cancelled.
    expect(orderUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order_1', status: 'confirmed' }, data: expect.objectContaining({ status: 'cancelled' }),
    }));
    // claim (captured→refunded) then revert (refunded→captured) so the refund is retryable.
    expect(paymentUpdateMany).toHaveBeenCalledTimes(2);
    expect(paymentUpdateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: 'pay_1', status: 'refunded' }, data: expect.objectContaining({ status: 'captured' }),
    }));
  });

  it('#P0-2 concurrent advance: order moves during the claim+cancel txn → aborts with NO refund', async () => {
    // claim ok (count 1) but the cancel CAS loses (orderFlipCount 0 — order advanced).
    // The whole txn rolls back and we abort BEFORE any external money movement.
    const { service, orderUpdateMany } = makeService(captured('confirmed'), 1, 0);
    await expect(service.initiateRefund('order_1', 'admin_1', 'dup')).rejects.toThrow();
    expect(orderUpdateMany).toHaveBeenCalled();   // the cancel CAS was attempted
    expect(createRefund).not.toHaveBeenCalled();  // ...but no refund was issued
  });
});
