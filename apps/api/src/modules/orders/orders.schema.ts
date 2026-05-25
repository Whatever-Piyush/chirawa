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
