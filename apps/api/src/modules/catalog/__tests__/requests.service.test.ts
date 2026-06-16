import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the FCM sender so restock-notify is assertable without firebase.
vi.mock('../../notifications/fcm.service', () => ({ sendPush: vi.fn(async () => {}) }));

import { createRequestsService } from '../requests.service';
import { sendPush } from '../../notifications/fcm.service';

const VALID_EAN = '4006381333931'; // GS1 check-digit valid (see barcode.test.ts)

function makeDeps() {
  const prisma = {
    masterCatalog: {
      findUnique: vi.fn(async () => null as null | { id: string; name?: string }),
      findMany:   vi.fn(async () => [] as Array<{ id: string; name: string }>),
    },
    productRequest: {
      create:   vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'req1', masterId: data.masterId ?? null })),
      findMany: vi.fn(async () => [] as Array<Record<string, unknown>>),
      update:   vi.fn(async () => ({})),
    },
    notification: { create: vi.fn(async () => ({})) },
  };
  const redis = { get: vi.fn(async (_key: string) => null as string | null) };
  return { prisma, redis };
}

describe('createRequest (Phase 6 demand capture)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('links a master when a valid barcode matches the dictionary', async () => {
    const { prisma, redis } = makeDeps();
    prisma.masterCatalog.findUnique.mockResolvedValue({ id: 'm_maggi' });
    const svc = createRequestsService(prisma as never, redis as never);

    const res = await svc.createRequest('u1', { barcode: VALID_EAN });
    expect(prisma.masterCatalog.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { barcode: VALID_EAN } }));
    expect(prisma.productRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'u1', barcode: VALID_EAN, masterId: 'm_maggi' }),
    }));
    expect(res.masterId).toBe('m_maggi');
  });

  it('free-text request stores no master (nothing to link)', async () => {
    const { prisma, redis } = makeDeps();
    const svc = createRequestsService(prisma as never, redis as never);

    await svc.createRequest('u1', { rawText: 'Patanjali aloe vera gel' });
    expect(prisma.masterCatalog.findUnique).not.toHaveBeenCalled();
    expect(prisma.productRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ rawText: 'Patanjali aloe vera gel', masterId: null }),
    }));
  });
});

describe('getDemand (Phase 6 admin ranking)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('groups by master/barcode/text and ranks most-requested first', async () => {
    const { prisma, redis } = makeDeps();
    const d = (o: Record<string, unknown>) => ({ userId: 'u', rawText: null, barcode: null, masterId: null, pincode: null, createdAt: new Date('2026-06-14'), ...o });
    prisma.productRequest.findMany.mockResolvedValue([
      d({ masterId: 'm1', userId: 'a' }),
      d({ masterId: 'm1', userId: 'b' }),
      d({ masterId: 'm1', userId: 'a' }),          // m1 ×3 (2 distinct users)
      d({ barcode: '8901234567894', userId: 'c' }), // barcode ×1
      d({ rawText: 'Brown Bread', userId: 'd' }),   // text ×1
    ]);
    prisma.masterCatalog.findMany.mockResolvedValue([{ id: 'm1', name: 'Maggi Noodles' }]);
    const svc = createRequestsService(prisma as never, redis as never);

    const demand = await svc.getDemand();
    expect(demand[0]).toMatchObject({ type: 'master', label: 'Maggi Noodles', count: 3, distinctUsers: 2 });
    expect(demand).toHaveLength(3);
    // Sorted by count desc — the master group leads.
    expect(demand.map((g) => g.count)).toEqual([3, 1, 1]);
  });
});

describe('notifyRestock (Phase 6 restock fan-out)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('FCMs token-holding requesters once and stamps notifiedAt', async () => {
    const { prisma, redis } = makeDeps();
    prisma.productRequest.findMany.mockResolvedValue([
      { id: 'r1', userId: 'u1' }, // has a token
      { id: 'r2', userId: 'u2' }, // no token → skipped, left un-stamped
    ]);
    prisma.masterCatalog.findUnique.mockResolvedValue({ id: 'm1', name: 'Maggi' });
    redis.get.mockImplementation(async (key: string) => (key === 'fcm:token:u1' ? 'TOKEN1' : null));
    const svc = createRequestsService(prisma as never, redis as never);

    const res = await svc.notifyRestock('m1');
    expect(res.notified).toBe(1);
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush).toHaveBeenCalledWith(expect.objectContaining({ token: 'TOKEN1' }));
    // Only the notified request gets a notifiedAt stamp.
    expect(prisma.productRequest.update).toHaveBeenCalledTimes(1);
    expect(prisma.productRequest.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'r1' } }));
  });

  it('does nothing when no pending opt-in requests exist', async () => {
    const { prisma, redis } = makeDeps();
    prisma.productRequest.findMany.mockResolvedValue([]);
    const svc = createRequestsService(prisma as never, redis as never);

    const res = await svc.notifyRestock('m1');
    expect(res.notified).toBe(0);
    expect(sendPush).not.toHaveBeenCalled();
  });
});
