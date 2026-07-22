import { z } from 'zod';

// ─── Food module request schemas (Food.md §7) ─────────────────────────────────

export const addFoodCartItemSchema = z.object({
  menuItemId: z.string().uuid('Invalid menu item'),
  quantity:   z.number().int().min(1).max(20).default(1),
});
export type AddFoodCartItemInput = z.infer<typeof addFoodCartItemSchema>;

export const updateFoodCartItemSchema = z.object({
  quantity: z.number().int().min(0).max(20),
});
export type UpdateFoodCartItemInput = z.infer<typeof updateFoodCartItemSchema>;

export const placeFoodOrderSchema = z.object({
  addressId:     z.string().uuid('Invalid address'),
  receiverName:  z.string().trim().min(1).max(100).optional(),
  receiverPhone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Invalid phone').optional(),
});
export type PlaceFoodOrderInput = z.infer<typeof placeFoodOrderSchema>;

export const verifyFoodPaymentSchema = z.object({
  razorpayOrderId:   z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});
export type VerifyFoodPaymentInput = z.infer<typeof verifyFoodPaymentSchema>;

export const cancelFoodOrderSchema = z.object({
  reason: z.string().trim().max(255).optional(),
});
export type CancelFoodOrderInput = z.infer<typeof cancelFoodOrderSchema>;

export const rejectFoodOrderSchema = z.object({
  reason: z.string().trim().min(1).max(255).optional(),
});
export type RejectFoodOrderInput = z.infer<typeof rejectFoodOrderSchema>;

// Pagination — mirrors the marketplace listOrdersQuerySchema clamps.
export const foodOrdersListQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type FoodOrdersListQuery = z.infer<typeof foodOrdersListQuerySchema>;

export const restaurantOrdersQuerySchema = z.object({
  scope: z.enum(['today', 'history']).default('today'),
  page:  z.coerce.number().int().min(1).max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type RestaurantOrdersQuery = z.infer<typeof restaurantOrdersQuerySchema>;

// Restaurant self-serve (launch hardening P1)
export const setRestaurantOpenSchema = z.object({ isOpen: z.boolean() });
export type SetRestaurantOpenInput = z.infer<typeof setRestaurantOpenSchema>;

export const setItemAvailabilitySchema = z.object({ isAvailable: z.boolean() });
export type SetItemAvailabilityInput = z.infer<typeof setItemAvailabilitySchema>;
