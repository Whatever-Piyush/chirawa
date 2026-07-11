import { describe, it, expect, vi } from 'vitest';
import { assertTransition, transitionOrderStatus } from '../order-status';
import { BusinessRuleError } from '../../../shared/errors/app-errors';

// A minimal fake transaction client — the primitive touches order.updateMany
// (compare-and-set) + orderStatusHistory.create, and on picked_up/cancelled the
// inventory hooks claim reservations via $queryRaw (empty = nothing held).
function makeTx(flipCount = 1) {
  const updateMany = vi.fn().mockResolvedValue({ count: flipCount });
  const create     = vi.fn().mockResolvedValue({});
  const queryRaw   = vi.fn().mockResolvedValue([]);
  const tx = { order: { updateMany }, orderStatusHistory: { create }, $queryRaw: queryRaw };
  return { tx: tx as unknown as Parameters<typeof transitionOrderStatus>[0], updateMany, create, queryRaw };
}

const actor = { role: 'rider', id: 'u1' };

describe('transitionOrderStatus — the single enforcement point', () => {
  it('flips a legal transition (out_for_delivery → delivered) and writes history', async () => {
    const { tx, updateMany, create } = makeTx();
    const ok = await transitionOrderStatus(tx, 'o1', 'out_for_delivery', 'delivered', actor);
    expect(ok).toBe(true);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'o1', status: 'out_for_delivery' },
      data:  expect.objectContaining({ status: 'delivered', deliveredAt: expect.any(Date) }),
    }));
    expect(create).toHaveBeenCalled();
  });

  it('merges extraData into the order update (e.g. codCollectedPaise)', async () => {
    const { tx, updateMany } = makeTx();
    await transitionOrderStatus(tx, 'o1', 'out_for_delivery', 'delivered', actor, { codCollectedPaise: 16000 });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'delivered', codCollectedPaise: 16000 }),
    }));
  });

  // ── Inventory hooks (Inventory Engine) ───────────────────────────────────────
  it('COMMITS held reservations on → picked_up (same transaction)', async () => {
    const { tx, queryRaw } = makeTx();
    await transitionOrderStatus(tx, 'o1', 'ready_for_pickup', 'picked_up', actor);
    const sql = (queryRaw.mock.calls[0]![0] as string[]).join('?');
    expect(sql).toContain('UPDATE reservations');
    expect(sql).toContain("'committed'");
  });

  it('RELEASES held reservations on → cancelled (same transaction)', async () => {
    const { tx, queryRaw } = makeTx();
    await transitionOrderStatus(tx, 'o1', 'confirmed', 'cancelled', actor);
    const sql = (queryRaw.mock.calls[0]![0] as string[]).join('?');
    expect(sql).toContain('UPDATE reservations');
    expect(sql).toContain("'released'");
  });

  it('runs NO inventory hook on other transitions', async () => {
    const { tx, queryRaw } = makeTx();
    await transitionOrderStatus(tx, 'o1', 'confirmed', 'preparing', actor);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('skips the hooks entirely when the compare-and-set loses the race', async () => {
    const { tx, queryRaw } = makeTx(0);
    await transitionOrderStatus(tx, 'o1', 'confirmed', 'cancelled', actor);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  // ── Terminal-backward rejections (V1 / V2 / V4) ──────────────────────────────
  it('V1: rejects delivered → out_for_delivery (no write)', async () => {
    const { tx, updateMany, create } = makeTx();
    await expect(transitionOrderStatus(tx, 'o1', 'delivered', 'out_for_delivery', actor)).rejects.toThrow(BusinessRuleError);
    expect(updateMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('V2: rejects delivered → picked_up (no write)', async () => {
    const { tx, updateMany } = makeTx();
    await expect(transitionOrderStatus(tx, 'o1', 'delivered', 'picked_up', actor)).rejects.toThrow(BusinessRuleError);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('V4: rejects delivered → cancelled (no write)', async () => {
    const { tx, updateMany } = makeTx();
    await expect(transitionOrderStatus(tx, 'o1', 'delivered', 'cancelled', actor)).rejects.toThrow(BusinessRuleError);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('also rejects cancelled → anything (terminal)', async () => {
    const { tx, updateMany } = makeTx();
    await expect(transitionOrderStatus(tx, 'o1', 'cancelled', 'confirmed', actor)).rejects.toThrow(BusinessRuleError);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('returns false (no history) when compare-and-set matches 0 rows (lost race)', async () => {
    const { tx, create } = makeTx(0);
    const ok = await transitionOrderStatus(tx, 'o1', 'out_for_delivery', 'delivered', actor);
    expect(ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('stamps cancelReason + cancelledAt on a cancel', async () => {
    const { tx, updateMany } = makeTx();
    await transitionOrderStatus(tx, 'o1', 'confirmed', 'cancelled', { role: 'admin', id: 'a1', reason: 'oops' });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'cancelled', cancelledAt: expect.any(Date), cancelReason: 'oops' }),
    }));
  });
});

// Guard the underlying state machine directly too (kept after the move to ./order-status).
describe('assertTransition (state machine)', () => {
  it('allows the legal forward path', () => {
    const path: Array<[string, string]> = [
      ['pending_payment', 'paid'], ['paid', 'confirmed'], ['confirmed', 'preparing'],
      ['preparing', 'ready_for_pickup'], ['ready_for_pickup', 'picked_up'],
      ['picked_up', 'out_for_delivery'], ['out_for_delivery', 'delivered'],
    ];
    for (const [from, to] of path) expect(() => assertTransition(from, to)).not.toThrow();
  });

  it('treats same-status as an idempotent no-op', () => {
    expect(() => assertTransition('confirmed', 'confirmed')).not.toThrow();
  });

  it('rejects terminal-state exits', () => {
    expect(() => assertTransition('delivered', 'out_for_delivery')).toThrow(BusinessRuleError);
    expect(() => assertTransition('delivered', 'cancelled')).toThrow(BusinessRuleError);
    expect(() => assertTransition('cancelled', 'confirmed')).toThrow(BusinessRuleError);
  });
});
