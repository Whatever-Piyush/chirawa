import { ValidationError } from '../../shared/errors/app-errors';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FeeCalculationInput {
  cartSubtotalPaise: number;  // integer paise — NEVER float
  distanceMetres:    number;  // road distance in metres
  ruleVersion:       number;
}

export interface FeeCalculationResult {
  feePaise:       number;
  ruleVersion:    number;
  distanceKm:     number;
  breakdownHindi: string; // Shown in cart UI
}

// ─── Fee Rules — Version 1 ────────────────────────────────────────────────────
// All monetary values in paise, all distances in metres.
//
// Rule table (from playbook):
//   distance > 4000m               → ₹25 (2500p)
//   distance ≤ 4000m, cart <  ₹100 → ₹20 (2000p)
//   distance ≤ 4000m, cart ₹100–₹300 → ₹15 (1500p)
//   distance ≤ 4000m, cart > ₹300  → ₹10 (1000p)
//
// Boundary precision (exact):
//   distance: strictly > 4000 → long-distance; == 4000 → short-distance
//   cart:     < 10000p = low; >= 10000p AND <= 30000p = mid; > 30000p = high

export function calculateFeeV1(
  cartSubtotalPaise: number,
  distanceMetres: number,
): number {
  // Long distance — cart value irrelevant
  if (distanceMetres > 4000) return 2500;

  // Short distance — cart band determines fee
  if (cartSubtotalPaise < 10000)  return 2000; // < ₹100
  if (cartSubtotalPaise <= 30000) return 1500; // ₹100 to ₹300 inclusive
  return 1000;                                  // > ₹300
}

// ─── Version registry — add new versions here, never mutate old ones ─────────
const FEE_CALCULATORS: Record<number, (cart: number, dist: number) => number> = {
  1: calculateFeeV1,
};

// ─── Main export — validates inputs, delegates to versioned calculator ────────
export function calculateDeliveryFee(
  input: FeeCalculationInput,
): FeeCalculationResult {
  const { cartSubtotalPaise, distanceMetres, ruleVersion } = input;

  // Input validation — financial bugs must be caught at boundary
  if (!Number.isInteger(cartSubtotalPaise)) {
    throw new ValidationError(`cartSubtotalPaise must be integer, got: ${cartSubtotalPaise}`);
  }
  if (cartSubtotalPaise < 0) {
    throw new ValidationError(`cartSubtotalPaise cannot be negative`);
  }
  if (!Number.isFinite(distanceMetres) || distanceMetres < 0) {
    throw new ValidationError(`distanceMetres must be a non-negative finite number`);
  }

  const calculator = FEE_CALCULATORS[ruleVersion];
  if (!calculator) {
    throw new ValidationError(`Unknown fee rule version: ${ruleVersion}`);
  }

  const feePaise   = calculator(cartSubtotalPaise, distanceMetres);
  const distanceKm = distanceMetres / 1000;

  return {
    feePaise,
    ruleVersion,
    distanceKm,
    breakdownHindi: buildBreakdownHindi(cartSubtotalPaise, distanceMetres, feePaise),
  };
}

// ─── Hindi explanation shown in the cart UI ───────────────────────────────────
function buildBreakdownHindi(
  cartPaise: number,
  distMetres: number,
  feePaise: number,
): string {
  const cartRs = Math.round(cartPaise / 100);
  const distKm = (distMetres / 1000).toFixed(1);
  const feeRs  = Math.round(feePaise / 100);

  const reason =
    distMetres > 4000
      ? `Doori 4 km se zyada hai (${distKm} km)`
      : cartPaise < 10000
        ? `Cart ₹100 se kam hai`
        : cartPaise <= 30000
          ? `Cart ₹100–₹300 ke beech hai`
          : `Cart ₹300 se zyada hai`;

  return `Delivery charge ₹${feeRs} — ${reason} (doori: ${distKm} km, cart: ₹${cartRs})`;
}

// ─── Get active fee rule version from DB ──────────────────────────────────────
import type { PrismaClient } from '@prisma/client';

export async function getActiveFeeRuleVersion(prisma: PrismaClient): Promise<number> {
  const rule = await prisma.feeRule.findFirst({
    where:   { effectiveTo: null },
    orderBy: { version: 'desc' },
    select:  { version: true },
  });

  if (!rule) throw new ValidationError('No active fee rule found');
  return rule.version;
}
