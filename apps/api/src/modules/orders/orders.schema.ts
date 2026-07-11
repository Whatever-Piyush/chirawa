import { z } from 'zod';

export const placeOrderSchema = z.object({
  cartId:         z.string().uuid(),
  addressId:      z.string().uuid(),
  paymentMethod:  z.enum(['upi', 'card', 'wallet', 'cod']),
  promoCode:      z.string().trim().max(30).optional(),
  useWalletCredit: z.boolean().default(false),
});

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

export const verifyPaymentSchema = z.object({
  razorpayOrderId:   z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
});

export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

export const rateOrderSchema = z.object({
  rating:  z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

export type RateOrderInput = z.infer<typeof rateOrderSchema>;

// BUG-001: the COD amount is advisory only — the server derives the recorded value
// from the order total. Kept optional so older clients (which send it) still validate.
export const codCollectedSchema = z.object({
  amountPaise: z.number().int().nonnegative().optional(),
});

export type CodCollectedInput = z.infer<typeof codCollectedSchema>;

// A4-impl-1: GET /orders pagination. Both params optional — a param-less request
// keeps the legacy contract (newest 50), so older clients and the seller/rider
// apps are unaffected. limit is capped at the legacy 50 so no request can widen it.
export const listOrdersQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
