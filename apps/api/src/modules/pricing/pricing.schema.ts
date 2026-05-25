import { z } from 'zod';

export const pricingPreviewSchema = z.object({
  cartId:    z.string().uuid(),
  addressId: z.string().uuid(),
});

export type PricingPreviewInput = z.infer<typeof pricingPreviewSchema>;
