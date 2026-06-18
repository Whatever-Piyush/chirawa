import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderEtaChanged: vi.fn(),
}));

import * as eventBus from '../../../shared/events/event-bus';
import { computeEta, computeAndPersistEta, etaResponse } from '../eta.service';

const emit = vi.mocked(eventBus.emitOrderEtaChanged);
const NOW = new Date('2026-06-18T10:00:00.000Z');
const minutesFromNow = (d: Date) => Math.round((d.getTime() - NOW.getTime()) / 60_000);

describe('computeEta (pure)', () => {
  it('placement (confirmed): full prep + travel(legKm) + dwell + handover', () => {
    const r = computeEta({ status: 'confirmed', sellerAcceptedAt: null, preparingAt: null, legKm: 2, prepTimeMinutes: 8, now: NOW })!;
    // prep 8 + travel 2/14*60≈8.57 + dwell(3)+handover(2)=5 ≈ 21–22 min
    expect(minutesFromNow(r.estimatedDeliveryAt)).toBeGreaterThanOrEqual(20);
    expect(minutesFromNow(r.estimatedDeliveryAt)).toBeLessThanOrEqual(23);
    expect(r.etaSource).toBe('prep_road');
    expect(r.etaSpreadSeconds).toBe(300);
  });

  it('preparing: prep decremented from preparingAt', () => {
    const startedAt = new Date(NOW.getTime() - 3 * 60_000); // 3 min into prep
    const r = computeEta({ status: 'preparing', sellerAcceptedAt: startedAt, preparingAt: startedAt, legKm: 2, prepTimeMinutes: 8, now: NOW })!;
    // prep remaining ~5 + travel ~8.57 + dwell 5 ≈ 18–19
    expect(minutesFromNow(r.estimatedDeliveryAt)).toBeGreaterThanOrEqual(17);
    expect(minutesFromNow(r.estimatedDeliveryAt)).toBeLessThanOrEqual(20);
  });

  it('ready_for_pickup: prep is zero', () => {
    const r = computeEta({ status: 'ready_for_pickup', sellerAcceptedAt: null, preparingAt: null, legKm: 2, prepTimeMinutes: 8, now: NOW })!;
    // 0 prep + ~8.57 travel + 5 dwell ≈ 13–14
    expect(minutesFromNow(r.estimatedDeliveryAt)).toBeLessThanOrEqual(15);
    expect(minutesFromNow(r.estimatedDeliveryAt)).toBeGreaterThanOrEqual(12);
  });

  it('out_for_delivery: prep zero, no pickup-dwell, tighter spread', () => {
    const r = computeEta({ status: 'out_for_delivery', sellerAcceptedAt: null, preparingAt: null, legKm: 2, prepTimeMinutes: 8, now: NOW })!;
    // 0 prep + ~8.57 travel + handover 2 ≈ 10–11; spread ±120s
    expect(minutesFromNow(r.estimatedDeliveryAt)).toBeLessThanOrEqual(12);
    expect(r.etaSpreadSeconds).toBe(120);
  });

  it('terminal states return null (no ETA)', () => {
    for (const status of ['delivered', 'cancelled']) {
      expect(computeEta({ status, sellerAcceptedAt: null, preparingAt: null, legKm: 2, prepTimeMinutes: 8, now: NOW })).toBeNull();
    }
  });

  // P1 #6: a known leg of 0 (customer at the shop) is distance-based, NOT fallback.
  it('legKm = 0 is a valid (very short) distance — distance-based, not fallback', () => {
    const r = computeEta({ status: 'confirmed', sellerAcceptedAt: null, preparingAt: null, legKm: 0, prepTimeMinutes: 8, now: NOW })!;
    expect(r.etaSource).toBe('prep_road');
    expect(r.etaSpreadSeconds).toBe(300);
  });

  // Fallback applies ONLY when the leg is unknown (coords missing).
  it('legKm = null (coords missing) falls back to a wide range', () => {
    const r = computeEta({ status: 'confirmed', sellerAcceptedAt: null, preparingAt: null, legKm: null, prepTimeMinutes: 8, now: NOW })!;
    expect(r.etaSource).toBe('fallback');
    expect(r.etaSpreadSeconds).toBe(600);
  });

  it('floors the ETA to the minimum minutes for tiny distances', () => {
    // out_for_delivery + 0 leg ⇒ raw total (handover only) is below the floor → floored.
    const r = computeEta({ status: 'out_for_delivery', sellerAcceptedAt: null, preparingAt: null, legKm: 0, prepTimeMinutes: 0, now: NOW })!;
    expect(minutesFromNow(r.estimatedDeliveryAt)).toBeGreaterThanOrEqual(5);
  });
});

describe('etaResponse (GET serialization)', () => {
  it('returns a duration + serverNow for a live order', () => {
    const eta = etaResponse({ status: 'out_for_delivery', estimatedDeliveryAt: new Date(Date.now() + 600_000), etaSpreadSeconds: 120, etaSource: 'prep_road' })!;
    expect(eta.secondsRemaining).toBeGreaterThan(0);
    expect(eta.spreadSeconds).toBe(120);
    expect(typeof eta.serverNow).toBe('string');
    expect(eta.source).toBe('prep_road');
  });
  it('omits for terminal or unset orders', () => {
    expect(etaResponse({ status: 'delivered', estimatedDeliveryAt: new Date(), etaSpreadSeconds: 120, etaSource: 'prep_road' })).toBeUndefined();
    expect(etaResponse({ status: 'out_for_delivery', estimatedDeliveryAt: null, etaSpreadSeconds: null, etaSource: null })).toBeUndefined();
  });
});

describe('computeAndPersistEta (persist + emit, best-effort)', () => {
  beforeEach(() => { emit.mockClear(); });

  // Shop at (28.239, 75.639); drop ~2 km north → a real, non-fallback leg from coords.
  const SHOP = { prepTimeMinutes: 8, lat: 28.239, lng: 75.639 };
  const liveOrder = (over: Record<string, unknown> = {}) => ({
    status: 'out_for_delivery', customerId: 'c1', sellerAcceptedAt: null, preparingAt: null,
    deliveryLat: 28.257, deliveryLng: 75.639, shop: SHOP, ...over,
  });

  function makePrisma(order: unknown) {
    const update = vi.fn().mockResolvedValue({});
    const find = vi.fn().mockResolvedValue(order);
    const prisma = {
      order: { findUnique: find, update },
    } as unknown as Parameters<typeof computeAndPersistEta>[0];
    return { prisma, update, find };
  }

  it('derives the leg from coordinates and persists a distance-based (non-fallback) ETA', async () => {
    const { prisma, update, find } = makePrisma(liveOrder());
    await computeAndPersistEta(prisma, 'order_1');
    // selects the coordinates it needs (no reliance on billing distanceKm)
    expect(find).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ deliveryLat: true, deliveryLng: true, shop: expect.anything() }),
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order_1' },
      data: expect.objectContaining({ estimatedDeliveryAt: expect.any(Date), etaSource: 'prep_road' }),
    }));
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('skips terminal orders (no update, no emit)', async () => {
    const { prisma, update } = makePrisma(liveOrder({ status: 'delivered' }));
    await computeAndPersistEta(prisma, 'order_1');
    expect(update).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('swallows errors — never throws to the caller (best-effort)', async () => {
    const prisma = { order: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) } } as unknown as Parameters<typeof computeAndPersistEta>[0];
    await expect(computeAndPersistEta(prisma, 'order_1')).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });
});
