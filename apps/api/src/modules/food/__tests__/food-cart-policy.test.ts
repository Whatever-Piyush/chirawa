import { describe, it, expect } from 'vitest';
import {
  evaluateFoodCartAddition, FOOD_CART_DIFFERENT_RESTAURANT,
} from '../food-cart-policy';

// Food.md §4.2 test matrix — the one-restaurant-per-food-order policy, plus the
// config-flip case that PROVES the rule is an engine, not hardcoding.

const ONE = { maxRestaurantsPerFoodOrder: 1 };
const A = 'restaurant-a';
const B = 'restaurant-b';

describe('evaluateFoodCartAddition — launch policy (max 1 restaurant)', () => {
  it('allows the first item into an empty food cart (binds the restaurant)', () => {
    expect(evaluateFoodCartAddition({ restaurantIds: [] }, A, ONE)).toEqual({ ok: true });
  });

  it('allows Restaurant A → Restaurant A (same restaurant)', () => {
    expect(evaluateFoodCartAddition({ restaurantIds: [A] }, A, ONE)).toEqual({ ok: true });
  });

  it('denies Restaurant A → Restaurant B with the typed reason', () => {
    const verdict = evaluateFoodCartAddition({ restaurantIds: [A] }, B, ONE);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe(FOOD_CART_DIFFERENT_RESTAURANT);
  });

  it('is symmetric — B-bound cart denies A the same way', () => {
    const verdict = evaluateFoodCartAddition({ restaurantIds: [B] }, A, ONE);
    expect(verdict.ok).toBe(false);
  });
});

describe('evaluateFoodCartAddition — config flip (multi-restaurant future)', () => {
  // Raising the config cap IS the entire multi-restaurant switch (Food.md §4):
  // the same call sites flip from deny to allow with zero code changes.
  const TWO = { maxRestaurantsPerFoodOrder: 2 };

  it('allows Restaurant A → Restaurant B when the cap is raised to 2', () => {
    expect(evaluateFoodCartAddition({ restaurantIds: [A] }, B, TWO)).toEqual({ ok: true });
  });

  it('still denies a THIRD restaurant at cap 2', () => {
    const verdict = evaluateFoodCartAddition({ restaurantIds: [A, B] }, 'restaurant-c', TWO);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe(FOOD_CART_DIFFERENT_RESTAURANT);
  });

  it('still allows an already-present restaurant at any cap', () => {
    expect(evaluateFoodCartAddition({ restaurantIds: [A, B] }, B, TWO)).toEqual({ ok: true });
  });
});
