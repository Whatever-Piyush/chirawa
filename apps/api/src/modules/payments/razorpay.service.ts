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

// ── RazorpayX Payouts (seller settlements — 0.3) ──────────────────────────────
// The razorpay-node SDK doesn't wrap the RazorpayX payouts/contacts/fund-account
// endpoints, so we call the REST API directly with Basic auth. A payout actually
// moves money, so callers must treat a thrown error / non-"processed" status as
// "NOT paid" and never write the ledger until status === 'processed'.

const RAZORPAYX_BASE = 'https://api.razorpay.com/v1';

// Payouts only run when the Razorpay keys are real AND a source account number is
// configured. Otherwise the caller leaves the settlement pending (never faked).
export function isPayoutConfigured(): boolean {
  return isRazorpayConfigured() && !env.RAZORPAYX_ACCOUNT_NUMBER.includes('placeholder');
}

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
}

async function razorpayXPost<T>(
  path: string, body: unknown, extraHeaders: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(`${RAZORPAYX_BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader(), ...extraHeaders },
    body:    JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = json['error'] as { description?: string; code?: string } | undefined;
    throw new Error(`RazorpayX ${path} ${res.status}: ${err?.description ?? err?.code ?? res.statusText}`);
  }
  return json as T;
}

export interface SellerFundAccountIds { contactId: string; fundAccountId: string }

// Ensure the seller has a RazorpayX contact + VPA fund account, creating only the
// missing pieces. Returns the ids so the caller can persist them for reuse.
export async function ensureSellerFundAccount(input: {
  contactId: string | null; fundAccountId: string | null;
  sellerProfileId: string; name: string; upiId: string;
}): Promise<SellerFundAccountIds> {
  let contactId = input.contactId;
  if (!contactId) {
    const contact = await razorpayXPost<{ id: string }>('/contacts', {
      name: input.name.slice(0, 50), type: 'vendor', reference_id: input.sellerProfileId,
    });
    contactId = contact.id;
  }

  let fundAccountId = input.fundAccountId;
  if (!fundAccountId) {
    const fa = await razorpayXPost<{ id: string }>('/fund_accounts', {
      contact_id: contactId, account_type: 'vpa', vpa: { address: input.upiId },
    });
    fundAccountId = fa.id;
  }

  return { contactId, fundAccountId };
}

export interface PayoutResult { payoutId: string; status: string; utr: string | null }

// Create a UPI payout. `idempotencyKey` (the settlement id) makes retries safe:
// RazorpayX returns the original payout instead of creating a duplicate.
export async function createPayout(input: {
  fundAccountId: string; amountPaise: number; referenceId: string;
  narration: string; idempotencyKey: string;
}): Promise<PayoutResult> {
  const payout = await razorpayXPost<{ id: string; status: string; utr: string | null }>(
    '/payouts',
    {
      account_number:       env.RAZORPAYX_ACCOUNT_NUMBER,
      fund_account_id:      input.fundAccountId,
      amount:               input.amountPaise,
      currency:             'INR',
      mode:                 'UPI',
      purpose:              'payout',
      queue_if_low_balance: true,
      reference_id:         input.referenceId,
      narration:            input.narration.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30) || 'Bringly payout',
    },
    { 'X-Payout-Idempotency': input.idempotencyKey },
  );
  return { payoutId: payout.id, status: payout.status, utr: payout.utr ?? null };
}
