import type { Paise } from '../domain/money';

export interface PricingPreviewRequest {
  cartId: string;
  addressId: string;
  promoCode?: string;
}

export interface PricingPreviewResponse {
  deliveryFee: Paise;
  distanceKm: number;
  feeRuleVersion: number;
  cartSubtotal: Paise;
  discount: Paise;
  // Code that produced the discount (typed or auto-applied FIRSTORDER), if any
  appliedPromoCode?: string | null;
  // Customer-facing reason a typed code was rejected (bill still renders)
  promoError?: string | null;
  total: Paise;
  breakdownText: string;   // Hindi explanation shown in UI
}