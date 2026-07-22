import { describe, it, expect, vi } from 'vitest';
import { applyInventoryEvent, ensureInventoryState, type InventoryTx } from '../apply-event';
import { DEFAULT_INVENTORY_CONFIG } from '../belief';

const cfg = DEFAULT_INVENTORY_CONFIG;
const NOW = new Date('2026-07-07T10:00:00Z');

interface FakeOpts {
  state?: {
    expectedQty: number | null; reservedQty: number; velocityClass: number | null;
    confidenceBase: number; lastVerifiedAt: Date | null;
  } | null;
  stockStatus?: 'available' | 'out_of_stock' | 'hidden';
  eventInsertCount?: number; // simulate skipDuplicates replay with 0
}

function makeTx(opts: FakeOpts = {}) {
  const upsert = vi.fn().mockResolvedValue({});
  const createMany = vi.fn().mockResolvedValue({ count: opts.eventInsertCount ?? 1 });
  const productUpdate = vi.fn().mockResolvedValue({});
  const tx: InventoryTx = {
    inventoryState: {
      findUnique: vi.fn().mockResolvedValue(opts.state === undefined ? null : opts.state),
      upsert,
    },
    inventoryEvent: { createMany },
    product: {
      findUnique: vi.fn().mockResolvedValue({ stockStatus: opts.stockStatus ?? 'available' }),
      update: productUpdate,
    },
  };
  return { tx, upsert, createMany, productUpdate };
}

const trackedState = {
  expectedQty: 20, reservedQty: 3, velocityClass: 3, confidenceBase: 0.9,
  lastVerifiedAt: new Date('2026-07-07T09:00:00Z'),
};

const base = {
  productId: 'p1', shopId: 's1',
  actorType: 'seller' as const, actorId: 'u1',
};

describe('applyInventoryEvent — the single writer', () => {
  it('seller_count sets an exact belief, high confidence, and stamps verification', async () => {
    const { tx, upsert, createMany, productUpdate } = makeTx({ state: trackedState });
    const res = await applyInventoryEvent(tx, { ...base, eventType: 'seller_count', qty: 12 }, cfg, NOW);

    expect(res.expectedQty).toBe(12);
    expect(res.confidenceBase).toBe(0.95);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        expectedQty: 12, confidenceBase: 0.95,
        lastVerifiedAt: NOW, lastVerifiedSource: 'seller_count', lastVerifiedQty: 12,
      }),
    }));
    // Event row snapshots the post-state, including the signed delta.
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        eventType: 'seller_count', qtyDelta: -8, qtyAfter: 12, reservedAfter: 3,
        orderId: null, orderItemId: null,
      })],
      skipDuplicates: true,
    }));
    // Legacy stockQty mirror keeps the seller app truthful until the column drops.
    expect(productUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stockQty: 12 }),
    }));
  });

  it('a count of zero projects the product out of stock', async () => {
    const { tx, productUpdate } = makeTx({ state: trackedState });
    const res = await applyInventoryEvent(tx, { ...base, eventType: 'seller_count', qty: 0 }, cfg, NOW);
    expect(res.stockStatusChanged).toBe(true);
    expect(res.stockStatusTo).toBe('out_of_stock');
    expect(productUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stockStatus: 'out_of_stock' }),
    }));
  });

  it('seller_toggle_out zeroes a tracked belief and flips status even for binary items', async () => {
    const binary = { ...trackedState, expectedQty: null, velocityClass: null };
    const { tx, productUpdate } = makeTx({ state: binary });
    const res = await applyInventoryEvent(tx, { ...base, eventType: 'seller_toggle_out' }, cfg, NOW);
    expect(res.expectedQty).toBeNull(); // binary stays binary
    expect(res.stockStatusTo).toBe('out_of_stock');
    expect(productUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stockStatus: 'out_of_stock' }),
    }));
  });

  it('seller_toggle_in restores a tracked item with the bucket default', async () => {
    const { tx } = makeTx({ state: { ...trackedState, expectedQty: 0 }, stockStatus: 'out_of_stock' });
    const res = await applyInventoryEvent(tx, { ...base, eventType: 'seller_toggle_in' }, cfg, NOW);
    expect(res.expectedQty).toBe(cfg.bucketSome);
    expect(res.confidenceBase).toBe(0.8);
    expect(res.stockStatusTo).toBe('available');
  });

  it('rider_reported_missing is truth-grade: zero belief, floor confidence, hide', async () => {
    const { tx } = makeTx({ state: trackedState });
    const res = await applyInventoryEvent(tx, {
      ...base, eventType: 'rider_reported_missing', actorType: 'rider',
      orderId: 'o1', orderItemId: 'oi1',
    }, cfg, NOW);
    expect(res.expectedQty).toBe(0);
    expect(res.confidenceBase).toBe(0.15);
    expect(res.stockStatusTo).toBe('out_of_stock');
  });

  it('never touches a merchandising-hidden product', async () => {
    const { tx, productUpdate } = makeTx({ state: trackedState, stockStatus: 'hidden' });
    const res = await applyInventoryEvent(tx, { ...base, eventType: 'seller_count', qty: 0 }, cfg, NOW);
    expect(res.stockStatusChanged).toBe(false);
    expect(res.stockStatusTo).toBe('hidden');
    const statusWrites = productUpdate.mock.calls.filter(
      (c) => (c[0] as { data: Record<string, unknown> }).data['stockStatus'] !== undefined,
    );
    expect(statusWrites).toHaveLength(0);
  });

  it('creates the state row on first touch (product predates the engine)', async () => {
    const { tx, upsert } = makeTx({ state: null });
    await applyInventoryEvent(tx, { ...base, eventType: 'seller_count', qty: 5 }, cfg, NOW);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ productId: 'p1', expectedQty: 5 }),
    }));
  });

  it('reports a duplicate order-linked event as not applied (idempotent replay)', async () => {
    const { tx } = makeTx({ state: trackedState, eventInsertCount: 0 });
    const res = await applyInventoryEvent(tx, {
      ...base, eventType: 'rider_reported_missing', actorType: 'rider',
      orderId: 'o1', orderItemId: 'oi1',
    }, cfg, NOW);
    expect(res.applied).toBe(false);
  });

  it('binary count/bucket-free events leave stockStatus alone', async () => {
    const binary = { ...trackedState, expectedQty: null, velocityClass: null };
    const { tx, productUpdate } = makeTx({ state: binary, stockStatus: 'out_of_stock' });
    const res = await applyInventoryEvent(tx, { ...base, eventType: 'backfill' }, cfg, NOW);
    expect(res.stockStatusChanged).toBe(false);
    const statusWrites = productUpdate.mock.calls.filter(
      (c) => (c[0] as { data: Record<string, unknown> }).data['stockStatus'] !== undefined,
    );
    expect(statusWrites).toHaveLength(0);
  });
});

describe('ensureInventoryState', () => {
  it('idempotently creates a binary default row', async () => {
    const { tx, upsert } = makeTx({ state: null });
    await ensureInventoryState(tx, 'p9');
    expect(upsert).toHaveBeenCalledWith({
      where: { productId: 'p9' },
      update: {},
      create: { productId: 'p9' },
    });
  });
});
