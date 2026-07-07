import type { PrismaClient } from '@prisma/client';
import { ValidationError } from '../../shared/errors/app-errors';

// The auto-applied "free delivery on your first order" promo (Chunk 7, Task 7.2).
export const FIRST_ORDER_CODE = 'FIRSTORDER';

// PromoCode.type values. `percent` stores hundredths-of-a-percent in valuePaise
// (e.g. 10% → 1000), matching the legacy convention already in the DB.
export type PromoType = 'flat' | 'percent' | 'free_delivery';

export interface PromoDiscountInput {
  type:              PromoType;
  valuePaise:        number;
  cartSubtotalPaise: number;
  deliveryFeePaise:  number;
}

// Pure: how many paise this promo takes off, given cart + fee context.
// Clamped to [0, subtotal + fee] so an order total can never go negative.
export function computePromoDiscountPaise(input: PromoDiscountInput): number {
  const { type, valuePaise, cartSubtotalPaise, deliveryFeePaise } = input;
  let raw: number;
  switch (type) {
    case 'flat':          raw = valuePaise; break;
    case 'percent':       raw = Math.floor((cartSubtotalPaise * valuePaise) / 10000); break;
    case 'free_delivery': raw = deliveryFeePaise; break;
    default:              raw = 0;
  }
  const cap = cartSubtotalPaise + deliveryFeePaise;
  return Math.max(0, Math.min(raw, cap));
}

export interface ValidatedPromo {
  promoId:       string;
  code:          string;
  type:          PromoType;
  discountPaise: number;
}

export interface ValidateContext {
  code:              string;
  userId:            string;
  cartSubtotalPaise: number;
  deliveryFeePaise:  number;
}

// Server-side validation shared by checkout preview and order creation, so the
// rules can never drift between "show the discount" and "actually apply it".
// Throws ValidationError (with a customer-facing Hindi message) when invalid.
export async function validatePromo(
  prisma: PrismaClient,
  ctx: ValidateContext,
): Promise<ValidatedPromo> {
  const code = ctx.code.trim().toUpperCase();
  const promo = await prisma.promoCode.findUnique({ where: { code } });

  if (!promo || !promo.isActive) throw new ValidationError('Yeh promo code valid nahi hai');
  if (promo.expiresAt && promo.expiresAt < new Date()) throw new ValidationError('Promo code expire ho gaya');
  if (promo.maxUsesTotal != null && promo.currentUses >= promo.maxUsesTotal) {
    throw new ValidationError('Yeh promo code khatam ho gaya');
  }
  if (ctx.cartSubtotalPaise < promo.minCartPaise) {
    throw new ValidationError(`Is promo ke liye minimum cart ₹${Math.round(promo.minCartPaise / 100)} chahiye`);
  }
  const usedCount = await prisma.promoRedemption.count({
    where: { promoCodeId: promo.id, userId: ctx.userId },
  });
  if (usedCount >= promo.maxUsesPerUser) throw new ValidationError('Is promo code ka use kar chuke hain');

  const discountPaise = computePromoDiscountPaise({
    type:              promo.type as PromoType,
    valuePaise:        promo.valuePaise,
    cartSubtotalPaise: ctx.cartSubtotalPaise,
    deliveryFeePaise:  ctx.deliveryFeePaise,
  });

  return { promoId: promo.id, code: promo.code, type: promo.type as PromoType, discountPaise };
}

// The promo half of the checkout preview. MUST mirror order creation
// (orders.service.placeOrder) exactly: a typed code is validated — soft-failing
// into `promoError` so the bill still renders — otherwise first-time customers
// get FIRSTORDER auto-applied. Like creation, the promo applies at the
// whole-cart subtotal regardless of how many shops the cart spans; the old
// single-shop gate in the preview route made multi-shop bills show a total the
// order was then not charged (A3 parity fix).
export interface PromoPreviewResult {
  discount:         number;
  appliedPromoCode: string | null;
  promoError:       string | null;
}

export async function previewPromo(
  prisma: PrismaClient,
  ctx: {
    promoCode?:        string;
    userId:            string;
    cartSubtotalPaise: number;
    deliveryFeePaise:  number;
  },
): Promise<PromoPreviewResult> {
  const base = {
    userId:            ctx.userId,
    cartSubtotalPaise: ctx.cartSubtotalPaise,
    deliveryFeePaise:  ctx.deliveryFeePaise,
  };
  if (ctx.promoCode) {
    try {
      const v = await validatePromo(prisma, { code: ctx.promoCode, ...base });
      return { discount: v.discountPaise, appliedPromoCode: v.code, promoError: null };
    } catch (e) {
      return {
        discount:         0,
        appliedPromoCode: null,
        promoError:       e instanceof Error ? e.message : 'Promo code valid nahi hai',
      };
    }
  }
  const auto = await resolveAutoPromo(prisma, base);
  return auto
    ? { discount: auto.discountPaise, appliedPromoCode: auto.code, promoError: null }
    : { discount: 0, appliedPromoCode: null, promoError: null };
}

// First-time customers (no non-cancelled orders) get FIRSTORDER auto-applied at
// checkout without typing anything. Returns null when not eligible or when the
// promo is missing/min-cart-not-met — auto-apply must never block checkout.
export async function resolveAutoPromo(
  prisma: PrismaClient,
  ctx: { userId: string; cartSubtotalPaise: number; deliveryFeePaise: number },
): Promise<ValidatedPromo | null> {
  const prior = await prisma.order.count({
    where: { customerId: ctx.userId, status: { not: 'cancelled' } },
  });
  if (prior > 0) return null;
  try {
    return await validatePromo(prisma, { code: FIRST_ORDER_CODE, ...ctx });
  } catch {
    return null;
  }
}
