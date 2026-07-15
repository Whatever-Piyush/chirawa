import { describe, it, expect } from 'vitest';
import { OrderStatus } from '@chirawa/types';
import {
  resolveLiveOrderState,
  filledTicks,
  selectFeatured,
  activeCount,
  TOTAL_TICKS,
} from './liveOrder';

describe('resolveLiveOrderState', () => {
  it('maps every OrderStatus to a valid state', () => {
    for (const status of Object.values(OrderStatus)) {
      const s = resolveLiveOrderState(status);
      expect(s.step).toBeGreaterThanOrEqual(0);
      expect(s.step).toBeLessThanOrEqual(4);
      expect(s.captionKey.startsWith('liveOrder.')).toBe(true);
      expect(s.icon.length).toBeGreaterThan(0);
      expect(['primary', 'success', 'warning']).toContain(s.tone);
    }
  });

  it('collapses statuses to the tracking screen 5-phase steps', () => {
    expect(resolveLiveOrderState(OrderStatus.PENDING_PAYMENT).step).toBe(0);
    expect(resolveLiveOrderState(OrderStatus.PAID).step).toBe(0);
    expect(resolveLiveOrderState(OrderStatus.CONFIRMED).step).toBe(0);
    expect(resolveLiveOrderState(OrderStatus.PREPARING).step).toBe(1);
    expect(resolveLiveOrderState(OrderStatus.READY_FOR_PICKUP).step).toBe(1);
    expect(resolveLiveOrderState(OrderStatus.PICKED_UP).step).toBe(2);
    expect(resolveLiveOrderState(OrderStatus.OUT_FOR_DELIVERY).step).toBe(3);
    expect(resolveLiveOrderState(OrderStatus.DELIVERED).step).toBe(4);
  });

  it('uses warning tone for payment-due and success for delivered', () => {
    expect(resolveLiveOrderState(OrderStatus.PENDING_PAYMENT).tone).toBe('warning');
    expect(resolveLiveOrderState(OrderStatus.DELIVERED).tone).toBe('success');
    expect(resolveLiveOrderState(OrderStatus.OUT_FOR_DELIVERY).tone).toBe('primary');
  });

  it('never uses an emoji glyph for the icon', () => {
    for (const status of Object.values(OrderStatus)) {
      const { icon } = resolveLiveOrderState(status);
      // Ionicons names are ascii kebab-case; emoji would fail this.
      expect(/^[a-z-]+$/.test(icon)).toBe(true);
    }
  });
});

describe('filledTicks', () => {
  it('fills one tick per phase', () => {
    expect(filledTicks(0)).toBe(1);
    expect(filledTicks(1)).toBe(2);
    expect(filledTicks(2)).toBe(3);
    expect(filledTicks(3)).toBe(4);
    expect(filledTicks(4)).toBe(TOTAL_TICKS);
  });

  it('clamps out-of-range input', () => {
    expect(filledTicks(-5)).toBe(1);
    expect(filledTicks(99)).toBe(TOTAL_TICKS);
  });
});

describe('selectFeatured', () => {
  it('returns null for an empty feed', () => {
    expect(selectFeatured([])).toBeNull();
  });

  it('features the newest (first) entry', () => {
    expect(selectFeatured(['newest', 'older'])).toBe('newest');
  });
});

describe('activeCount', () => {
  it('counts entries', () => {
    expect(activeCount([])).toBe(0);
    expect(activeCount([1, 2, 3])).toBe(3);
  });
});
