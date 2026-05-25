import type { Paise } from '../domain/money';

export interface AddToCartRequest {
  productId: string;
  quantity: number;
}

export interface UpdateCartItemRequest {
  quantity: number;   // 0 = remove
}

export interface CartItem {
  productId: string;
  productName: string;
  imageUrl: string | null;
  unitPrice: Paise;
  quantity: number;
  subtotal: Paise;
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