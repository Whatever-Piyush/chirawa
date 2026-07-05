import { describe, it, expect, vi } from 'vitest';
import { createInventoryService } from '../inventory.service';
import { createCatalogService } from '../catalog.service';
import { ValidationError, ForbiddenError } from '../../../shared/errors/app-errors';

// ─────────────────────────────────────────────────────────────────────────────
// Seller Sprint 4 — PATCH /catalog/products/bulk-stock parity.
//
// Contract: the bulk endpoint is behaviourally IDENTICAL to N calls of the single
// PATCH /products/:id/stock endpoint. These tests prove that by running the SAME
// scenario two ways against equivalent mock prisma instances:
//   • runSingles(): the reference — replays `referenceSingle` (a faithful copy of
//     the single route handler in catalog.routes.ts) once per id.
//   • runBulk(): the service method under test.
// …then asserting the observable effects match: updated ids, skipped ids, audit
// rows (stockUpdateLog), cache invalidations (redis.del calls) and the master
// restock re-gate (notifyRestock calls).
// ─────────────────────────────────────────────────────────────────────────────

const SELLER = 'seller_user_1';
const OTHER  = 'seller_user_2';
const sellerAuth = { userId: SELLER, role: 'seller' };
const adminAuth  = { userId: 'admin_1',  role: 'admin' };

type PRow = { id: string; shopId: string; stockStatus: string; masterId: string | null; ownerUserId: string };
const FIXTURE: PRow[] = [
  { id: 'p1', shopId: 's1', stockStatus: 'out_of_stock', masterId: 'm1', ownerUserId: SELLER }, // out→avail w/ master → re-gate
  { id: 'p2', shopId: 's1', stockStatus: 'hidden',       masterId: 'm2', ownerUserId: SELLER }, // hidden→avail w/ master → re-gate
  { id: 'p3', shopId: 's2', stockStatus: 'available',    masterId: 'm3', ownerUserId: SELLER }, // already avail → NO re-gate
  { id: 'p4', shopId: 's2', stockStatus: 'out_of_stock', masterId: null, ownerUserId: SELLER }, // out→avail, no master → NO re-gate
  { id: 'p5', shopId: 's3', stockStatus: 'out_of_stock', masterId: 'm4', ownerUserId: OTHER  }, // owned by another seller
  // 'p_missing' intentionally absent from the store
];
const freshStore = () => new Map<string, PRow>(FIXTURE.map((p) => [p.id, { ...p }]));

const shape = (p: PRow) => ({
  id: p.id, shopId: p.shopId, stockStatus: p.stockStatus, masterId: p.masterId,
  shop: { seller: { userId: p.ownerUserId } },
});

// Mutable prisma double. update/updateMany mutate the store so a repeated call
// observes the already-applied status (needed for the idempotency test).
function makePrisma(store: Map<string, PRow>, audits: Record<string, unknown>[]) {
  return {
    product: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const p = store.get(where.id); return p ? shape(p) : null; }),
      findMany:   vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        [...store.values()].filter((p) => where.id.in.includes(p.id)).map(shape)),
      update:     vi.fn(async ({ where, data }: { where: { id: string }; data: { stockStatus: string } }) => {
        const p = store.get(where.id)!; p.stockStatus = data.stockStatus; return shape(p);
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: { stockStatus: string } }) => {
        let count = 0;
        for (const id of where.id.in) { const p = store.get(id); if (p) { p.stockStatus = data.stockStatus; count++; } }
        return { count };
      }),
    },
    stockUpdateLog: {
      create:     vi.fn(async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return data; }),
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => { for (const r of data) audits.push(r); return { count: data.length }; }),
    },
  };
}

// Faithful transcription of the single PATCH /products/:id/stock handler
// (apps/api/src/modules/catalog/catalog.routes.ts). Parity reference: "bulk == N of THESE".
async function referenceSingle(
  prisma: ReturnType<typeof makePrisma>, catalog: { invalidateShopCache: (s: string) => Promise<void> },
  notify: (m: string) => Promise<unknown>, productId: string, stockStatus: string, auth: { userId: string; role: string },
) {
  if (!['available', 'out_of_stock', 'hidden'].includes(stockStatus)) throw new ValidationError('Invalid stock status');
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ValidationError('Product not found');
  if (auth.role === 'seller' && product.shop.seller.userId !== auth.userId) throw new ForbiddenError('Not your product');
  const oldStatus = product.stockStatus;
  const updated = await prisma.product.update({ where: { id: productId }, data: { stockStatus } });
  await prisma.stockUpdateLog.create({ data: { productId: product.id, updatedById: auth.userId, fromStatus: oldStatus, toStatus: stockStatus } });
  await catalog.invalidateShopCache(product.shopId);
  if (oldStatus !== 'available' && stockStatus === 'available' && product.masterId) void notify(product.masterId).catch(() => {});
  return { id: updated.id, stockStatus: updated.stockStatus };
}

interface Effects { updatedIds: string[]; skippedIds: string[]; audits: Record<string, unknown>[]; delKeys: string[]; notified: string[] }
const norm = (e: Effects): Effects => ({
  updatedIds: [...e.updatedIds].sort(),
  skippedIds: [...e.skippedIds].sort(),
  audits: [...e.audits]
    .map((a) => ({ productId: a.productId, updatedById: a.updatedById, fromStatus: a.fromStatus, toStatus: a.toStatus }))
    .sort((x, y) => String(x.productId).localeCompare(String(y.productId))),
  delKeys: [...e.delKeys].sort(),
  notified: [...e.notified].sort(),
});

async function runSingles(ids: string[], status: string, auth: { userId: string; role: string }): Promise<Effects> {
  const store = freshStore(); const audits: Record<string, unknown>[] = []; const notified: string[] = [];
  const redis = { del: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null), setex: vi.fn() };
  const prisma = makePrisma(store, audits);
  const catalog = createCatalogService(prisma as never, redis as never);
  const notify = (m: string) => { notified.push(m); return Promise.resolve({}); };
  const updatedIds: string[] = []; const skippedIds: string[] = [];
  for (const id of ids) {
    try { await referenceSingle(prisma, catalog, notify, id, status, auth); updatedIds.push(id); }
    catch { skippedIds.push(id); }
  }
  return { updatedIds, skippedIds, audits, delKeys: redis.del.mock.calls.map((c) => String(c[0])), notified };
}

async function runBulk(ids: string[], status: string, auth: { userId: string; role: string }) {
  const store = freshStore(); const audits: Record<string, unknown>[] = []; const notified: string[] = [];
  const redis = { del: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null), setex: vi.fn() };
  const prisma = makePrisma(store, audits);
  const svc = createInventoryService(prisma as never, redis as never, { notifyRestock: (m: string) => { notified.push(m); return Promise.resolve({}); } });
  const result = await svc.bulkSetProductStock(ids, status, auth);
  return { result, prisma, redis, effects: { updatedIds: result.updatedIds, skippedIds: result.skippedIds, audits, delKeys: redis.del.mock.calls.map((c) => String(c[0])), notified } as Effects };
}

describe('bulkSetProductStock — parity with N single stock updates (Sprint 4)', () => {
  it('bulk == N single calls across a mixed set: updates, skips, audit, cache, and re-gate all match', async () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p_missing'];
    const singles = norm(await runSingles(ids, 'available', sellerAuth));
    const bulk    = norm((await runBulk(ids, 'available', sellerAuth)).effects);

    expect(bulk).toEqual(singles); // ← the whole-observable-behaviour parity assertion

    // Concrete contract spot-checks:
    expect(bulk.updatedIds).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(bulk.skippedIds).toEqual(['p5', 'p_missing']);   // not owned + not found (partial failure)
    expect(bulk.notified).toEqual(['m1', 'm2']);            // master re-gate: only out/hidden→avail WITH a master
    expect(bulk.delKeys.length).toBe(4 * 5);                // 4 shops-invalidations × 5 keys each (per-product, not batched)
  });

  it('ownership: a seller CANNOT bulk-update another seller\'s product — it is skipped, not applied', async () => {
    const { effects, prisma, redis } = await runBulk(['p5'], 'available', sellerAuth);
    expect(effects.updatedIds).toEqual([]);
    expect(effects.skippedIds).toEqual(['p5']);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();   // no write for a skipped product
    expect(prisma.stockUpdateLog.createMany).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();                   // no cache invalidation
    expect(effects.notified).toEqual([]);                       // no re-gate
  });

  it('admin bypasses ownership — updates another seller\'s product, identical to the single admin path', async () => {
    const ids = ['p1', 'p5'];
    const singles = norm(await runSingles(ids, 'out_of_stock', adminAuth));
    const bulk    = norm((await runBulk(ids, 'out_of_stock', adminAuth)).effects);
    expect(bulk).toEqual(singles);
    expect(bulk.updatedIds).toEqual(['p1', 'p5']);
    expect(bulk.skippedIds).toEqual([]);
  });

  it('partial failure: a batch mixing owned, not-owned and missing ids updates only the eligible ones', async () => {
    const ids = ['p1', 'p5', 'p_missing', 'p4'];
    const singles = norm(await runSingles(ids, 'out_of_stock', sellerAuth));
    const bulk    = norm((await runBulk(ids, 'out_of_stock', sellerAuth)).effects);
    expect(bulk).toEqual(singles);
    expect(bulk.updatedIds).toEqual(['p1', 'p4']);
    expect(bulk.skippedIds).toEqual(['p5', 'p_missing']);
  });

  it('audit parity: one stockUpdateLog row per updated product, from its own pre-update status', async () => {
    const bulk = norm((await runBulk(['p1', 'p2', 'p3'], 'available', sellerAuth)).effects);
    expect(bulk.audits).toEqual([
      { productId: 'p1', updatedById: SELLER, fromStatus: 'out_of_stock', toStatus: 'available' },
      { productId: 'p2', updatedById: SELLER, fromStatus: 'hidden',       toStatus: 'available' },
      { productId: 'p3', updatedById: SELLER, fromStatus: 'available',    toStatus: 'available' },
    ]);
  });

  it('idempotency: a second identical bulk is a no-op on status + re-gate, but still audits (parity with repeating singles)', async () => {
    const store = freshStore(); const audits: Record<string, unknown>[] = []; const notified: string[] = [];
    const redis = { del: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null), setex: vi.fn() };
    const prisma = makePrisma(store, audits);
    const svc = createInventoryService(prisma as never, redis as never, { notifyRestock: (m: string) => { notified.push(m); return Promise.resolve({}); } });
    const ids = ['p1', 'p2', 'p3', 'p4'];

    const r1 = await svc.bulkSetProductStock(ids, 'available', sellerAuth);
    const notifiedAfterFirst = [...notified];
    const r2 = await svc.bulkSetProductStock(ids, 'available', sellerAuth);

    expect(r1.updatedIds.sort()).toEqual(ids);
    expect(r2.updatedIds.sort()).toEqual(ids);                       // still reports them updated (idempotent)
    expect(notifiedAfterFirst.sort()).toEqual(['m1', 'm2']);         // first call re-gated the two master products
    expect(notified.slice(notifiedAfterFirst.length)).toEqual([]);   // second call: all already available → NO re-gate
    expect(audits.length).toBe(8);                                   // 4 rows per call — every call audits (parity with single)
    expect(audits.slice(4).every((a) => a.fromStatus === 'available' && a.toStatus === 'available')).toBe(true);
  });

  it('invalid stock status throws the SAME ValidationError as the single endpoint (no writes)', async () => {
    const store = freshStore(); const audits: Record<string, unknown>[] = [];
    const redis = { del: vi.fn(), get: vi.fn(), setex: vi.fn() };
    const prisma = makePrisma(store, audits);
    const svc = createInventoryService(prisma as never, redis as never, { notifyRestock: async () => ({}) });
    await expect(svc.bulkSetProductStock(['p1'], 'banana', sellerAuth)).rejects.toThrow('Invalid stock status');
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('de-dupes repeated ids within one request (a bulk request is a SET of products)', async () => {
    const { effects, prisma } = await runBulk(['p1', 'p1', 'p1'], 'available', sellerAuth);
    expect(effects.updatedIds).toEqual(['p1']);
    expect(effects.audits.length).toBe(1);                 // one audit row, not three
    expect(prisma.product.updateMany).toHaveBeenCalledTimes(1);
  });
});
