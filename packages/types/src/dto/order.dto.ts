import type { Paise } from '../domain/money';
import type { OrderStatus } from '../enums/order-status.enum';
import type { PaymentMethod } from '../enums/payment-method.enum';
import type { AddressSnapshot } from '../domain/coordinates';

export interface PlaceOrderRequest {
  cartId: string;
  addressId: string;
  paymentMethod: PaymentMethod;
  promoCode?: string;
  useWalletCredit?: boolean;
}

export interface PlaceOrderResponse {
  orderId: string;
  orderIds?: string[];
  status: OrderStatus;
  totalAmount: Paise;
  message?: string;
  // Present only for online payment (paymentMethod !== 'cod')
  razorpayOrderId?: string;
  razorpayKeyId?: string;
  amountPaise?: Paise;
}

export interface VerifyPaymentResponse {
  success: boolean;
  message: string;
}

export interface VerifyPaymentRequest {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface OrderStatusHistoryItem {
  status: OrderStatus;
  changedAt: string;
  changedByRole: string;
}

export interface OrderDetailResponse {
  id: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  items: OrderItemResponse[];
  deliveryAddress: AddressSnapshot;
  cartSubtotal: Paise;
  deliveryFee: Paise;
  discount: Paise;
  total: Paise;
  rider?: {
    name: string;
    phone: string;
  };
  statusHistory: OrderStatusHistoryItem[];
  createdAt: string;
}

export interface OrderItemResponse {
  productId: string;
  productName: string;
  unitPrice: Paise;
  quantity: number;
  subtotal: Paise;
}