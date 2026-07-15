import { describe, it, expect, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  FOOD_ORDER_TRANSITIONS, assertFoodTransition, transitionFoodOrderStatus,
} from '../food-status';

// Food.md §6 — the food order lifecycle mirrors the marketplace status SHAPE
// against food_orders: legal hops only, same-status idempotent, atomic CAS.

describe('assertFoodTransition', () => {
  it('allows the full restaurant flow in order', () => {
    const flow = [
      'pending_payment', 'paid', 'confirmed', 'preparing',
      'ready_for_pickup', 'picked_up', 'out_for_delivery', 'delivered',
    ];
    for (let i = 0; i < flow.length - 1; i++) {
      expect(() => assertFoodTransition(flow[i]!, flow[i + 1]!)).not.toThrow();
    }
  });

  it('allows cancellation from every non-terminal state', () => {
    for (const from of Object.keys(FOOD_ORDER_TRANSITIONS)) {
      if (from === 'delivered' || from === 'cancelled') continue;
      expect(() => assertFoodTransition(from, 'cancelled')).not.toThrow();
    }
  });

  it('rejects skipping a step (paid → preparing)', () => {
    expect(() => assertFoodTransition('paid', 'preparing')).toThrow();
  });

  it('rejects moving backwards (preparing → paid)', () => {
    expect(() => assertFoodTransition('preparing', 'paid')).toThrow();
  });

  it('rejects leaving terminal states', () => {
    expect(() => assertFoodTransition('delivered', 'cancelled')).toThrow();
    expect(() => assertFoodTransition('cancelled', 'paid')).toThrow();
  });

  it('same-status is an idempotent no-op (double-tapped Accept)', () => {
    expect(() => assertFoodTransition('confirmed', 'confirmed')).not.toThrow();
  });
});

describe('transitionFoodOrderStatus — atomic CAS + history', () => {
  function mockTx(updateCount: number) {
    const updateMany = vi.fn().mockResolvedValue({ count: updateCount });
    const create = vi.fn().mockResolvedValue({});
    const tx = {
      foodOrder: { updateMany },
      foodOrderStatusHistory: { create },
    } as unknown as Prisma.TransactionClient;
    return { tx, updateMany, create };
  }

  it('flips the row, stamps the status timestamp, and writes history', async () => {
    const { tx, updateMany, create } = mockTx(1);
    const ok = await transitionFoodOrderStatus(tx, 'order-1', 'paid', 'confirmed', { role: 'seller', id: 'seller-1' });
    expect(ok).toBe(true);

    const call = updateMany.mock.calls[0]![0] as { where: unknown; data: Record<string, unknown> };
    expect(call.where).toEqual({ id: 'order-1', status: 'paid' });
    expect(call.data['status']).toBe('confirmed');
    expect(call.data['confirmedAt']).toBeInstanceOf(Date);
    expect(create).toHaveBeenCalledOnce();
  });

  it('returns false on a lost race (count 0) without writing history', async () => {
    const { tx, create } = mockTx(0);
    const ok = await transitionFoodOrderStatus(tx, 'order-1', 'paid', 'confirmed', { role: 'seller', id: 'seller-1' });
    expect(ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('throws BEFORE any write on an illegal transition', async () => {
    const { tx, updateMany } = mockTx(1);
    await expect(
      transitionFoodOrderStatus(tx, 'order-1', 'paid', 'delivered', { role: 'rider', id: 'r1' }),
    ).rejects.toThrow();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('stamps cancelReason when cancelling with a reason', async () => {
    const { tx, updateMany } = mockTx(1);
    await transitionFoodOrderStatus(tx, 'order-1', 'paid', 'cancelled',
      { role: 'seller', id: 's1', reason: 'restaurant_rejected' });
    const call = updateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data['cancelReason']).toBe('restaurant_rejected');
    expect(call.data['cancelledAt']).toBeInstanceOf(Date);
  });

  it('merges extraData into the update (e.g. razorpayPaymentId on paid)', async () => {
    const { tx, updateMany } = mockTx(1);
    await transitionFoodOrderStatus(tx, 'order-1', 'pending_payment', 'paid',
      { role: 'customer', id: 'c1' }, { razorpayPaymentId: 'pay_123' });
    const call = updateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data['razorpayPaymentId']).toBe('pay_123');
    expect(call.data['paidAt']).toBeInstanceOf(Date);
  });
});
