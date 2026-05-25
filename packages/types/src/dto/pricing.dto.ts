import type { Paise } from '../domain/money';

export interface PricingPreviewRequest {
  cartId: string;
  addressId: string;
}

export interface PricingPreviewResponse {
  deliveryFee: Paise;
  distanceKm: number;
  feeRuleVersion: number;
  cartSubtotal: Paise;
  total: Paise;
  breakdownText: string;   // Hindi explanation shown in UI
}