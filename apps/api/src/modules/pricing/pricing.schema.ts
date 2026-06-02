import { z } from 'zod';

export const pricingPreviewSchema = z.object({
  cartId:    z.string().uuid(),
  addressId: z.string().uuid(),
  promoCode: z.string().trim().max(30).optional(),
});

export type PricingPreviewInput = z.infer<typeof pricingPreviewSchema>;
