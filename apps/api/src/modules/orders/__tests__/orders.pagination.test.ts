import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderStatusChanged:      vi.fn(),
  emitNewOrderForSeller:       vi.fn(),
  emitOrderCancelledForSeller:  vi.fn(),
}));

import { createOrdersService } from '../orders.service';
import { listOrdersQuerySchema } from '../orders.schema';

// A4-impl-1 regression: GET /orders must honor page/limit (history was hard-capped
// at the newest 50 — order #51 was unreachable forever), while a param-less call
// keeps the exact legacy contract so seller/rider apps see no change.

function makeService() {
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    order:         { findMany },
    sellerProfile: { findUnique: vi.fn().mockResolvedValue(null) },
  } as unknown as Parameters<typeof createOrdersService>[0];
  const redis = {} as unknown as Parameters<typeof createOrdersService>[1];
  return { service: createOrdersService(prisma, redis), findMany };
}

describe('getMyOrders — pagination (A4-impl-1)', () => {
  it('keeps the legacy contract without params: newest 50, no offset', async () => {
    const { service, findMany } = makeService();
    await service.getMyOrders('cust_1', 'customer', '');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where:   { customerId: 'cust_1' },
      orderBy: { createdAt: 'desc' },
      skip:    0,
      take:    50,
    }));
  });

  it('translates page/limit into skip/take (page 2 × 20 → skip 20)', async () => {
    const { service, findMany } = makeService();
    await service.getMyOrders('cust_1', 'customer', '', { page: 2, limit: 20 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
  });

  it('page 1 starts at offset 0', async () => {
    const { service, findMany } = makeService();
    await service.getMyOrders('cust_1', 'customer', '', { page: 1, limit: 20 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 20 }));
  });

  it('reaches past the old 50-order cap (page 3 × 20 → skip 40, order #51 visible)', async () => {
    const { service, findMany } = makeService();
    await service.getMyOrders('cust_1', 'customer', '', { page: 3, limit: 20 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 40, take: 20 }));
  });

  it('clamps a rogue limit to the legacy 50 cap (service-level backstop)', async () => {
    const { service, findMany } = makeService();
    await service.getMyOrders('cust_1', 'customer', '', { page: 1, limit: 500 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it('clamps page/limit below 1 instead of computing a negative offset', async () => {
    const { service, findMany } = makeService();
    await service.getMyOrders('cust_1', 'customer', '', { page: 0, limit: 0 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 1 }));
  });

  it('keeps role scoping when paginating (customer never sees others\' orders)', async () => {
    const { service, findMany } = makeService();
    await service.getMyOrders('cust_1', 'customer', '', { page: 4, limit: 10 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { customerId: 'cust_1' }, skip: 30, take: 10,
    }));
  });

  it('paginates the rider list by RiderProfile.id (BUG-1 contract preserved)', async () => {
    const { service, findMany } = makeService();
    await service.getMyOrders('rider_user', 'rider', 'rider_profile_1', { page: 2, limit: 20 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { riderId: 'rider_profile_1' }, skip: 20, take: 20,
    }));
  });
});

describe('listOrdersQuerySchema — GET /orders query validation', () => {
  it('accepts an empty query (legacy param-less request)', () => {
    const r = listOrdersQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({});
  });

  it('coerces querystring values ("2", "20" → 2, 20)', () => {
    const r = listOrdersQuerySchema.safeParse({ page: '2', limit: '20' });
    expect(r.success && r.data).toEqual({ page: 2, limit: 20 });
  });

  it.each([
    [{ page: '0' }],
    [{ page: '-1' }],
    [{ page: 'abc' }],
    [{ limit: '0' }],
    [{ limit: '51' }],
    [{ page: '1.5' }],
  ])('rejects out-of-range or non-numeric input %j', (query) => {
    expect(listOrdersQuerySchema.safeParse(query).success).toBe(false);
  });
});
