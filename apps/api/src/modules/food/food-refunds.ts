import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { createRefund, isRazorpayConfigured } from '../payments/razorpay.service';
import { serviceLogger } from '../../shared/observability/logger';

const log = serviceLogger('food-refunds');

// ─── Durable food refunds (launch hardening P0-4) ─────────────────────────────
// Every cancelled PAID food order must end at refundStatus='processed'. The
// state machine: none → pending → processed | failed; 'failed' rows are retried
// by the food-reconcile sweep until they converge. Before retrying we ASK
// RAZORPAY what refunds already exist for the payment (documented
// GET /payments/:id/refunds) — so a retry can never double-refund and a refund
// that succeeded after a timeout is recognized instead of re-attempted.

export type FoodRefundOutcome = 'processed' | 'failed' | 'skipped';

interface RefundableFoodOrder {
  id: string;
  razorpayPaymentId: string | null;
  totalPaise: number;
}

interface RazorpayRefundItem { id: string; amount: number; status: string }

// Direct REST read (the repo's razorpay-node wrapper doesn't expose refund
// listing; same Basic-auth REST pattern razorpay.service uses for RazorpayX).
async function fetchRefundsForPayment(paymentId: string): Promise<RazorpayRefundItem[]> {
  const auth = 'Basic ' + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refunds`, {
    method: 'GET',
    headers: { Authorization: auth },
  });
  if (!res.ok) throw new Error(`Razorpay refund list ${res.status}`);
  const json = (await res.json()) as { items?: Array<Record<string, unknown>> };
  return (json.items ?? []).map((r) => ({
    id: String(r['id']), amount: Number(r['amount']), status: String(r['status']),
  }));
}

/**
 * Attempt (or re-attempt) the full refund of a paid food order. Idempotent and
 * safe to call from the cancel paths AND the retry sweep:
 *  1. no captured payment → 'skipped' (nothing to refund)
 *  2. check Razorpay for an existing refund first — if the amount is already
 *     covered, just record it as processed (handles timed-out attempts and
 *     cross-instance races without double-refunding)
 *  3. otherwise create the refund; success → processed, error → failed (retried)
 */
export async function beginFoodRefund(
  prisma: PrismaClient,
  order: RefundableFoodOrder,
): Promise<FoodRefundOutcome> {
  if (!order.razorpayPaymentId) return 'skipped';
  if (!isRazorpayConfigured()) {
    log.error({ foodOrderId: order.id }, 'Refund needed but Razorpay is not configured');
    await markRefund(prisma, order.id, 'failed', null);
    return 'failed';
  }

  // Stamp 'pending' so a crash mid-attempt is visible + retried by the sweep.
  await markRefund(prisma, order.id, 'pending', null);

  try {
    // Recognize an already-complete refund before creating a new one.
    const existing = await fetchRefundsForPayment(order.razorpayPaymentId);
    const refundedSoFar = existing.reduce((s, r) => s + r.amount, 0);
    if (refundedSoFar >= order.totalPaise) {
      const first = existing[0];
      await prisma.foodOrder.update({
        where: { id: order.id },
        data:  { refundStatus: 'processed', refundedPaise: order.totalPaise, razorpayRefundId: first?.id ?? null },
      });
      return 'processed';
    }
  } catch (err) {
    // Listing failed — fall through and let createRefund be the arbiter (a full
    // duplicate refund is rejected by Razorpay, so this stays double-spend-safe).
    log.warn({ err, foodOrderId: order.id }, 'Refund pre-check failed; attempting createRefund');
  }

  try {
    const refund = await createRefund(order.razorpayPaymentId, order.totalPaise, { foodOrderId: order.id });
    await prisma.foodOrder.update({
      where: { id: order.id },
      data:  { refundStatus: 'processed', refundedPaise: order.totalPaise, razorpayRefundId: refund.id },
    });
    return 'processed';
  } catch (err) {
    log.error({ err, foodOrderId: order.id }, '💸 Food refund FAILED — will be retried by the reconcile sweep');
    await markRefund(prisma, order.id, 'failed', null);
    return 'failed';
  }
}

async function markRefund(
  prisma: PrismaClient, foodOrderId: string, status: string, refundId: string | null,
): Promise<void> {
  try {
    await prisma.foodOrder.update({
      where: { id: foodOrderId },
      data:  { refundStatus: status, ...(refundId ? { razorpayRefundId: refundId } : {}) },
    });
  } catch {
    /* bookkeeping must never mask the refund outcome */
  }
}
