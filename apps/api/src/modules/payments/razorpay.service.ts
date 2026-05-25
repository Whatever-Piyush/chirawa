import crypto from 'crypto';
import Razorpay from 'razorpay';
import { env } from '../../config/env';

let _client: Razorpay | null = null;

function getClient(): Razorpay {
  if (!_client) {
    _client = new Razorpay({
      key_id:     env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    });
  }
  return _client;
}

export function isRazorpayConfigured(): boolean {
  return (
    !env.RAZORPAY_KEY_ID.includes('placeholder') &&
    !env.RAZORPAY_KEY_SECRET.includes('placeholder')
  );
}

export interface RazorpayOrderResult {
  id: string; amount: number; currency: string; receipt: string;
}

export async function createRazorpayOrder(
  amountPaise: number,
  receiptId: string,
): Promise<RazorpayOrderResult> {
  const order = await getClient().orders.create({
    amount:   amountPaise,
    currency: 'INR',
    receipt:  receiptId.slice(0, 40),
  });
  return {
    id:       order.id,
    amount:   order.amount as number,
    currency: order.currency,
    receipt:  order.receipt ?? receiptId,
  };
}

export function verifyPaymentSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string,
): boolean {
  const body     = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex'),
    );
  } catch { return false; }
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  // Skip verification in dev if secret contains 'placeholder'
  if (env.RAZORPAY_WEBHOOK_SECRET.includes('placeholder')) {
    console.warn('⚠️  Webhook signature skipped (dev mode)');
    return true;
  }
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex'),
    );
  } catch { return false; }
}

export interface RefundResult { id: string; amount: number; }

export async function createRefund(
  razorpayPaymentId: string,
  amountPaise: number,
  notes: Record<string, string> = {},
): Promise<RefundResult> {
  const refund = await getClient().payments.refund(razorpayPaymentId, { amount: amountPaise, notes });
  return { id: refund.id, amount: refund.amount as number };
}

export async function fetchPaymentsByOrderId(
  razorpayOrderId: string,
): Promise<Array<{ id: string; status: string; method: string; amount: number }>> {
  const result = await getClient().orders.fetchPayments(razorpayOrderId);
  const items = result.items ?? [];
  return items.map((p: Record<string, unknown>) => ({
    id: String(p['id']), status: String(p['status']),
    method: String(p['method'] ?? 'unknown'), amount: Number(p['amount']),
  }));
}
