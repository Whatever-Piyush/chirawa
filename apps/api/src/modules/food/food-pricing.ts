import { ValidationError } from '../../shared/errors/app-errors';
import type { FoodConfig, FoodMarkupRule } from './food-config';

// ─── Food pricing (Food.md §5) ────────────────────────────────────────────────
// Isolated from the marketplace pricing.service: flat delivery fee (₹30 at
// launch) + a config-driven markup engine (0% at launch). All values integer
// paise — NEVER float. No literal business numbers here: everything reads from
// FoodConfig, so ops can change the fee/markup without touching code.

// Markup precedence: per-restaurant > per-category > default. A rule may carry
// percent and/or fixedPaise; both apply (percent first, then fixed).
export function applyMarkup(
  basePaise: number,
  cfg: FoodConfig,
  ctx: { restaurantId: string; menuCategoryId?: string | null },
): number {
  if (!Number.isInteger(basePaise) || basePaise < 0) {
    throw new ValidationError(`basePaise must be a non-negative integer, got: ${basePaise}`);
  }

  const rule: FoodMarkupRule =
    cfg.markup.perRestaurant[ctx.restaurantId] ??
    (ctx.menuCategoryId ? cfg.markup.perCategory[ctx.menuCategoryId] : undefined) ??
    { percent: cfg.markup.defaultPercent, fixedPaise: cfg.markup.defaultFixedPaise };

  const percent = rule.percent ?? 0;
  const fixed   = rule.fixedPaise ?? 0;

  const marked = Math.round(basePaise * (1 + percent / 100)) + fixed;
  return Math.max(0, marked);
}

export interface FoodBillLine {
  unitPricePaise: number; // already marked-up sell price
  quantity: number;
}

export interface FoodBill {
  itemsSubtotalPaise: number;
  deliveryFeePaise: number; // flat, from config
  totalPaise: number;
}

export function computeFoodBill(lines: FoodBillLine[], cfg: FoodConfig): FoodBill {
  let itemsSubtotalPaise = 0;
  for (const line of lines) {
    if (!Number.isInteger(line.unitPricePaise) || line.unitPricePaise < 0) {
      throw new ValidationError(`unitPricePaise must be a non-negative integer, got: ${line.unitPricePaise}`);
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new ValidationError(`quantity must be a positive integer, got: ${line.quantity}`);
    }
    itemsSubtotalPaise += line.unitPricePaise * line.quantity;
  }

  const deliveryFeePaise = cfg.deliveryFeePaise;
  return {
    itemsSubtotalPaise,
    deliveryFeePaise,
    totalPaise: itemsSubtotalPaise + deliveryFeePaise,
  };
}
