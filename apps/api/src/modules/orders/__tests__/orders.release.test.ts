import { describe, it, expect, vi } from 'vitest';
import { releaseOrderAssignment } from '../orders.service';

function makePrisma(liveInBatch: number) {
  const assignmentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const orderUpdate = vi.fn().mockResolvedValue({});
  const orderCount  = vi.fn().mockResolvedValue(liveInBatch);
  const batchUpdate = vi.fn().mockResolvedValue({});
  const tx = {
    deliveryAssignment: { updateMany: assignmentUpdateMany },
    order: { update: orderUpdate, count: orderCount },
    batch: { update: batchUpdate },
  };
  const prisma = { $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  return { prisma, assignmentUpdateMany, orderUpdate, orderCount, batchUpdate };
}

describe('releaseOrderAssignment (Phase 1.6)', () => {
  it('deactivates the active assignment and detaches rider + batch from the order', async () => {
    const p = makePrisma(0);
    await releaseOrderAssignment(p.prisma as never, 'order_1', 'batch_1');

    expect(p.assignmentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderId: 'order_1', isActive: true },
      data:  expect.objectContaining({ isActive: false }),
    }));
    expect(p.orderUpdate).toHaveBeenCalledWith({ where: { id: 'order_1' }, data: { riderId: null, batchId: null } });
  });

  it('cancels the batch when no live orders remain in it', async () => {
    const p = makePrisma(0);
    await releaseOrderAssignment(p.prisma as never, 'order_1', 'batch_1');
    expect(p.batchUpdate).toHaveBeenCalledWith({ where: { id: 'batch_1' }, data: { status: 'cancelled' } });
  });

  it('leaves the batch alone when other live orders remain', async () => {
    const p = makePrisma(2);
    await releaseOrderAssignment(p.prisma as never, 'order_1', 'batch_1');
    expect(p.batchUpdate).not.toHaveBeenCalled();
  });

  it('skips batch handling entirely for an unbatched order', async () => {
    const p = makePrisma(0);
    await releaseOrderAssignment(p.prisma as never, 'order_1', null);
    expect(p.orderCount).not.toHaveBeenCalled();
    expect(p.batchUpdate).not.toHaveBeenCalled();
  });
});
