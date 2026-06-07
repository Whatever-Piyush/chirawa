import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocked at the module level so both static and dynamic imports resolve to these.
vi.mock('../../../modules/payments/razorpay.service', () => ({
  isRazorpayConfigured:   vi.fn(() => true),
  fetchPaymentsByOrderId: vi.fn(),
}));
vi.mock('../../../modules/payments/payments.service', () => ({
  markOrderPaid: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../modules/notifications/fcm.service', () => ({
  sendPush: vi.fn().mockResolvedValue(undefined),
}));

import * as razorpay from '../../../modules/payments/razorpay.service';
import * as payments from '../../../modules/payments/payments.service';
import { sendPush } from '../../../modules/notifications/fcm.service';
import { autoAcceptJobId, JobNames } from '../../queues';
import { runPaymentReconciliation } from '../reconciliation.job';

const isRazorpayConfigured   = vi.mocked(razorpay.isRazorpayConfigured);
const fetchPaymentsByOrderId = vi.mocked(razorpay.fetchPaymentsByOrderId);
const markOrderPaid          = vi.mocked(payments.markOrderPaid);
const sendPushMock           = vi.mocked(sendPush);

const ORDER_ID  = 'order_1';
const SELLER_ID = 'seller_user_1';

const staleOrder = { id: ORDER_ID, payments: [{ id: 'pay_db_1', razorpayOrderId: 'rzp_order_1' }] };

function makeDeps(opts: { stale?: unknown[]; token?: string | null } = {}) {
  const queueAdd = vi.fn().mockResolvedValue({});
  const notificationCreate = vi.fn().mockResolvedValue({});
  const prisma = {
    order: {
      findMany:   vi.fn().mockResolvedValue(opts.stale ?? [staleOrder]),
      findUnique: vi.fn().mockResolvedValue({
        totalAmount: 50000, shop: { seller: { userId: SELLER_ID } },
      }),
    },
    notification: { create: notificationCreate },
  };
  const redis = { get: vi.fn().mockResolvedValue(opts.token === undefined ? 'seller_fcm_token' : opts.token) };
  const queue = { add: queueAdd };
  return { prisma, redis, queue, queueAdd, notificationCreate };
}

const run = (d: ReturnType<typeof makeDeps>) =>
  runPaymentReconciliation(d.prisma as never, d.redis as never, d.queue as never);

describe('runPaymentReconciliation (0.4 — worker progresses reconciled orders directly)', () => {
  beforeEach(() => {
    isRazorpayConfigured.mockReturnValue(true);
    fetchPaymentsByOrderId.mockReset();
    markOrderPaid.mockClear();
    sendPushMock.mockClear();
  });

  it('on a captured payment: marks paid, enqueues auto-accept (stable jobId), and FCMs the seller', async () => {
    fetchPaymentsByOrderId.mockResolvedValue([{ id: 'pay_rzp_1', status: 'captured', method: 'upi', amount: 50000 }]);
    const d = makeDeps();

    await run(d);

    expect(markOrderPaid).toHaveBeenCalledWith(d.prisma, ORDER_ID, 'pay_rzp_1', 'upi');
    expect(d.queueAdd).toHaveBeenCalledWith(
      JobNames.AUTO_ACCEPT,
      { orderId: ORDER_ID },
      expect.objectContaining({ jobId: autoAcceptJobId(ORDER_ID), delay: expect.any(Number) }),
    );
    expect(sendPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'seller_fcm_token', channel: 'chirawa_alerts', data: { orderId: ORDER_ID, screen: 'OrderQueue' } }),
    );
    expect(d.notificationCreate).toHaveBeenCalled();
  });

  it('still enqueues auto-accept even when the seller has no FCM token (order must progress)', async () => {
    fetchPaymentsByOrderId.mockResolvedValue([{ id: 'pay_rzp_1', status: 'captured', method: 'upi', amount: 50000 }]);
    const d = makeDeps({ token: null });

    await run(d);

    expect(markOrderPaid).toHaveBeenCalled();
    expect(d.queueAdd).toHaveBeenCalledWith(JobNames.AUTO_ACCEPT, { orderId: ORDER_ID }, expect.objectContaining({ jobId: autoAcceptJobId(ORDER_ID) }));
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it('does nothing for an order with no captured payment', async () => {
    fetchPaymentsByOrderId.mockResolvedValue([{ id: 'p', status: 'authorized', method: 'upi', amount: 50000 }]);
    const d = makeDeps();

    await run(d);

    expect(markOrderPaid).not.toHaveBeenCalled();
    expect(d.queueAdd).not.toHaveBeenCalled();
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it('skips when Razorpay is not configured (dev)', async () => {
    isRazorpayConfigured.mockReturnValue(false);
    const d = makeDeps();

    await run(d);

    expect(fetchPaymentsByOrderId).not.toHaveBeenCalled();
    expect(markOrderPaid).not.toHaveBeenCalled();
    expect(d.queueAdd).not.toHaveBeenCalled();
  });

  it('returns early when there are no stale orders', async () => {
    const d = makeDeps({ stale: [] });

    await run(d);

    expect(markOrderPaid).not.toHaveBeenCalled();
    expect(d.queueAdd).not.toHaveBeenCalled();
  });
});
