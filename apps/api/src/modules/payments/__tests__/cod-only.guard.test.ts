import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 5 COD-only launch: while PAYMENTS_ONLINE_ENABLED is off, creating NEW
// Razorpay payment orders must be refused server-side (the app's "coming soon"
// UI is cosmetic, not a boundary), and a placeholder webhook secret must REJECT
// webhooks in production instead of skipping verification (fail closed).

vi.mock('../../../config/features', () => ({
  onlinePaymentsEnabled: vi.fn(() => false),
}));
vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderStatusChanged: vi.fn(),
  emitNewOrderForSeller:  vi.fn(),
}));

import { onlinePaymentsEnabled } from '../../../config/features';
import { createPaymentsService } from '../payments.service';
import { webhookSecretDecision } from '../razorpay.service';
import { BusinessRuleError } from '../../../shared/errors/app-errors';

const flagMock = vi.mocked(onlinePaymentsEnabled);

// Minimal prisma double: one payable order, so a test that gets PAST the guard
// exercises the normal dev-mock path instead of failing on a missing order.
function makeDb() {
  const order = {
    id: 'order_1', customerId: 'cust_1', status: 'pending_payment', totalAmount: 15000,
  };
  return {
    order: {
      findUnique: vi.fn().mockResolvedValue(order),
      findMany:   vi.fn().mockResolvedValue([order]),
    },
    payment: {
      findFirst: vi.fn().mockResolvedValue(null),
      create:    vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  };
}

describe('COD-only guard on payment-order creation (Phase 5)', () => {
  beforeEach(() => flagMock.mockReturnValue(false));

  it('createPaymentOrder refuses while online payments are off', async () => {
    const service = createPaymentsService(makeDb() as never);
    await expect(service.createPaymentOrder('order_1', 'cust_1'))
      .rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('createCartPaymentOrder refuses while online payments are off', async () => {
    const service = createPaymentsService(makeDb() as never);
    await expect(service.createCartPaymentOrder(['order_1'], 'cust_1'))
      .rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('refuses before touching the database at all', async () => {
    const db = makeDb();
    const service = createPaymentsService(db as never);
    await expect(service.createPaymentOrder('order_1', 'cust_1')).rejects.toThrow();
    expect(db.order.findUnique).not.toHaveBeenCalled();
  });

  it('proceeds normally once the flag is on (dev-mock Razorpay path)', async () => {
    flagMock.mockReturnValue(true);
    const service = createPaymentsService(makeDb() as never);
    const result = await service.createPaymentOrder('order_1', 'cust_1');
    expect(result.razorpayOrderId).toMatch(/^order_DEV_/);
  });
});

describe('webhookSecretDecision — fail closed in production (Phase 5)', () => {
  it('verifies normally with a real secret in any environment', () => {
    expect(webhookSecretDecision('realWebhookSecret123', 'production')).toBe('verify');
    expect(webhookSecretDecision('realWebhookSecret123', 'development')).toBe('verify');
  });

  it('skips only OUTSIDE production when the secret is a placeholder', () => {
    expect(webhookSecretDecision('placeholder', 'development')).toBe('skip-dev');
    expect(webhookSecretDecision('rzp_placeholder_x', 'test')).toBe('skip-dev');
  });

  it('REJECTS in production when the secret is a placeholder (never skips)', () => {
    expect(webhookSecretDecision('placeholder', 'production')).toBe('reject');
    expect(webhookSecretDecision('rzp_placeholder_x', 'production')).toBe('reject');
  });
});
