import type { Paise } from '../domain/money';

export interface AddToCartRequest {
  productId: string;
  variantId?: string;   // optional pack-size variant
  quantity: number;
}

export interface UpdateCartItemRequest {
  variantId?: string;   // targets a specific variant line
  quantity: number;   // 0 = remove
}

export interface CartItem {
  productId: string;
  productName: string;
  imageUrl: string | null;
  unitPrice: Paise;
  quantity: number;
  subtotal: Paise;
  shopId: string;     // multi-shop carts: which shop this item belongs to
  shopName: string;
  variantId?: string;   // present when this line is a specific pack-size variant
  variantName?: string;
}

export interface CartResponse {
  cartId: string;
  shopId: string;
  shopName: string;
  items: CartItem[];
  subtotal: Paise;
  requiresPricingRefresh: boolean;   // Fee band threshold crossed
  updatedAt: string;
}