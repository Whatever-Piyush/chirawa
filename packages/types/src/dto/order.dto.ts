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
  // Set when the cart spanned >1 shop (Catalog Engine Phase 5): the OrderGroup id
  // plus a per-shop breakdown, so the order-placed + group-tracking screens can
  // show "₹X from Shop A, ₹Y from Shop B". `shops` order matches `orderIds`.
  groupId?: string | null;
  shops?: Array<{ orderId: string; shopId: string; shopName: string; total: Paise }>;
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
  // Server-computed delivery ETA (ETA MVP Phase 1). Duration + serverNow (not a bare
  // absolute timestamp) so the client countdown is clock-skew safe. Omitted when the
  // order is terminal or no ETA has been computed yet.
  eta?: {
    secondsRemaining: number;
    spreadSeconds: number;
    serverNow: string;
    source: string;
  };
  // Refund visibility (Tracking V2 P0.2). Read-only, derived from Payment.refundedPaise
  // (+ COD line refunds). `original` = back to the payment method; `cash_adjustment` = a
  // COD cash-due reduction. A full refund timeline (states/ETA) is Phase 2.
  refund?: {
    amountPaise: number;
    destination: 'original' | 'cash_adjustment';
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