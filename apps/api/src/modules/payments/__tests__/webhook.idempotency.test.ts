import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPaymentsService } from '../payments.service';

// payment.failed event — its handler only touches prisma.payment.updateMany, so
// we can exercise the process-then-record ordering without the captured path's
// internal markOrderPaid.
const failedEvent = (id = 'evt_1') => JSON.stringify({
  id, event: 'payment.failed',
  payload: { payment: { entity: { id: 'pay_1', order_id: 'rzp_1', method: 'upi', amount: 5000, status: 'failed', error_description: 'declined' } } },
});

function makePrisma(opts: { seen?: boolean; updateThrows?: boolean } = {}) {
  const webhookFindUnique = vi.fn().mockResolvedValue(opts.seen ? { id: 'x', eventId: 'evt_1' } : null);
  const webhookCreate     = vi.fn().mockResolvedValue({});
  const paymentUpdateMany = vi.fn(opts.updateThrows
    ? () => Promise.reject(new Error('db blip'))
    : () => Promise.resolve({ count: 1 }));
  const prisma = {
    paymentWebhookEvent: { findUnique: webhookFindUnique, create: webhookCreate },
    payment: { updateMany: paymentUpdateMany },
  };
  return { prisma, webhookFindUnique, webhookCreate, paymentUpdateMany };
}

const svc = (p: ReturnType<typeof makePrisma>) => createPaymentsService(p.prisma as never);

describe('processWebhook — process-then-record idempotency (Phase 1.8)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('processes a new event then records it (in that order)', async () => {
    const p = makePrisma();
    const result = await svc(p).processWebhook(failedEvent(), 'sig');

    // Guard: payment.failed only touches PENDING rows — never overwrites a captured payment.
    expect(p.paymentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { razorpayOrderId: 'rzp_1', status: 'pending' }, data: expect.objectContaining({ status: 'failed' }),
    }));
    expect(p.webhookCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventId: 'evt_1' }) }));
    expect(result).toEqual({ processed: true, eventType: 'payment.failed' });
  });

  it('skips an already-recorded event without processing or recording again', async () => {
    const p = makePrisma({ seen: true });
    const result = await svc(p).processWebhook(failedEvent(), 'sig');

    expect(p.paymentUpdateMany).not.toHaveBeenCalled();
    expect(p.webhookCreate).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: false, eventType: 'payment.failed' });
  });

  it('does NOT record the event when processing fails (so Razorpay can retry)', async () => {
    const p = makePrisma({ updateThrows: true });
    await expect(svc(p).processWebhook(failedEvent(), 'sig')).rejects.toThrow('db blip');
    expect(p.webhookCreate).not.toHaveBeenCalled(); // the key 1.8 fix
  });
});
