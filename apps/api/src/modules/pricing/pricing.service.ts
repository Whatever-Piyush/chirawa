import { ValidationError } from '../../shared/errors/app-errors';

// ─── Flat pricing — Chirawa launch (no distance logic) ─────────────────────────
// Business rules (BRINGLY_PRODUCTION_PLAN, Chunk 0):
//   • cart total  <  ₹100  → ₹25 delivery (small-cart fee; order still allowed)
//   • cart total  ≥  ₹100  → ₹10 standard, OR ₹15 if the cart contains a
//                            "Chirawa Special" (featured) shop
//   • No distance calculation, no basket-size tiers, no hard minimum-order block.
// All monetary values are integer paise — NEVER float.

export const MIN_CART_FOR_STANDARD_FEE_PAISE = 10_000; // ₹100
export const FEE_SMALL_CART_PAISE = 2_500; // ₹25 — cart below ₹100
export const FEE_STANDARD_PAISE = 1_000; // ₹10 — regular shops
export const FEE_SPECIAL_PAISE = 1_500; // ₹15 — Chirawa Special (featured) shops

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FeeCalculationInput {
  cartSubtotalPaise: number; // integer paise — whole-cart goods value
  hasSpecialShop: boolean; // true if any shop in the cart is Chirawa Special (featured)
  ruleVersion: number; // stamped onto the order for accounting/audit
}

export interface FeeCalculationResult {
  feePaise: number;
  ruleVersion: number;
  breakdownHindi: string; // shown in cart/checkout UI
}

// ─── Pure flat-fee function ────────────────────────────────────────────────────
export function calculateFlatFee(cartSubtotalPaise: number, hasSpecialShop: boolean): number {
  if (cartSubtotalPaise < MIN_CART_FOR_STANDARD_FEE_PAISE) return FEE_SMALL_CART_PAISE;
  return hasSpecialShop ? FEE_SPECIAL_PAISE : FEE_STANDARD_PAISE;
}

// ─── Main export — validates inputs, returns fee + UI breakdown ────────────────
export function calculateDeliveryFee(input: FeeCalculationInput): FeeCalculationResult {
  const { cartSubtotalPaise, hasSpecialShop, ruleVersion } = input;

  // Input validation — financial bugs must be caught at the boundary.
  if (!Number.isInteger(cartSubtotalPaise)) {
    throw new ValidationError(`cartSubtotalPaise must be integer, got: ${cartSubtotalPaise}`);
  }
  if (cartSubtotalPaise < 0) {
    throw new ValidationError(`cartSubtotalPaise cannot be negative`);
  }

  const feePaise = calculateFlatFee(cartSubtotalPaise, hasSpecialShop);

  return {
    feePaise,
    ruleVersion,
    breakdownHindi: buildBreakdownHindi(cartSubtotalPaise, hasSpecialShop, feePaise),
  };
}

// ─── Hindi explanation shown in the cart/checkout UI ───────────────────────────
function buildBreakdownHindi(cartPaise: number, hasSpecialShop: boolean, feePaise: number): string {
  const cartRs = Math.round(cartPaise / 100);
  const feeRs = Math.round(feePaise / 100);

  const reason =
    cartPaise < MIN_CART_FOR_STANDARD_FEE_PAISE
      ? `Order ₹100 se kam hai`
      : hasSpecialShop
        ? `Chirawa Special delivery`
        : `Standard delivery`;

  return `Delivery charge ₹${feeRs} — ${reason} (cart: ₹${cartRs})`;
}

// ─── Get active fee rule version from DB (stamped onto orders) ─────────────────
import type { PrismaClient } from '@prisma/client';

export async function getActiveFeeRuleVersion(prisma: PrismaClient): Promise<number> {
  const rule = await prisma.feeRule.findFirst({
    where: { effectiveTo: null },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  if (!rule) throw new ValidationError('No active fee rule found');
  return rule.version;
}
