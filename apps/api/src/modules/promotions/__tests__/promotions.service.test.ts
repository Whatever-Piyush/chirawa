import { describe, it, expect } from 'vitest';
import { computePromoDiscountPaise } from '../promotions.service';

// ─── computePromoDiscountPaise — pure discount math ───────────────────────────
// Cart context used across cases: ₹150 subtotal, ₹10 delivery fee.
const ctx = { cartSubtotalPaise: 15000, deliveryFeePaise: 1000 };

describe('computePromoDiscountPaise', () => {
  it('flat: takes off the flat value (paise)', () => {
    expect(computePromoDiscountPaise({ type: 'flat', valuePaise: 3000, ...ctx })).toBe(3000);
  });

  it('percent: value is hundredths-of-a-percent (10% → 1000), floored', () => {
    // 10% of ₹150 = ₹15 = 1500p
    expect(computePromoDiscountPaise({ type: 'percent', valuePaise: 1000, ...ctx })).toBe(1500);
    // 12.5% of ₹150 = 1875p exactly
    expect(computePromoDiscountPaise({ type: 'percent', valuePaise: 1250, ...ctx })).toBe(1875);
    // floors fractional paise: 7% of ₹150 = 1050p
    expect(computePromoDiscountPaise({ type: 'percent', valuePaise: 700, ...ctx })).toBe(1050);
  });

  it('free_delivery: discount equals the delivery fee, ignoring value', () => {
    expect(computePromoDiscountPaise({ type: 'free_delivery', valuePaise: 1, ...ctx })).toBe(1000);
    // a higher small-cart fee is also fully covered
    expect(computePromoDiscountPaise({
      type: 'free_delivery', valuePaise: 1000, cartSubtotalPaise: 5000, deliveryFeePaise: 2500,
    })).toBe(2500);
  });

  it('clamps to [0, subtotal + fee]', () => {
    // flat bigger than the whole bill → capped at subtotal + fee
    expect(computePromoDiscountPaise({ type: 'flat', valuePaise: 999999, ...ctx })).toBe(16000);
    // negative value never produces a negative discount
    expect(computePromoDiscountPaise({ type: 'flat', valuePaise: -500, ...ctx })).toBe(0);
  });

  it('unknown type yields no discount', () => {
    expect(computePromoDiscountPaise({ type: 'mystery' as never, valuePaise: 5000, ...ctx })).toBe(0);
  });
});
