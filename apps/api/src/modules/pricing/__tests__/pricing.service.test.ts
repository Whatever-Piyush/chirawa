import { describe, it, expect } from 'vitest';
import { calculateFeeV1, calculateDeliveryFee } from '../pricing.service';
import { ValidationError } from '../../../shared/errors/app-errors';

// ─── calculateFeeV1 — pure function tests ─────────────────────────────────────

describe('calculateFeeV1', () => {

  // ── Long distance (> 4000m) — cart value irrelevant ───────────────────────
  describe('long distance (distanceMetres > 4000)', () => {
    it('returns ₹25 (2500p) for distance 4001m, any cart value', () => {
      expect(calculateFeeV1(0,      4001)).toBe(2500);
      expect(calculateFeeV1(5000,   4001)).toBe(2500);
      expect(calculateFeeV1(15000,  4001)).toBe(2500);
      expect(calculateFeeV1(50000,  4001)).toBe(2500);
    });

    it('returns ₹25 for large distances', () => {
      expect(calculateFeeV1(100000, 10000)).toBe(2500);
      expect(calculateFeeV1(0,      99999)).toBe(2500);
    });
  });

  // ── Short distance (≤ 4000m) — cart band determines fee ───────────────────
  describe('short distance (distanceMetres ≤ 4000)', () => {

    describe('cart < ₹100 (< 10000p) → ₹20 (2000p)', () => {
      it('returns 2000 for cart = 0', () => {
        expect(calculateFeeV1(0, 1000)).toBe(2000);
      });
      it('returns 2000 for cart = 9999p (₹99.99)', () => {
        expect(calculateFeeV1(9999, 4000)).toBe(2000);
      });
      it('returns 2000 for cart = 1p', () => {
        expect(calculateFeeV1(1, 2000)).toBe(2000);
      });
    });

    describe('cart ₹100–₹300 (10000p–30000p inclusive) → ₹15 (1500p)', () => {
      it('returns 1500 for cart = 10000p (exactly ₹100)', () => {
        expect(calculateFeeV1(10000, 1000)).toBe(1500);
      });
      it('returns 1500 for cart = 20000p (₹200)', () => {
        expect(calculateFeeV1(20000, 500)).toBe(1500);
      });
      it('returns 1500 for cart = 30000p (exactly ₹300)', () => {
        expect(calculateFeeV1(30000, 4000)).toBe(1500);
      });
    });

    describe('cart > ₹300 (> 30000p) → ₹10 (1000p)', () => {
      it('returns 1000 for cart = 30001p (₹300.01)', () => {
        expect(calculateFeeV1(30001, 1000)).toBe(1000);
      });
      it('returns 1000 for cart = 50000p (₹500)', () => {
        expect(calculateFeeV1(50000, 2000)).toBe(1000);
      });
      it('returns 1000 for cart = 100000p (₹1000)', () => {
        expect(calculateFeeV1(100000, 3999)).toBe(1000);
      });
    });
  });

  // ── Boundary: exactly 4000m (≤ 4000, NOT long distance) ──────────────────
  describe('boundary: distance exactly 4000m', () => {
    it('at 4000m uses cart bands, not long-distance rate', () => {
      expect(calculateFeeV1(5000,  4000)).toBe(2000); // cart < ₹100
      expect(calculateFeeV1(15000, 4000)).toBe(1500); // ₹100–₹300
      expect(calculateFeeV1(50000, 4000)).toBe(1000); // > ₹300
    });
  });
});

// ─── calculateDeliveryFee — input validation tests ────────────────────────────

describe('calculateDeliveryFee', () => {

  it('returns correct result for valid inputs', () => {
    const result = calculateDeliveryFee({
      cartSubtotalPaise: 15000,
      distanceMetres: 2000,
      ruleVersion: 1,
    });
    expect(result.feePaise).toBe(1500);
    expect(result.ruleVersion).toBe(1);
    expect(result.distanceKm).toBe(2);
    expect(result.breakdownHindi).toContain('₹15');
  });

  it('throws ValidationError for float cartSubtotalPaise', () => {
    expect(() =>
      calculateDeliveryFee({ cartSubtotalPaise: 100.5, distanceMetres: 1000, ruleVersion: 1 })
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for negative cartSubtotalPaise', () => {
    expect(() =>
      calculateDeliveryFee({ cartSubtotalPaise: -1, distanceMetres: 1000, ruleVersion: 1 })
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for negative distanceMetres', () => {
    expect(() =>
      calculateDeliveryFee({ cartSubtotalPaise: 10000, distanceMetres: -1, ruleVersion: 1 })
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for NaN distanceMetres', () => {
    expect(() =>
      calculateDeliveryFee({ cartSubtotalPaise: 10000, distanceMetres: NaN, ruleVersion: 1 })
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for Infinity distanceMetres', () => {
    expect(() =>
      calculateDeliveryFee({ cartSubtotalPaise: 10000, distanceMetres: Infinity, ruleVersion: 1 })
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for unknown rule version', () => {
    expect(() =>
      calculateDeliveryFee({ cartSubtotalPaise: 10000, distanceMetres: 1000, ruleVersion: 99 })
    ).toThrow(ValidationError);
  });

  it('cart = 0, distance = 0 → ₹20 (cart < ₹100, short distance)', () => {
    const result = calculateDeliveryFee({
      cartSubtotalPaise: 0, distanceMetres: 0, ruleVersion: 1,
    });
    expect(result.feePaise).toBe(2000);
  });

  // Verify NO floating point arithmetic anywhere
  it('never produces fractional paise', () => {
    const testCases = [
      { cart: 9999,  dist: 3999 },
      { cart: 10000, dist: 4000 },
      { cart: 30000, dist: 4001 },
      { cart: 30001, dist: 1    },
    ];
    testCases.forEach(({ cart, dist }) => {
      const result = calculateDeliveryFee({
        cartSubtotalPaise: cart, distanceMetres: dist, ruleVersion: 1,
      });
      expect(Number.isInteger(result.feePaise)).toBe(true);
    });
  });
});
