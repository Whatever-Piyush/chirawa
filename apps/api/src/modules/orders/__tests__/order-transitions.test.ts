import { describe, it, expect } from 'vitest';
import { assertTransition } from '../orders.service';
import { BusinessRuleError } from '../../../shared/errors/app-errors';

describe('assertTransition (Phase 1.7 order state machine)', () => {
  it('allows the legal happy-path transitions', () => {
    const path: Array<[string, string]> = [
      ['pending_payment', 'paid'],
      ['paid', 'confirmed'],
      ['confirmed', 'preparing'],
      ['preparing', 'ready_for_pickup'],
      ['ready_for_pickup', 'picked_up'],
      ['picked_up', 'out_for_delivery'],
      ['out_for_delivery', 'delivered'],
    ];
    for (const [from, to] of path) expect(() => assertTransition(from, to)).not.toThrow();
  });

  it('allows cancellation from any pre-pickup state', () => {
    for (const from of ['pending_payment', 'paid', 'confirmed', 'preparing']) {
      expect(() => assertTransition(from, 'cancelled')).not.toThrow();
    }
  });

  it('treats a same-status write as an idempotent no-op (COD re-accept)', () => {
    expect(() => assertTransition('confirmed', 'confirmed')).not.toThrow();
  });

  it('rejects skipping a step (confirmed → ready_for_pickup)', () => {
    expect(() => assertTransition('confirmed', 'ready_for_pickup')).toThrow(BusinessRuleError);
  });

  it('rejects moving out of a terminal state', () => {
    expect(() => assertTransition('delivered', 'preparing')).toThrow(BusinessRuleError);
    expect(() => assertTransition('cancelled', 'confirmed')).toThrow(BusinessRuleError);
  });

  it('rejects backwards transitions', () => {
    expect(() => assertTransition('preparing', 'confirmed')).toThrow(BusinessRuleError);
    expect(() => assertTransition('out_for_delivery', 'picked_up')).toThrow(BusinessRuleError);
  });
});
