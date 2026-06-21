import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderStatusChanged:      vi.fn(),
  emitNewOrderForSeller:       vi.fn(),
  emitOrderCancelledForSeller:  vi.fn(),
}));

import * as eventBus from '../../../shared/events/event-bus';
import { createOrdersService } from '../orders.service';

const emitOrderStatusChanged = vi.mocked(eventBus.emitOrderStatusChanged);

// BUG-1: Order.riderId holds the RiderProfile.id; the COD balance lives on
// RiderProfile (keyed by its id). User.id is only the status-history actor.
const RIDER_PROFILE = 'rider_profile_1';
const RIDER_USER    = 'rider_user_1';
// BUG-001: the recorded amount is the order total (server-derived), NOT a client value.
const TOTAL         = 16000;

const codOrder = {
  id: 'order_1', riderId: RIDER_PROFILE, paymentMethod: 'cod',
  shopId: 'shop_1', customerId: 'cust_1', status: 'out_for_delivery',
  totalAmount: TOTAL,
};

// BUG-001: codCollected now uses an interactive `$transaction(async (tx) => …)` with a
// compare-and-set `order.updateMany` (returns { count }). The mock runs the callback with
// the same prisma object (shared spies) and lets each test choose the flip count.
function makeService(order: unknown, flipCount = 1) {
  const orderUpdateMany = vi.fn().mockResolvedValue({ count: flipCount });
  const historyCreate   = vi.fn().mockResolvedValue({});
  const riderUpdate     = vi.fn().mockResolvedValue({});
  const prisma = {
    order: { findUnique: vi.fn().mockResolvedValue(order), updateMany: orderUpdateMany },
    orderStatusHistory: { create: historyCreate },
    riderProfile: { update: riderUpdate },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const redis = {} as unknown as Parameters<typeof createOrdersService>[1];
  return {
    service: createOrdersService(prisma as unknown as Parameters<typeof createOrdersService>[0], redis),
    orderUpdateMany, historyCreate, riderUpdate,
  };
}

describe('codCollected (rider COD path) — BUG-001', () => {
  beforeEach(() => { emitOrderStatusChanged.mockClear(); });

  it('happy path: records the SERVER-DERIVED total, marks delivered, credits balance by RiderProfile.id', async () => {
    const { service, orderUpdateMany, historyCreate, riderUpdate } = makeService(codOrder);
    const result = await service.codCollected('order_1', RIDER_PROFILE, TOTAL, RIDER_USER);

    // D2/D3: compare-and-set flips out_for_delivery → delivered and records the derived total.
    expect(orderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order_1', status: 'out_for_delivery' },
        data:  expect.objectContaining({ status: 'delivered', deliveredAt: expect.any(Date), codCollectedPaise: TOTAL }),
      }),
    );
    // History actor is the User.id.
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ changedById: RIDER_USER }) }),
    );
    // BUG-1 ledger fix preserved: the COD balance is credited by RiderProfile.id.
    expect(riderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RIDER_PROFILE },
        data:  { codBalancePaise: { increment: TOTAL } },
      }),
    );
    expect(emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order_1', status: 'delivered', riderId: RIDER_PROFILE }),
    );
    expect(result.message).toBeTruthy();
  });

  // ── D1: client-supplied amount is never trusted ──────────────────────────────
  it('D1: ignores a mismatched client amount and records the order total instead', async () => {
    const { service, orderUpdateMany, riderUpdate } = makeService(codOrder);
    await service.codCollected('order_1', RIDER_PROFILE, 1, RIDER_USER); // client lies: ₹0.01

    expect(orderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ codCollectedPaise: TOTAL }) }),
    );
    expect(riderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { codBalancePaise: { increment: TOTAL } } }),
    );
  });

  it('D1: with no amount supplied, still records the server-derived total', async () => {
    const { service, orderUpdateMany, riderUpdate } = makeService(codOrder);
    await service.codCollected('order_1', RIDER_PROFILE, undefined, RIDER_USER);

    expect(orderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ codCollectedPaise: TOTAL }) }),
    );
    expect(riderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { codBalancePaise: { increment: TOTAL } } }),
    );
  });

  // ── D2: state-machine enforcement (delivered is legal only from out_for_delivery) ──
  it.each(['confirmed', 'preparing', 'ready_for_pickup', 'picked_up'])(
    'D2: rejects collection from illegal state "%s"',
    async (status) => {
      const { service, orderUpdateMany, riderUpdate } = makeService({ ...codOrder, status });
      await expect(service.codCollected('order_1', RIDER_PROFILE, TOTAL, RIDER_USER)).rejects.toThrow();
      expect(orderUpdateMany).not.toHaveBeenCalled();
      expect(riderUpdate).not.toHaveBeenCalled();
    },
  );

  // ── D3: idempotency / no double-credit ───────────────────────────────────────
  it('D3: a retry on an already-delivered order is idempotent (no second credit)', async () => {
    const { service, orderUpdateMany, riderUpdate } = makeService({ ...codOrder, status: 'delivered' });
    const result = await service.codCollected('order_1', RIDER_PROFILE, TOTAL, RIDER_USER);

    expect(result.message).toBeTruthy();
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(riderUpdate).not.toHaveBeenCalled();
    expect(emitOrderStatusChanged).not.toHaveBeenCalled();
  });

  it('D3: a concurrent flip (compare-and-set matches 0 rows) does not credit again', async () => {
    const { service, historyCreate, riderUpdate } = makeService(codOrder, 0); // updateMany → { count: 0 }
    const result = await service.codCollected('order_1', RIDER_PROFILE, TOTAL, RIDER_USER);

    expect(result.message).toBeTruthy();
    expect(historyCreate).not.toHaveBeenCalled();
    expect(riderUpdate).not.toHaveBeenCalled();
    expect(emitOrderStatusChanged).not.toHaveBeenCalled();
  });

  // ── Existing guards retained ─────────────────────────────────────────────────
  it('BUG-1 regression: rejects when given the rider User.id instead of the RiderProfile.id', async () => {
    const { service, orderUpdateMany, riderUpdate } = makeService(codOrder);
    await expect(service.codCollected('order_1', RIDER_USER, TOTAL, RIDER_USER)).rejects.toThrow();
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(riderUpdate).not.toHaveBeenCalled();
  });

  it('rejects a non-COD order (must use the delivered path)', async () => {
    const { service, orderUpdateMany, riderUpdate } = makeService({ ...codOrder, paymentMethod: 'upi' });
    await expect(service.codCollected('order_1', RIDER_PROFILE, TOTAL, RIDER_USER)).rejects.toThrow();
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(riderUpdate).not.toHaveBeenCalled();
  });

  it('rejects a rider who does not own the delivery', async () => {
    const { service, orderUpdateMany } = makeService({ ...codOrder, riderId: 'other_profile' });
    await expect(service.codCollected('order_1', RIDER_PROFILE, TOTAL, RIDER_USER)).rejects.toThrow();
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects a missing order', async () => {
    const { service } = makeService(null);
    await expect(service.codCollected('nope', RIDER_PROFILE, TOTAL, RIDER_USER)).rejects.toThrow();
  });
});
