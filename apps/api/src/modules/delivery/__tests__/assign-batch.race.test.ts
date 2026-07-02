import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderAssignedToRider: vi.fn(),
  emitOrderStatusChanged:   vi.fn(),
}));

import * as eventBus from '../../../shared/events/event-bus';
import { createBatchingService } from '../batching.service';

const emitAssigned = vi.mocked(eventBus.emitOrderAssignedToRider);

// P1-12 regression tests: assignBatch's open-check used to be read-then-act —
// with worker concurrency 3 plus the manual admin trigger, two assigners could
// both see status='open' and dispatch TWO riders to the same orders. The claim
// is now a conditional updateMany (status='open' CAS) INSIDE the transaction,
// ordered before any write.

const ORDERS = [
  { id: 'o1', shopId: 'shop1', totalAmount: 10000, paymentMethod: 'cod', deliveryLocality: 'Ward 3' },
  { id: 'o2', shopId: 'shop1', totalAmount: 5000,  paymentMethod: 'cod', deliveryLocality: 'Ward 3' },
];

// casResults: queued {count} outcomes for the batch-claim updateMany calls.
function makePrisma(opts: { orders?: typeof ORDERS; status?: string; casResults?: number[] }) {
  const cas = [...(opts.casResults ?? [1])];
  const batchUpdateMany      = vi.fn().mockImplementation(() => Promise.resolve({ count: cas.shift() ?? 0 }));
  const assignmentCreateMany = vi.fn().mockResolvedValue({ count: opts.orders?.length ?? 0 });
  const orderUpdateMany      = vi.fn().mockResolvedValue({ count: opts.orders?.length ?? 0 });
  const prisma = {
    batch: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'batch1', status: opts.status ?? 'open',
        anchorLat: 28.1, anchorLng: 75.4,
        orders: opts.orders ?? ORDERS,
      }),
      updateMany: batchUpdateMany,
    },
    deliveryZone:       { findMany: vi.fn().mockResolvedValue([]) },
    riderAvailability:  { findMany: vi.fn().mockResolvedValue([{ riderId: 'rider_profile_1' }]) },
    riderZone:          { findMany: vi.fn().mockResolvedValue([]) },
    riderProfile:       { findMany: vi.fn().mockResolvedValue([{ id: 'rider_profile_1', userId: 'rider_user_1' }]) },
    deliveryAssignment: { groupBy: vi.fn().mockResolvedValue([]), createMany: assignmentCreateMany },
    order:              { updateMany: orderUpdateMany },
    shop:               { findUnique: vi.fn().mockResolvedValue({ name: 'Dukaan X' }) },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({
      batch:              { updateMany: batchUpdateMany },
      deliveryAssignment: { createMany: assignmentCreateMany },
      order:              { updateMany: orderUpdateMany },
    }),
  };
  return { prisma, batchUpdateMany, assignmentCreateMany, orderUpdateMany };
}

const redis = {} as never;

describe('assignBatch — atomic open→assigned claim (P1-12)', () => {
  it('assigns when the CAS wins: claim is conditional on status=open and runs before any write', async () => {
    const p = makePrisma({ casResults: [1] });
    const svc = createBatchingService(p.prisma as never, redis);

    const result = await svc.assignBatch('batch1');

    expect(result).toMatchObject({ assigned: true, riderId: 'rider_profile_1', orderCount: 2 });
    expect(p.batchUpdateMany).toHaveBeenCalledWith({
      where: { id: 'batch1', status: 'open' }, // the claim MUST be conditional
      data:  { status: 'assigned', riderId: 'rider_profile_1' },
    });
    expect(p.assignmentCreateMany).toHaveBeenCalledWith({
      data: ORDERS.map((o) => ({ orderId: o.id, riderId: 'rider_profile_1', isActive: true })),
    });
    expect(emitAssigned).toHaveBeenCalledWith(expect.objectContaining({ riderUserId: 'rider_user_1' }));
  });

  it('a LOST claim writes nothing and reports already_handled (the P1-12 race)', async () => {
    // findUnique saw 'open' (stale read) but another assigner claimed first.
    const p = makePrisma({ casResults: [0] });
    const svc = createBatchingService(p.prisma as never, redis);
    emitAssigned.mockClear();

    const result = await svc.assignBatch('batch1');

    expect(result).toEqual({ assigned: false, reason: 'already_handled' });
    expect(p.assignmentCreateMany).not.toHaveBeenCalled(); // no second rider's assignments
    expect(p.orderUpdateMany).not.toHaveBeenCalled();      // no rider overwrite on the orders
    expect(emitAssigned).not.toHaveBeenCalled();           // no second rider dispatched
  });

  it('two concurrent assigners → exactly one set of assignments and one rider push', async () => {
    const p = makePrisma({ casResults: [1, 0] });
    const svc = createBatchingService(p.prisma as never, redis);
    emitAssigned.mockClear();

    const [a, b] = await Promise.all([svc.assignBatch('batch1'), svc.assignBatch('batch1')]);

    expect([a.assigned, b.assigned].sort()).toEqual([false, true]);
    expect(p.assignmentCreateMany).toHaveBeenCalledTimes(1);
    expect(emitAssigned).toHaveBeenCalledTimes(1);
  });

  it('cancelling an empty batch is conditional too — never stomps a concurrent assign', async () => {
    const p = makePrisma({ orders: [], casResults: [1] });
    const svc = createBatchingService(p.prisma as never, redis);

    const result = await svc.assignBatch('batch1');

    expect(result).toEqual({ assigned: false, reason: 'empty' });
    expect(p.batchUpdateMany).toHaveBeenCalledWith({
      where: { id: 'batch1', status: 'open' },
      data:  { status: 'cancelled' },
    });
  });

  it('no rider online → batch stays open (no claim attempted) so the retry loop can assign later', async () => {
    const p = makePrisma({});
    (p.prisma.riderAvailability.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const svc = createBatchingService(p.prisma as never, redis);

    const result = await svc.assignBatch('batch1');

    expect(result).toEqual({ assigned: false, reason: 'no_rider' });
    expect(p.batchUpdateMany).not.toHaveBeenCalled();
  });

  it('fast path: a batch already past open is skipped without touching the DB further', async () => {
    const p = makePrisma({ status: 'assigned' });
    const svc = createBatchingService(p.prisma as never, redis);

    const result = await svc.assignBatch('batch1');

    expect(result).toEqual({ assigned: false, reason: 'already_handled' });
    expect(p.batchUpdateMany).not.toHaveBeenCalled();
  });
});
