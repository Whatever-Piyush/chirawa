import { describe, it, expect, vi } from 'vitest';
import { track, onAnalytics } from './analytics.service';

describe('analytics.service', () => {
  it('fans events out to registered sinks with props', () => {
    const sink = vi.fn();
    const off = onAnalytics(sink);

    track('tracking_bubble_pressed', { orderId: 'o1', phase: 3 });

    expect(sink).toHaveBeenCalledWith('tracking_bubble_pressed', { orderId: 'o1', phase: 3 });
    off();
  });

  it('stops delivering after unsubscribe', () => {
    const sink = vi.fn();
    const off = onAnalytics(sink);
    off();

    track('bubble_hidden', { reason: 'route' });

    expect(sink).not.toHaveBeenCalled();
  });

  it('isolates a throwing sink from others', () => {
    const bad = onAnalytics(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const offGood = onAnalytics(good);

    expect(() => track('tracking_opened', { orderId: 'o1' })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);

    bad();
    offGood();
  });
});
