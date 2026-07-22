import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INVENTORY_CONFIG, effectiveQty, confidence, beliefBand, projectStockStatus,
  type BeliefState,
} from '../belief';

const cfg = DEFAULT_INVENTORY_CONFIG;

const at = (iso: string): Date => new Date(iso);

function tracked(overrides: Partial<BeliefState> = {}): BeliefState {
  return {
    expectedQty: 50,
    reservedQty: 0,
    velocityClass: 3, // fast: τ=24h, vel=6/day
    confidenceBase: 0.95,
    lastVerifiedAt: at('2026-07-07T09:00:00Z'),
    ...overrides,
  };
}

describe('effectiveQty', () => {
  it('is null for untracked (binary) items — no numeric cap', () => {
    expect(effectiveQty(tracked({ expectedQty: null }), cfg, at('2026-07-07T18:00:00Z'))).toBeNull();
  });

  it('subtracts reservations and time-drift, ceil-buffered', () => {
    // 9h later, fast class: drift = 6 × 9/24 = 2.25 → ⌈2.25⌉ = 3
    const s = tracked({ reservedQty: 5 });
    expect(effectiveQty(s, cfg, at('2026-07-07T18:00:00Z'))).toBe(50 - 5 - 3);
  });

  it('floors at zero — never promises negative stock', () => {
    const s = tracked({ expectedQty: 2, reservedQty: 4 });
    expect(effectiveQty(s, cfg, at('2026-07-07T09:30:00Z'))).toBe(0);
  });

  it('applies no drift for the dead class (0)', () => {
    const s = tracked({ velocityClass: 0 });
    expect(effectiveQty(s, cfg, at('2026-08-07T09:00:00Z'))).toBe(50);
  });

  it('treats a never-verified tracked row as maximally stale but bounded', () => {
    const s = tracked({ lastVerifiedAt: null });
    expect(effectiveQty(s, cfg, at('2026-07-07T18:00:00Z'))).toBe(0);
  });
});

describe('confidence', () => {
  it('is 1 for untracked items (their gate is stockStatus, not confidence)', () => {
    expect(confidence(tracked({ expectedQty: null }), cfg, at('2026-07-08T09:00:00Z'))).toBe(1);
  });

  it('decays exponentially with hours since verification (design §4.2 worked example)', () => {
    // ultra class (τ=8h), base 0.95, 9 hours: 0.95 × e^(−9/8) ≈ 0.308
    const s = tracked({ velocityClass: 4 });
    const c = confidence(s, cfg, at('2026-07-07T18:00:00Z'));
    expect(c).toBeGreaterThan(0.30);
    expect(c).toBeLessThan(0.32);
  });

  it('does not decay for the dead class', () => {
    const s = tracked({ velocityClass: 0, confidenceBase: 0.9 });
    expect(confidence(s, cfg, at('2027-07-07T09:00:00Z'))).toBe(0.9);
  });

  it('is 0 for a never-verified tracked row', () => {
    expect(confidence(tracked({ lastVerifiedAt: null }), cfg, at('2026-07-07T10:00:00Z'))).toBe(0);
  });
});

describe('beliefBand — one predicate for visibility AND routing', () => {
  it('binary items are always normal (no decay machinery for the tail)', () => {
    const s = tracked({ expectedQty: null, lastVerifiedAt: null });
    expect(beliefBand(s, cfg, at('2027-01-01T00:00:00Z'))).toBe('normal');
  });

  it('fresh verified stock is normal', () => {
    expect(beliefBand(tracked(), cfg, at('2026-07-07T09:30:00Z'))).toBe('normal');
  });

  it('flags when confidence falls below θ_flag but above θ_hide', () => {
    // fast τ=24h, base 0.95: conf crosses 0.65 at t = 24·ln(0.95/0.65) ≈ 9.1h
    expect(beliefBand(tracked(), cfg, at('2026-07-07T19:30:00Z'))).toBe('flagged');
  });

  it('hides when confidence falls below θ_hide', () => {
    // conf crosses 0.40 at t = 24·ln(0.95/0.40) ≈ 20.8h
    expect(beliefBand(tracked(), cfg, at('2026-07-08T07:00:00Z'))).toBe('hidden');
  });

  it('hides when everything is reserved (nothing left to promise)', () => {
    const s = tracked({ reservedQty: 50 });
    expect(beliefBand(s, cfg, at('2026-07-07T09:05:00Z'))).toBe('hidden');
  });
});

describe('projectStockStatus', () => {
  it('never touches the merchandising hidden state', () => {
    expect(projectStockStatus('hidden', 'normal')).toBe('hidden');
    expect(projectStockStatus('hidden', 'hidden')).toBe('hidden');
  });

  it('maps hidden band to out_of_stock, everything else to available', () => {
    expect(projectStockStatus('available', 'hidden')).toBe('out_of_stock');
    expect(projectStockStatus('out_of_stock', 'normal')).toBe('available');
    expect(projectStockStatus('out_of_stock', 'flagged')).toBe('available');
  });
});
