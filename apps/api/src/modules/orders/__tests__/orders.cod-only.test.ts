import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 5 COD-only launch: placeOrder must reject non-COD payment methods while
// PAYMENTS_ONLINE_ENABLED is off. The guard is placeOrder's FIRST check, so
// these tests pass empty prisma/redis doubles — nothing else may be touched.

vi.mock('../../../config/features', () => ({
  onlinePaymentsEnabled: vi.fn(() => false),
}));
vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderStatusChanged:      vi.fn(),
  emitNewOrderForSeller:       vi.fn(),
  emitOrderCancelledForSeller: vi.fn(),
  emitOrderItemUnavailable:    vi.fn(),
}));

import { onlinePaymentsEnabled } from '../../../config/features';
import { createOrdersService } from '../orders.service';
import { BusinessRuleError } from '../../../shared/errors/app-errors';
import type { PlaceOrderInput } from '../orders.schema';

const flagMock = vi.mocked(onlinePaymentsEnabled);

function makeService() {
  const redis = { get: vi.fn().mockResolvedValue(null) };
  const service = createOrdersService(
    {} as Parameters<typeof createOrdersService>[0],
    redis as unknown as Parameters<typeof createOrdersService>[1],
  );
  return { service, redis };
}

const input = (paymentMethod: PlaceOrderInput['paymentMethod']): PlaceOrderInput =>
  ({ cartId: 'cart_1', addressId: 'addr_1', paymentMethod }) as PlaceOrderInput;

describe('placeOrder COD-only guard (Phase 5)', () => {
  beforeEach(() => flagMock.mockReturnValue(false));

  it.each(['upi', 'card', 'wallet'] as const)(
    'rejects %s orders while online payments are off',
    async (method) => {
      const { service } = makeService();
      await expect(service.placeOrder('cust_1', input(method)))
        .rejects.toBeInstanceOf(BusinessRuleError);
    },
  );

  it('rejects before touching redis or the database', async () => {
    const { service, redis } = makeService();
    await expect(service.placeOrder('cust_1', input('upi'))).rejects.toThrow();
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('lets COD orders through the guard (fails later only on the empty cart)', async () => {
    const { service } = makeService();
    // Empty redis double ⇒ the next check ("Cart khaali hai") fires — proving
    // the COD path passed the payment-method guard. Skipped outside operating
    // hours is also acceptable; both are NOT the guard's error message.
    await expect(service.placeOrder('cust_1', input('cod')))
      .rejects.not.toThrow('Online payment');
  });

  it('lets non-COD through once the flag is on (fails later on the empty cart, not the guard)', async () => {
    flagMock.mockReturnValue(true);
    const { service } = makeService();
    await expect(service.placeOrder('cust_1', input('upi')))
      .rejects.not.toThrow('Online payment');
  });
});
