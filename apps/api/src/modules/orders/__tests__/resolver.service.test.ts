import { describe, it, expect } from 'vitest';
import { resolveAggregatedLines, type AggLine, type Candidate } from '../resolver.service';

// Delivery point at the origin; shops are placed by latitude so distance ranks
// by |lat| (bigger lat = farther) — lets the nearest-tiebreak be controlled.
const HERE = { lat: 0, lng: 0 };

const line = (key: string, masterId: string, over: Partial<AggLine> = {}): AggLine => ({
  key, masterId, quantity: 1, displayedUnitPrice: 100, ...over,
});
const cand = (shopId: string, productId: string, price: number, over: Partial<Candidate> = {}): Candidate => ({
  shopId, productId, price, effectiveQty: null, lat: 0, lng: 0, ...over,
});

describe('resolveAggregatedLines — shop cap + trace (Inventory Engine)', () => {
  it('drops lines the maxShops cap cannot cover instead of opening a third shop', () => {
    // Three lines, each only available at a DIFFERENT shop → needs 3 shops.
    const lines = [line('x', 'mX'), line('y', 'mY'), line('z', 'mZ')];
    const candidates = new Map<string, Candidate[]>([
      ['mX', [cand('A', 'pX', 100)]],
      ['mY', [cand('B', 'pY', 100)]],
      ['mZ', [cand('C', 'pZ', 100)]],
    ]);
    const { assignments, dropped, trace } = resolveAggregatedLines(lines, candidates, HERE, { maxShops: 2 });
    expect(assignments.size).toBe(2);
    expect(dropped).toHaveLength(1);
    expect(trace.maxShops).toBe(2);
    expect(trace.chosen).toHaveLength(2);
  });

  it('records every candidate with its viability in the trace', () => {
    const lines = [line('x', 'mX', { quantity: 5 })];
    const candidates = new Map<string, Candidate[]>([
      ['mX', [cand('SHORT', 'pS', 80, { effectiveQty: 2, confidence: 0.9 }), cand('FULL', 'pF', 90, { effectiveQty: 8, confidence: 0.7 })]],
    ]);
    const { assignments, trace } = resolveAggregatedLines(lines, candidates, HERE);
    expect(assignments.get('x')?.shopId).toBe('FULL');
    expect(trace.lines[0]!.candidates).toEqual([
      expect.objectContaining({ shopId: 'SHORT', viable: false }),
      expect.objectContaining({ shopId: 'FULL', viable: true, confidence: 0.7 }),
    ]);
  });
});

describe('resolveAggregatedLines (Phase 5 checkout resolver)', () => {
  it('routes lines through the FEWEST shops — one shop covering both lines wins', () => {
    const lines = [line('x', 'mX'), line('y', 'mY', { displayedUnitPrice: 50 })];
    const candidates = new Map<string, Candidate[]>([
      ['mX', [cand('A', 'pXA', 100), cand('B', 'pXB', 100)]],
      ['mY', [cand('A', 'pYA', 50), cand('C', 'pYC', 50)]],
    ]);
    const { assignments, dropped } = resolveAggregatedLines(lines, candidates, HERE);

    expect(dropped).toEqual([]);
    // Shop A carries both at the cheapest price → both routed to A (one shop).
    expect(assignments.get('x')).toEqual({ shopId: 'A', productId: 'pXA', unitPrice: 100 });
    expect(assignments.get('y')).toEqual({ shopId: 'A', productId: 'pYA', unitPrice: 50 });
    expect(new Set([...assignments.values()].map((a) => a.shopId))).toEqual(new Set(['A']));
  });

  it('breaks coverage ties by NEAREST shop to the delivery point', () => {
    const lines = [line('x', 'mX')];
    const candidates = new Map<string, Candidate[]>([
      ['mX', [cand('FAR', 'pFar', 100, { lat: 0.5 }), cand('NEAR', 'pNear', 100, { lat: 0.01 })]],
    ]);
    const { assignments } = resolveAggregatedLines(lines, candidates, HERE);
    expect(assignments.get('x')?.shopId).toBe('NEAR');
  });

  it('NEVER overcharges with the default (0) tolerance — a pricier shop is not merged', () => {
    // Line Y is only at shop B (₹50). Shop B also has X but pricier (₹110 vs A's ₹100).
    const lines = [line('x', 'mX'), line('y', 'mY', { displayedUnitPrice: 50 })];
    const candidates = new Map<string, Candidate[]>([
      ['mX', [cand('A', 'pXA', 100), cand('B', 'pXB', 110)]],
      ['mY', [cand('B', 'pYB', 50)]],
    ]);
    const { assignments } = resolveAggregatedLines(lines, candidates, HERE);
    // X stays at its cheapest shop A (100), even though it costs a second shop.
    expect(assignments.get('x')).toEqual({ shopId: 'A', productId: 'pXA', unitPrice: 100 });
    expect(assignments.get('y')).toEqual({ shopId: 'B', productId: 'pYB', unitPrice: 50 });
  });

  it('merges onto a slightly-pricier shop WITHIN tolerance to save a shop', () => {
    const lines = [line('x', 'mX'), line('y', 'mY', { displayedUnitPrice: 50 })];
    const candidates = new Map<string, Candidate[]>([
      ['mX', [cand('A', 'pXA', 100), cand('B', 'pXB', 110)]],
      ['mY', [cand('B', 'pYB', 50)]],
    ]);
    const { assignments } = resolveAggregatedLines(lines, candidates, HERE, { priceTolerancePaise: 10 });
    // Now B covers both (X @110 ≤ 100+10) → one shop; X charged 110 (within tolerance).
    expect(assignments.get('x')).toEqual({ shopId: 'B', productId: 'pXB', unitPrice: 110 });
    expect(assignments.get('y')).toEqual({ shopId: 'B', productId: 'pYB', unitPrice: 50 });
  });

  it('drops a line nobody has in stock', () => {
    const lines = [line('x', 'mX'), line('z', 'mZ')];
    const candidates = new Map<string, Candidate[]>([['mX', [cand('A', 'pXA', 100)]]]); // no mZ
    const { assignments, dropped } = resolveAggregatedLines(lines, candidates, HERE);
    expect(dropped).toEqual(['z']);
    expect(assignments.has('z')).toBe(false);
    expect(assignments.get('x')?.shopId).toBe('A');
  });

  it('respects tracked stock — a candidate without enough qty is not viable', () => {
    const lines = [line('x', 'mX', { quantity: 5 })];
    const candidates = new Map<string, Candidate[]>([
      // Cheapest shop only has 3 (not enough); the in-stock fallback has unlimited.
      ['mX', [cand('LOW', 'pLow', 80, { effectiveQty: 3 }), cand('OK', 'pOk', 100, { effectiveQty: null })]],
    ]);
    const { assignments, dropped } = resolveAggregatedLines(lines, candidates, HERE);
    expect(dropped).toEqual([]);
    expect(assignments.get('x')).toEqual({ shopId: 'OK', productId: 'pOk', unitPrice: 100 });
  });

  it('drops a line when no candidate can cover the requested quantity', () => {
    const lines = [line('x', 'mX', { quantity: 9 })];
    const candidates = new Map<string, Candidate[]>([['mX', [cand('LOW', 'pLow', 80, { effectiveQty: 3 })]]]);
    const { assignments, dropped } = resolveAggregatedLines(lines, candidates, HERE);
    expect(dropped).toEqual(['x']);
    expect(assignments.size).toBe(0);
  });
});
