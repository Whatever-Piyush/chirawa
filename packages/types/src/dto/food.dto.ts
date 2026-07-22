// ─── Food Delivery Module DTOs (Food.md §7) ───────────────────────────────────
// Request/response shapes for /api/v1/food/*. Additive — no existing DTO is
// modified. All money is integer paise.

/** 409 error code the food-cart conflict bottom-sheet keys on (Food.md §4). */
export const FOOD_CART_DIFFERENT_RESTAURANT = 'FOOD_CART_DIFFERENT_RESTAURANT';

export type FoodOrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'confirmed'
  | 'preparing'
  | 'ready_for_pickup'
  | 'picked_up'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export interface FoodEtaBand {
  minMinutes: number; // 30 at launch
  maxMinutes: number; // 50 at launch
}

export interface FoodRestaurantSummary {
  id: string;
  name: string;
  description: string | null;
  cuisine: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  isCurrentlyOpen: boolean;
  openTime: string;
  closeTime: string;
  prepTimeMinutes: number;
  rating: { average: number | null; count: number };
  /** false → client renders "Menu coming soon" */
  menuAvailable: boolean;
}

export interface FoodRestaurantsResponse {
  restaurants: FoodRestaurantSummary[];
  eta: FoodEtaBand;
}

export interface FoodMenuItem {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  isVeg: boolean | null;
  pricePaise: number; // sell price — markup already applied server-side
  menuCategoryId: string | null;
}

export interface FoodMenuSection {
  id: string;
  name: string;
  items: FoodMenuItem[];
}

export interface FoodRestaurantDetail extends Omit<FoodRestaurantSummary, 'menuAvailable'> {
  address: string;
  menuSections: FoodMenuSection[];
  menuAvailable: boolean;
  eta: FoodEtaBand;
}

// ── Food cart ──────────────────────────────────────────────────────────────

export interface FoodCartItemView {
  menuItemId: string;
  name: string;
  imageUrl: string | null;
  isVeg: boolean | null;
  unitPricePaise: number;
  quantity: number;
  subtotalPaise: number;
  isAvailable: boolean;
}

export interface FoodCartView {
  cartId: string; // '' when empty
  restaurantId: string | null;
  restaurantName: string | null;
  items: FoodCartItemView[];
  itemsSubtotalPaise: number;
  count: number;
}

export interface AddFoodCartItemRequest {
  menuItemId: string;
  quantity?: number; // default 1
}

// ── Food checkout / orders ─────────────────────────────────────────────────

export interface FoodCheckoutPreview {
  itemsSubtotalPaise: number;
  deliveryFeePaise: number; // flat ₹30 at launch — config-driven
  totalPaise: number;
  eta: FoodEtaBand;
  payment: { onlineOnly: boolean; allowedMethods: string[] }; // ['upi']
  restaurant: { id: string; name: string; isCurrentlyOpen: boolean } | null;
}

export interface PlaceFoodOrderRequest {
  addressId: string;
  receiverName?: string;
  receiverPhone?: string;
}

export interface PlaceFoodOrderResponse {
  foodOrderId: string;
  status: 'pending_payment';
  razorpayOrderId: string;
  razorpayKeyId: string;
  amountPaise: number;
  restaurantName: string;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  message: string;
}

export interface VerifyFoodPaymentRequest {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface VerifyFoodPaymentResponse {
  foodOrderId: string;
  status: FoodOrderStatus;
  message?: string;
}

export interface FoodOrderItemView {
  id: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

export interface FoodOrderSummary {
  id: string;
  status: FoodOrderStatus;
  itemsSubtotalPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  refundedPaise: number;
  createdAt: string;
  restaurant: { id: string; name: string; cuisine: string | null; logoUrl: string | null };
  items: FoodOrderItemView[];
}

export interface FoodOrderDetail extends FoodOrderSummary {
  deliveryStreet: string;
  deliveryLocality: string;
  receiverName: string | null;
  receiverPhone: string | null;
  cancelReason: string | null;
  paidAt: string | null;
  confirmedAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  outForDeliveryAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  statusHistory: Array<{ status: string; changedByRole: string; changedAt: string }>;
  eta: FoodEtaBand;
}
