import { describe, it, expect } from 'vitest';
import { applyMarkup, computeFoodBill } from '../food-pricing';
import { DEFAULT_FOOD_CONFIG, mergeFoodConfig, type FoodConfig } from '../food-config';

// Food.md §5 — flat ₹30 fee + config-driven markup engine (0% at launch).
// All money integer paise; the engine must support percentage / fixed /
// per-restaurant / per-category via CONFIG ONLY (no code change).

const R = 'restaurant-1';
const C = 'category-1';

function cfgWith(markup: Partial<FoodConfig['markup']>): FoodConfig {
  return { ...DEFAULT_FOOD_CONFIG, markup: { ...DEFAULT_FOOD_CONFIG.markup, ...markup } };
}

describe('applyMarkup', () => {
  it('is identity at the launch default (0%) — customers see real menu prices', () => {
    expect(applyMarkup(18_000, DEFAULT_FOOD_CONFIG, { restaurantId: R })).toBe(18_000);
  });

  it('applies a default percentage markup', () => {
    const cfg = cfgWith({ defaultPercent: 10 });
    expect(applyMarkup(10_000, cfg, { restaurantId: R })).toBe(11_000);
  });

  it('applies a default fixed markup', () => {
    const cfg = cfgWith({ defaultFixedPaise: 500 });
    expect(applyMarkup(10_000, cfg, { restaurantId: R })).toBe(10_500);
  });

  it('per-category rule beats the default', () => {
    const cfg = cfgWith({ defaultPercent: 10, perCategory: { [C]: { percent: 20 } } });
    expect(applyMarkup(10_000, cfg, { restaurantId: R, menuCategoryId: C })).toBe(12_000);
  });

  it('per-restaurant rule beats per-category and default', () => {
    const cfg = cfgWith({
      defaultPercent: 10,
      perCategory:   { [C]: { percent: 20 } },
      perRestaurant: { [R]: { percent: 5 } },
    });
    expect(applyMarkup(10_000, cfg, { restaurantId: R, menuCategoryId: C })).toBe(10_500);
  });

  it('percent and fixed combine within one rule (percent first, then fixed)', () => {
    const cfg = cfgWith({ perRestaurant: { [R]: { percent: 10, fixedPaise: 300 } } });
    expect(applyMarkup(10_000, cfg, { restaurantId: R })).toBe(11_300);
  });

  it('rounds to integer paise and never goes negative', () => {
    const cfg = cfgWith({ defaultPercent: 3 });
    expect(applyMarkup(999, cfg, { restaurantId: R })).toBe(1_029); // 999*1.03 = 1028.97 → 1029
    const negative = cfgWith({ defaultFixedPaise: -50_000 });
    expect(applyMarkup(10_000, negative, { restaurantId: R })).toBe(0);
  });

  it('rejects non-integer / negative base prices at the boundary', () => {
    expect(() => applyMarkup(10.5 as number, DEFAULT_FOOD_CONFIG, { restaurantId: R })).toThrow();
    expect(() => applyMarkup(-100, DEFAULT_FOOD_CONFIG, { restaurantId: R })).toThrow();
  });
});

describe('computeFoodBill', () => {
  it('flat ₹30 delivery fee regardless of subtotal (Food.md §5)', () => {
    const small = computeFoodBill([{ unitPricePaise: 5_000, quantity: 1 }], DEFAULT_FOOD_CONFIG);
    const large = computeFoodBill([{ unitPricePaise: 50_000, quantity: 4 }], DEFAULT_FOOD_CONFIG);
    expect(small.deliveryFeePaise).toBe(3_000);
    expect(large.deliveryFeePaise).toBe(3_000);
    expect(small.totalPaise).toBe(8_000);
    expect(large.totalPaise).toBe(203_000);
  });

  it('the fee is config-driven, not hardcoded', () => {
    const cfg = { ...DEFAULT_FOOD_CONFIG, deliveryFeePaise: 4_500 };
    const bill = computeFoodBill([{ unitPricePaise: 10_000, quantity: 1 }], cfg);
    expect(bill.deliveryFeePaise).toBe(4_500);
    expect(bill.totalPaise).toBe(14_500);
  });

  it('rejects invalid lines at the boundary (financial safety)', () => {
    expect(() => computeFoodBill([{ unitPricePaise: 100.5, quantity: 1 }], DEFAULT_FOOD_CONFIG)).toThrow();
    expect(() => computeFoodBill([{ unitPricePaise: 100, quantity: 0 }], DEFAULT_FOOD_CONFIG)).toThrow();
    expect(() => computeFoodBill([{ unitPricePaise: -100, quantity: 1 }], DEFAULT_FOOD_CONFIG)).toThrow();
  });
});

describe('mergeFoodConfig — AppConfig override semantics', () => {
  it('falls back to defaults on garbage', () => {
    expect(mergeFoodConfig(null)).toEqual(DEFAULT_FOOD_CONFIG);
    expect(mergeFoodConfig('not json shape')).toEqual(DEFAULT_FOOD_CONFIG);
  });

  it('a partial override changes only its section', () => {
    const merged = mergeFoodConfig({ deliveryFeePaise: 2_000 });
    expect(merged.deliveryFeePaise).toBe(2_000);
    expect(merged.eta).toEqual(DEFAULT_FOOD_CONFIG.eta);
    expect(merged.cartPolicy.maxRestaurantsPerFoodOrder).toBe(1);
  });

  it('rejects a non-integer fee override (falls back to default)', () => {
    expect(mergeFoodConfig({ deliveryFeePaise: 29.99 }).deliveryFeePaise).toBe(3_000);
    expect(mergeFoodConfig({ deliveryFeePaise: -5 }).deliveryFeePaise).toBe(3_000);
  });

  it('cart policy cap is overridable — the multi-restaurant switch', () => {
    expect(mergeFoodConfig({ cartPolicy: { maxRestaurantsPerFoodOrder: 3 } }).cartPolicy.maxRestaurantsPerFoodOrder).toBe(3);
  });

  it('ops timings default sanely and are individually overridable (reconcile sweep)', () => {
    const d = mergeFoodConfig(null).ops;
    expect(d).toEqual({
      reconcileIntervalSeconds: 120,
      reconcileMinAgeSeconds: 180,
      pendingPaymentExpiryMinutes: 30,
      acceptTimeoutMinutes: 15,
    });
    const merged = mergeFoodConfig({ ops: { acceptTimeoutMinutes: 20 } }).ops;
    expect(merged.acceptTimeoutMinutes).toBe(20);
    expect(merged.pendingPaymentExpiryMinutes).toBe(30); // untouched sections keep defaults
  });
});
