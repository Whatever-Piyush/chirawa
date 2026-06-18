import { describe, it, expect, vi, beforeEach } from 'vitest';

// P2 (review #10): the ETA must be persisted/emitted BEFORE the status event, so the
// out_for_delivery push reads the fresh ETA. Mock both so we can assert the call order.
vi.mock('../../orders/eta.service', () => ({
  computeAndPersistEta: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderAssignedToRider: vi.fn(),
  emitOrderStatusChanged:   vi.fn(),
}));

import { createDispatchService } from '../dispatch.service';
import * as eta from '../../orders/eta.service';
import * as bus from '../../../shared/events/event-bus';

const computeAndPersistEta = vi.mocked(eta.computeAndPersistEta);
const emitOrderStatusChanged = vi.mocked(bus.emitOrderStatusChanged);

function makePrisma() {
  return {
    riderProfile:       { findUnique: vi.fn().mockResolvedValue({ id: 'rp1' }) },
    deliveryAssignment: { findFirst:  vi.fn().mockResolvedValue({ id: 'a1', isActive: true }) },
    order: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'o1', batchId: null, shopId: 's1', customerId: 'c1', status: 'picked_up',
      }),
      update: vi.fn().mockResolvedValue({}),
      count:  vi.fn().mockResolvedValue(0),
    },
    orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as Parameters<typeof createDispatchService>[0];
}

describe('riderAdvance — ETA persisted before status event (P2 #10)', () => {
  beforeEach(() => { computeAndPersistEta.mockClear(); emitOrderStatusChanged.mockClear(); });

  it('calls computeAndPersistEta BEFORE emitOrderStatusChanged on out_for_delivery', async () => {
    const svc = createDispatchService(makePrisma(), {} as never);
    await svc.startDelivery('u1', 'o1');

    expect(computeAndPersistEta).toHaveBeenCalledWith(expect.anything(), 'o1');
    expect(emitOrderStatusChanged).toHaveBeenCalledTimes(1);
    // The fix: ETA persist/emit must precede the status broadcast.
    expect(computeAndPersistEta.mock.invocationCallOrder[0]!)
      .toBeLessThan(emitOrderStatusChanged.mock.invocationCallOrder[0]!);
  });
});
