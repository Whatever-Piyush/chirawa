import { describe, it, expect, vi } from 'vitest';
import { createInventoryService } from '../inventory.service';
import { createCatalogService } from '../catalog.service';
import { applyInventoryEvent } from '../../inventory/apply-event';
import { getInventoryConfig } from '../../inventory/inventory.config';
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
// rows (stockUpdateLog for 'hidden'; inventory_events for availability toggles —
// Inventory Engine), cache invalidations (redis.del calls) and the master
// restock re-gate (notifyRestock calls).
//
// Inventory Engine note: availability toggles are belief events routed through
// applyInventoryEvent — the projection NEVER unhides a 'hidden' product (that is
// merchandising state), so a hidden product "accepts" a toggle_in without a
// status change and without a re-gate. The single endpoint behaves the same way.
// ─────────────────────────────────────────────────────────────────────────────

const SELLER = 'seller_user_1';
const OTHER  = 'seller_user_2';
const sellerAuth = { userId: SELLER, role: 'seller' };
const adminAuth  = { userId: 'admin_1',  role: 'admin' };

type PRow = { id: string; shopId: string; stockStatus: string; masterId: string | null; ownerUserId: string };
const FIXTURE: PRow[] = [
  { id: 'p1', shopId: 's1', stockStatus: 'out_of_stock', masterId: 'm1', ownerUserId: SELLER }, // out→avail w/ master → re-gate
  { id: 'p2', shopId: 's1', stockStatus: 'hidden',       masterId: 'm2', ownerUserId: SELLER }, // hidden STAYS hidden → NO re-gate
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
// observes the already-applied status (needed for the idempotency test). Also
// fakes the belief-layer tables (inventoryState/inventoryEvent) that
// applyInventoryEvent writes, collecting event rows into `events`.
function makePrisma(store: Map<string, PRow>, audits: Record<string, unknown>[], events: Record<string, unknown>[]) {
  const states = new Map<string, Record<string, unknown>>();
  const prisma = {
    product: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const p = store.get(where.id); return p ? shape(p) : null; }),
      findMany:   vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        [...store.values()].filter((p) => where.id.in.includes(p.id)).map(shape)),
      update:     vi.fn(async ({ where, data }: { where: { id: string }; data: { stockStatus?: string } }) => {
        const p = store.get(where.id)!;
        if (data.stockStatus !== undefined) p.stockStatus = data.stockStatus; // belief writes may carry only the stockQty mirror
        return shape(p);
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
    // Belief layer (Inventory Engine) — the fixture products are binary
    // (untracked) rows, so state starts absent and toggles keep expectedQty null.
    inventoryState: {
      findUnique: vi.fn(async ({ where }: { where: { productId: string } }) => (states.get(where.productId) as never) ?? null),
      upsert:     vi.fn(async ({ where, create, update }: { where: { productId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const cur = states.get(where.productId);
        states.set(where.productId, cur ? { ...cur, ...update } : { reservedQty: 0, ...create });
        return states.get(where.productId);
      }),
    },
    inventoryEvent: {
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => { for (const r of data) events.push(r); return { count: data.length }; }),
    },
    appConfig: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(),
  };
  // Interactive callback form only (the belief single-writer) — tx === prisma.
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return prisma;
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
  let newStatus: string;
  if (stockStatus === 'hidden') {
    // Merchandising visibility — direct write + legacy toggle log.
    await prisma.product.update({ where: { id: productId }, data: { stockStatus } });
    await prisma.stockUpdateLog.create({ data: { productId: product.id, updatedById: auth.userId, fromStatus: oldStatus, toStatus: stockStatus } });
    newStatus = 'hidden';
  } else {
    // Availability toggles are BELIEF events (Inventory Engine).
    const cfg = await getInventoryConfig(prisma as never);
    const result = await prisma.$transaction(async (tx: unknown) =>
      applyInventoryEvent(tx as never, {
        productId: product.id, shopId: product.shopId,
        eventType: stockStatus === 'available' ? 'seller_toggle_in' : 'seller_toggle_out',
        actorType: auth.role === 'admin' ? 'admin' : 'seller', actorId: auth.userId,
      }, cfg),
    ) as Awaited<ReturnType<typeof applyInventoryEvent>>;
    newStatus = result.stockStatusTo;
  }
  await catalog.invalidateShopCache(product.shopId);
  if (oldStatus !== 'available' && newStatus === 'available' && product.masterId) void notify(product.masterId).catch(() => {});
  return { id: product.id, stockStatus: newStatus };
}

interface Effects {
  updatedIds: string[]; skippedIds: string[]; audits: Record<string, unknown>[];
  events: Record<string, unknown>[]; delKeys: string[]; notified: string[];
}
const norm = (e: Effects) => ({
  updatedIds: [...e.updatedIds].sort(),
  skippedIds: [...e.skippedIds].sort(),
  audits: [...e.audits]
    .map((a) => ({ productId: a.productId, updatedById: a.updatedById, fromStatus: a.fromStatus, toStatus: a.toStatus }))
    .sort((x, y) => String(x.productId).localeCompare(String(y.productId))),
  events: [...e.events]
    .map((ev) => ({ productId: ev.productId, shopId: ev.shopId, eventType: ev.eventType, actorType: ev.actorType, actorId: ev.actorId }))
    .sort((x, y) => String(x.productId).localeCompare(String(y.productId))),
  delKeys: [...e.delKeys].sort(),
  notified: [...e.notified].sort(),
});

async function runSingles(ids: string[], status: string, auth: { userId: string; role: string }): Promise<Effects> {
  const store = freshStore(); const audits: Record<string, unknown>[] = []; const events: Record<string, unknown>[] = []; const notified: string[] = [];
  const redis = { del: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null), setex: vi.fn() };
  const prisma = makePrisma(store, audits, events);
  const catalog = createCatalogService(prisma as never, redis as never);
  const notify = (m: string) => { notified.push(m); return Promise.resolve({}); };
  const updatedIds: string[] = []; const skippedIds: string[] = [];
  for (const id of ids) {
    try { await referenceSingle(prisma, catalog, notify, id, status, auth); updatedIds.push(id); }
    catch { skippedIds.push(id); }
  }
  return { updatedIds, skippedIds, audits, events, delKeys: redis.del.mock.calls.map((c) => String(c[0])), notified };
}

async function runBulk(ids: string[], status: string, auth: { userId: string; role: string }) {
  const store = freshStore(); const audits: Record<string, unknown>[] = []; const events: Record<string, unknown>[] = []; const notified: string[] = [];
  const redis = { del: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null), setex: vi.fn() };
  const prisma = makePrisma(store, audits, events);
  const svc = createInventoryService(prisma as never, redis as never, { notifyRestock: (m: string) => { notified.push(m); return Promise.resolve({}); } });
  const result = await svc.bulkSetProductStock(ids, status, auth);
  return { result, prisma, redis, effects: { updatedIds: result.updatedIds, skippedIds: result.skippedIds, audits, events, delKeys: redis.del.mock.calls.map((c) => String(c[0])), notified } as Effects };
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
    expect(bulk.notified).toEqual(['m1']);                  // re-gate: only out→avail WITH a master (hidden p2 stays hidden)
    expect(bulk.delKeys.length).toBe(4 * 5);                // 4 shops-invalidations × 5 keys each (per-product, not batched)
    expect(bulk.events).toHaveLength(4);                    // one belief event per eligible product
    expect(bulk.audits).toEqual([]);                        // availability toggles audit via inventory_events, not stockUpdateLog
  });

  it('ownership: a seller CANNOT bulk-update another seller\'s product — it is skipped, not applied', async () => {
    const { effects, prisma, redis } = await runBulk(['p5'], 'available', sellerAuth);
    expect(effects.updatedIds).toEqual([]);
    expect(effects.skippedIds).toEqual(['p5']);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();   // no write for a skipped product
    expect(prisma.stockUpdateLog.createMany).not.toHaveBeenCalled();
    expect(effects.events).toEqual([]);                         // no belief event either
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
    expect(bulk.events.every((ev) => ev.eventType === 'seller_toggle_out' && ev.actorType === 'admin')).toBe(true);
  });

  it('partial failure: a batch mixing owned, not-owned and missing ids updates only the eligible ones', async () => {
    const ids = ['p1', 'p5', 'p_missing', 'p4'];
    const singles = norm(await runSingles(ids, 'out_of_stock', sellerAuth));
    const bulk    = norm((await runBulk(ids, 'out_of_stock', sellerAuth)).effects);
    expect(bulk).toEqual(singles);
    expect(bulk.updatedIds).toEqual(['p1', 'p4']);
    expect(bulk.skippedIds).toEqual(['p5', 'p_missing']);
  });

  it('audit parity: one belief event per updated product (the event log IS the audit for availability toggles)', async () => {
    const bulk = norm((await runBulk(['p1', 'p2', 'p3'], 'available', sellerAuth)).effects);
    expect(bulk.audits).toEqual([]); // no stockUpdateLog rows on the belief path
    expect(bulk.events).toEqual([
      { productId: 'p1', shopId: 's1', eventType: 'seller_toggle_in', actorType: 'seller', actorId: SELLER },
      { productId: 'p2', shopId: 's1', eventType: 'seller_toggle_in', actorType: 'seller', actorId: SELLER },
      { productId: 'p3', shopId: 's2', eventType: 'seller_toggle_in', actorType: 'seller', actorId: SELLER },
    ]);
  });

  it('hidden parity: bulk hide == N single hides — direct writes + stockUpdateLog, no belief events', async () => {
    const ids = ['p1', 'p3'];
    const singles = norm(await runSingles(ids, 'hidden', sellerAuth));
    const bulk    = norm((await runBulk(ids, 'hidden', sellerAuth)).effects);
    expect(bulk).toEqual(singles);
    expect(bulk.audits).toEqual([
      { productId: 'p1', updatedById: SELLER, fromStatus: 'out_of_stock', toStatus: 'hidden' },
      { productId: 'p3', updatedById: SELLER, fromStatus: 'available',    toStatus: 'hidden' },
    ]);
    expect(bulk.events).toEqual([]); // the belief layer never touches 'hidden'
  });

  it('idempotency: a second identical bulk is a no-op on status + re-gate, but still records events (parity with repeating singles)', async () => {
    const store = freshStore(); const audits: Record<string, unknown>[] = []; const events: Record<string, unknown>[] = []; const notified: string[] = [];
    const redis = { del: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null), setex: vi.fn() };
    const prisma = makePrisma(store, audits, events);
    const svc = createInventoryService(prisma as never, redis as never, { notifyRestock: (m: string) => { notified.push(m); return Promise.resolve({}); } });
    const ids = ['p1', 'p2', 'p3', 'p4'];

    const r1 = await svc.bulkSetProductStock(ids, 'available', sellerAuth);
    const notifiedAfterFirst = [...notified];
    const r2 = await svc.bulkSetProductStock(ids, 'available', sellerAuth);

    expect(r1.updatedIds.sort()).toEqual(ids);
    expect(r2.updatedIds.sort()).toEqual(ids);                       // still reports them updated (idempotent)
    expect(notifiedAfterFirst.sort()).toEqual(['m1']);               // re-gate: p1 only (p2 stays hidden — never becomes available)
    expect(notified.slice(notifiedAfterFirst.length)).toEqual([]);   // second call: nothing newly available → NO re-gate
    expect(audits.length).toBe(0);                                   // no stockUpdateLog on the belief path
    expect(events.length).toBe(8);                                   // 4 belief events per call — every call is recorded
    expect(events.slice(4).every((ev) => ev.eventType === 'seller_toggle_in')).toBe(true);
  });

  it('invalid stock status throws the SAME ValidationError as the single endpoint (no writes)', async () => {
    const store = freshStore(); const audits: Record<string, unknown>[] = []; const events: Record<string, unknown>[] = [];
    const redis = { del: vi.fn(), get: vi.fn(), setex: vi.fn() };
    const prisma = makePrisma(store, audits, events);
    const svc = createInventoryService(prisma as never, redis as never, { notifyRestock: async () => ({}) });
    await expect(svc.bulkSetProductStock(['p1'], 'banana', sellerAuth)).rejects.toThrow('Invalid stock status');
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('de-dupes repeated ids within one request (a bulk request is a SET of products)', async () => {
    const { effects, prisma } = await runBulk(['p1', 'p1', 'p1'], 'available', sellerAuth);
    expect(effects.updatedIds).toEqual(['p1']);
    expect(effects.events.length).toBe(1);                 // one belief event, not three
    expect(effects.audits.length).toBe(0);                 // belief path — no stockUpdateLog rows
    expect(prisma.product.updateMany).not.toHaveBeenCalled(); // availability goes through the single writer, not updateMany
  });
});
