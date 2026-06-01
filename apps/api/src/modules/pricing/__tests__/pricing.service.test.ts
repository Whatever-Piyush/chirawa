import { describe, it, expect } from 'vitest';
import {
  calculateFlatFee,
  calculateDeliveryFee,
  FEE_SMALL_CART_PAISE,
  FEE_STANDARD_PAISE,
  FEE_SPECIAL_PAISE,
  MIN_CART_FOR_STANDARD_FEE_PAISE,
} from '../pricing.service';
import { ValidationError } from '../../../shared/errors/app-errors';

// ─── calculateFlatFee — pure function tests ───────────────────────────────────
// Chirawa flat pricing:
//   cart < ₹100            → ₹25 (2500p)
//   cart ≥ ₹100, regular   → ₹10 (1000p)
//   cart ≥ ₹100, special   → ₹15 (1500p)

describe('calculateFlatFee', () => {
  describe('cart below ₹100 (< 10000p) → ₹25', () => {
    it('returns 2500 for cart = 0 (regular or special)', () => {
      expect(calculateFlatFee(0, false)).toBe(2500);
      expect(calculateFlatFee(0, true)).toBe(2500); // small-cart fee dominates
    });
    it('returns 2500 for cart = 9999p (₹99.99)', () => {
      expect(calculateFlatFee(9999, false)).toBe(2500);
      expect(calculateFlatFee(9999, true)).toBe(2500);
    });
  });

  describe('cart ≥ ₹100, regular shop → ₹10', () => {
    it('returns 1000 at exactly ₹100', () => {
      expect(calculateFlatFee(10000, false)).toBe(1000);
    });
    it('returns 1000 for large carts', () => {
      expect(calculateFlatFee(50000, false)).toBe(1000);
      expect(calculateFlatFee(100000, false)).toBe(1000);
    });
  });

  describe('cart ≥ ₹100, Chirawa Special shop → ₹15', () => {
    it('returns 1500 at exactly ₹100', () => {
      expect(calculateFlatFee(10000, true)).toBe(1500);
    });
    it('returns 1500 for large carts', () => {
      expect(calculateFlatFee(50000, true)).toBe(1500);
    });
  });

  describe('boundary: exactly the ₹100 threshold', () => {
    it('one paise below threshold is small-cart fee', () => {
      expect(calculateFlatFee(MIN_CART_FOR_STANDARD_FEE_PAISE - 1, false)).toBe(FEE_SMALL_CART_PAISE);
    });
    it('exactly at threshold is standard/special', () => {
      expect(calculateFlatFee(MIN_CART_FOR_STANDARD_FEE_PAISE, false)).toBe(FEE_STANDARD_PAISE);
      expect(calculateFlatFee(MIN_CART_FOR_STANDARD_FEE_PAISE, true)).toBe(FEE_SPECIAL_PAISE);
    });
  });
});

// ─── calculateDeliveryFee — validation + result shape ─────────────────────────

describe('calculateDeliveryFee', () => {
  it('returns correct result for a standard order', () => {
    const result = calculateDeliveryFee({
      cartSubtotalPaise: 15000,
      hasSpecialShop: false,
      ruleVersion: 1,
    });
    expect(result.feePaise).toBe(1000);
    expect(result.ruleVersion).toBe(1);
    expect(result.breakdownHindi).toContain('₹10');
  });

  it('returns ₹15 for a Chirawa Special order', () => {
    const result = calculateDeliveryFee({
      cartSubtotalPaise: 15000,
      hasSpecialShop: true,
      ruleVersion: 1,
    });
    expect(result.feePaise).toBe(1500);
    expect(result.breakdownHindi).toContain('Special');
  });

  it('returns ₹25 for a small cart', () => {
    const result = calculateDeliveryFee({
      cartSubtotalPaise: 5000,
      hasSpecialShop: false,
      ruleVersion: 1,
    });
    expect(result.feePaise).toBe(2500);
  });

  it('throws ValidationError for float cartSubtotalPaise', () => {
    expect(() =>
      calculateDeliveryFee({ cartSubtotalPaise: 100.5, hasSpecialShop: false, ruleVersion: 1 }),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for negative cartSubtotalPaise', () => {
    expect(() =>
      calculateDeliveryFee({ cartSubtotalPaise: -1, hasSpecialShop: false, ruleVersion: 1 }),
    ).toThrow(ValidationError);
  });

  it('never produces fractional paise', () => {
    const cases = [0, 9999, 10000, 30000, 100000];
    cases.forEach((cart) => {
      [true, false].forEach((special) => {
        const result = calculateDeliveryFee({
          cartSubtotalPaise: cart,
          hasSpecialShop: special,
          ruleVersion: 1,
        });
        expect(Number.isInteger(result.feePaise)).toBe(true);
      });
    });
  });
});
