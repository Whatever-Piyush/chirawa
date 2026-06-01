import { z } from 'zod';

export const addToCartSchema = z.object({
  productId: z.string().uuid('Valid product ID required'),
  variantId: z.string().uuid().optional(), // optional pack-size variant
  quantity:  z.number().int().min(1).max(50),
});

export const updateCartItemSchema = z.object({
  variantId: z.string().uuid().optional(), // targets a specific variant line
  quantity:  z.number().int().min(0).max(50), // 0 = remove item
});

export type AddToCartInput    = z.infer<typeof addToCartSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
