import { describe, it, expect, vi } from 'vitest';
import {
  reserveLine, reserveOrderLines, commitReservationsForOrder,
  releaseReservationsForOrder, sweepExpiredReservations, reclaimExpiredReservations,
  ReservationConflictError, type ReservationTx,
} from '../reservations.service';
import { DEFAULT_INVENTORY_CONFIG } from '../belief';

const cfg = DEFAULT_INVENTORY_CONFIG;
const actor = { role: 'customer', id: 'u1' };
const NOW = new Date('2026-07-07T10:00:00Z');

// $queryRaw fake fed by a FIFO of results — each call shifts the next canned
// response; the joined SQL of every call is recorded for behavioral asserts.
function makeTx(queue: unknown[][] = []) {
  const sqlSeen: string[] = [];
  const queryRaw = vi.fn((strings: TemplateStringsArray) => {
    sqlSeen.push(strings.join('?'));
    return Promise.resolve(queue.shift() ?? []);
  });
  const tx = {
    $queryRaw: queryRaw,
    $executeRaw: vi.fn(async () => 1),
    reservation: {
      create: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    inventoryEvent: { createMany: vi.fn(async () => ({ count: 1 })) },
    product: {
      findUnique: vi.fn(async () => ({ stockStatus: 'available', shopId: 'shop1' })),
      update: vi.fn(async () => ({})),
    },
  };
  return { tx: tx as unknown as ReservationTx, raw: tx, sqlSeen };
}

const line = (productId: string, qty = 2) => ({
  productId, shopId: 'shop1', orderId: 'o1', orderItemId: `oi-${productId}`, qty,
});

describe('reserveLine — the single-statement CAS', () => {
  it('reserves when the CAS matches: reservation row + order_reserved event with snapshots', async () => {
    const { tx, raw } = makeTx([[{ expectedQty: 10, reservedQty: 3 }]]);
    const res = await reserveLine(tx, line('p1'), actor, null);
    expect(res).toBe('reserved');
    expect(raw.reservation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ orderItemId: 'oi-p1', qty: 2, status: 'held', expiresAt: null }),
    }));
    expect(raw.inventoryEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ eventType: 'order_reserved', qtyAfter: 10, reservedAfter: 3 })],
      skipDuplicates: true,
    }));
  });

  it('returns insufficient (no rows, no event) when the CAS guard fails', async () => {
    const { tx, raw } = makeTx([[]]);
    const res = await reserveLine(tx, line('p1', 99), actor, null);
    expect(res).toBe('insufficient');
    expect(raw.reservation.create).not.toHaveBeenCalled();
    expect(raw.inventoryEvent.createMany).not.toHaveBeenCalled();
  });

  it('carries the prepaid TTL onto the hold', async () => {
    const { tx, raw } = makeTx([[{ expectedQty: null, reservedQty: 1 }]]);
    const expiresAt = new Date('2026-07-07T10:15:00Z');
    await reserveLine(tx, line('p1'), actor, expiresAt);
    expect(raw.reservation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ expiresAt }),
    }));
  });
});

describe('reserveOrderLines — deadlock rule + conflict surfacing', () => {
  it('reserves in ascending productId order regardless of input order', async () => {
    const { tx, raw } = makeTx([
      [{ expectedQty: 5, reservedQty: 1 }],
      [{ expectedQty: 5, reservedQty: 1 }],
      [{ expectedQty: 5, reservedQty: 1 }],
    ]);
    await reserveOrderLines(tx, [line('ppp'), line('aaa'), line('mmm')], actor, null);
    const order = (raw.reservation.create.mock.calls as unknown as Array<[{ data: { productId: string } }]>)
      .map((c) => c[0].data.productId);
    expect(order).toEqual(['aaa', 'mmm', 'ppp']);
  });

  it('throws ReservationConflictError naming the losing product', async () => {
    const { tx } = makeTx([
      [{ expectedQty: 5, reservedQty: 1 }], // aaa wins
      [],                                   // mmm loses
    ]);
    await expect(reserveOrderLines(tx, [line('mmm'), line('aaa')], actor, null))
      .rejects.toMatchObject({ name: 'ReservationConflictError', productId: 'mmm' });
  });
});

describe('commitReservationsForOrder — pickup is the physical decrement', () => {
  it('claims held+fulfilled lines, appends pickup_committed, mirrors stockQty', async () => {
    const { tx, raw, sqlSeen } = makeTx([
      [{ id: 'r1', productId: 'p1', orderItemId: 'oi1', qty: 2, shopId: 'shop1' }], // claim
      [{ expectedQty: 8, reservedQty: 1, velocityClass: 2, confidenceBase: 0.9, lastVerifiedAt: NOW, oldExpected: 10 }], // state update
    ]);
    const n = await commitReservationsForOrder(tx, 'o1', actor, cfg, NOW);
    expect(n).toBe(1);
    expect(sqlSeen[0]).toContain("fulfillment_status = 'fulfilled'");
    expect(raw.inventoryEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ eventType: 'pickup_committed', qtyDelta: -2, qtyAfter: 8 })],
    }));
    expect(raw.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1' }, data: { stockQty: 8 },
    }));
  });

  it('floors at zero and logs anomaly_negative_floor when drift exceeded belief', async () => {
    const { tx, raw } = makeTx([
      [{ id: 'r1', productId: 'p1', orderItemId: 'oi1', qty: 5, shopId: 'shop1' }],
      [{ expectedQty: 0, reservedQty: 0, velocityClass: 2, confidenceBase: 0.95, lastVerifiedAt: NOW, oldExpected: 2 }],
    ]);
    await commitReservationsForOrder(tx, 'o1', actor, cfg, NOW);
    const events = (raw.inventoryEvent.createMany.mock.calls as unknown as Array<[{ data: Array<{ eventType: string }> }]>)[0]![0].data;
    expect(events.map((e) => e.eventType)).toEqual(['pickup_committed', 'anomaly_negative_floor']);
    // The anomaly overrides the weak +0.05 reinforcement with hard distrust.
    expect(raw.$executeRaw).toHaveBeenCalled();
  });

  it('no-ops on an order with nothing held (idempotent replay)', async () => {
    const { tx, raw } = makeTx([[]]);
    const n = await commitReservationsForOrder(tx, 'o1', actor, cfg, NOW);
    expect(n).toBe(0);
    expect(raw.inventoryEvent.createMany).not.toHaveBeenCalled();
  });
});

describe('releaseReservationsForOrder — cancel gives the stock back', () => {
  it('claims held rows, appends reservation_released, and re-projects availability', async () => {
    const { tx, raw } = makeTx([
      [{ id: 'r1', productId: 'p1', orderItemId: 'oi1', qty: 2 }], // claim
      [{ expectedQty: 4, reservedQty: 0, velocityClass: 2, confidenceBase: 0.9, lastVerifiedAt: NOW, shopIdResolved: 'shop1' }],
    ]);
    const n = await releaseReservationsForOrder(tx, 'o1', actor, cfg, NOW, 'customer cancelled');
    expect(n).toBe(1);
    expect(raw.inventoryEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ eventType: 'reservation_released', reservedAfter: 0, reason: 'customer cancelled' })],
    }));
  });

  it('revives a fully-reserved tracked item back to available on release', async () => {
    const { tx, raw } = makeTx([
      [{ id: 'r1', productId: 'p1', orderItemId: 'oi1', qty: 4 }],
      [{ expectedQty: 4, reservedQty: 0, velocityClass: 2, confidenceBase: 0.9, lastVerifiedAt: NOW, shopIdResolved: 'shop1' }],
    ]);
    raw.product.findUnique.mockResolvedValueOnce({ stockStatus: 'out_of_stock', shopId: 'shop1' });
    await releaseReservationsForOrder(tx, 'o1', actor, cfg, NOW);
    expect(raw.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1' }, data: { stockStatus: 'available' },
    }));
  });
});

describe('sweepExpiredReservations — prepaid TTL', () => {
  function makePrisma(due: Array<Record<string, unknown>>, txFactory: () => ReturnType<typeof makeTx>) {
    const txs: ReturnType<typeof makeTx>[] = [];
    return {
      prisma: {
        reservation: { findMany: vi.fn(async () => due) },
        orderItem: { updateMany: vi.fn(async () => ({ count: 1 })) },
        $transaction: vi.fn(async (fn: (tx: ReservationTx) => Promise<unknown>) => {
          const t = txFactory();
          txs.push(t);
          return fn(t.tx);
        }),
      },
      txs,
    };
  }

  it('expires each due hold in its own transaction', async () => {
    const { prisma } = makePrisma(
      [{ id: 'r1', orderId: 'o1', orderItemId: 'oi1', productId: 'p1', qty: 2 }],
      () => makeTx([
        [{ id: 'r1', productId: 'p1', orderItemId: 'oi1', qty: 2 }],
        [{ expectedQty: 6, reservedQty: 0, velocityClass: 2, confidenceBase: 0.9, lastVerifiedAt: NOW, shopIdResolved: 'shop1' }],
      ]),
    );
    const swept = await sweepExpiredReservations(prisma as never, cfg, NOW);
    expect(swept).toBe(1);
  });

  it('skips a hold whose claim was lost meanwhile (paid/cancelled raced us)', async () => {
    const { prisma } = makePrisma(
      [{ id: 'r1', orderId: 'o1', orderItemId: 'oi1', productId: 'p1', qty: 2 }],
      () => makeTx([[]]), // claim matches nothing
    );
    const swept = await sweepExpiredReservations(prisma as never, cfg, NOW);
    expect(swept).toBe(0);
  });
});

describe('reclaimExpiredReservations — late payment takes the stock back', () => {
  it('flags the order item for accept-screen verification when the stock is gone', async () => {
    const orderItemUpdateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      reservation: { findMany: vi.fn(async () => [
        { id: 'r1', orderId: 'o1', orderItemId: 'oi1', productId: 'p1', qty: 2 },
      ]) },
      orderItem: { updateMany: orderItemUpdateMany },
      $transaction: vi.fn(async (fn: (tx: ReservationTx) => Promise<unknown>) => {
        const { tx } = makeTx([[]]); // CAS fails — stock is gone
        return fn(tx);
      }),
    };
    const flagged = await reclaimExpiredReservations(prisma as never, 'o1');
    expect(flagged).toEqual(['oi1']);
    expect(orderItemUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { verificationFlag: 'accept_verify_requested' },
    }));
  });

  it('re-holds silently when the stock is still there', async () => {
    const prisma = {
      reservation: { findMany: vi.fn(async () => [
        { id: 'r1', orderId: 'o1', orderItemId: 'oi1', productId: 'p1', qty: 2 },
      ]) },
      orderItem: { updateMany: vi.fn(async () => ({ count: 0 })) },
      $transaction: vi.fn(async (fn: (tx: ReservationTx) => Promise<unknown>) => {
        const { tx } = makeTx([[{ expectedQty: 5, reservedQty: 2 }]]);
        return fn(tx);
      }),
    };
    const flagged = await reclaimExpiredReservations(prisma as never, 'o1');
    expect(flagged).toEqual([]);
  });
});

describe('ReservationConflictError', () => {
  it('carries the losing productId for the placement retry loop', () => {
    const err = new ReservationConflictError('p9');
    expect(err.productId).toBe('p9');
    expect(err.name).toBe('ReservationConflictError');
  });
});
