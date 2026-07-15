// ─── Food Cart Policy (Food.md §4) ────────────────────────────────────────────
// The ONLY place the "one restaurant per food order" rule lives. Pure and
// deterministic: no I/O, no Prisma — trivially unit-testable, and enforced
// server-side wherever the food cart is written (never UI-only).
//
// Scope: the FOOD cart exclusively. The marketplace cart has its own rules and
// is untouched by this module. Food + marketplace can never mix into one order
// by construction (physically separate carts → separate checkouts → separate
// order tables) — that needs no runtime check here.
//
// NOT hardcoded "single restaurant forever": maxRestaurantsPerFoodOrder comes
// from FoodConfig (AppConfig-overridable). Raising it to N is the entire
// multi-restaurant-checkout switch — the call sites don't change.

export const FOOD_CART_DIFFERENT_RESTAURANT = 'FOOD_CART_DIFFERENT_RESTAURANT' as const;

export type FoodCartConflictReason = typeof FOOD_CART_DIFFERENT_RESTAURANT;

export interface FoodCartPolicyConfig {
  maxRestaurantsPerFoodOrder: number;
}

export interface FoodCartContext {
  /** Restaurants currently bound to the cart (0 or 1 today; N when the config is raised). */
  restaurantIds: readonly string[];
}

export type FoodCartVerdict =
  | { ok: true }
  | { ok: false; reason: FoodCartConflictReason };

export function evaluateFoodCartAddition(
  cart: FoodCartContext,
  candidateRestaurantId: string,
  cfg: FoodCartPolicyConfig,
): FoodCartVerdict {
  // Same restaurant as one already in the cart — always fine.
  if (cart.restaurantIds.includes(candidateRestaurantId)) return { ok: true };

  // A new restaurant would push the distinct-restaurant count past the policy cap.
  const distinctAfterAdd = cart.restaurantIds.length + 1;
  if (distinctAfterAdd > cfg.maxRestaurantsPerFoodOrder) {
    return { ok: false, reason: FOOD_CART_DIFFERENT_RESTAURANT };
  }

  return { ok: true };
}
