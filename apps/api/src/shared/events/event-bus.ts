import { EventEmitter } from 'events';

/**
 * Internal event bus — decouples business logic from real-time transport.
 *
 * Services (orders, payments) EMIT events here.
 * The Socket.io plugin LISTENS and broadcasts to connected clients.
 *
 * This means: services never import Socket.io, Socket.io never imports services.
 * If Socket.io is down, events are just dropped — never affects the request path.
 */
export const eventBus = new EventEmitter();
eventBus.setMaxListeners(20);

// ── Event names ───────────────────────────────────────────────────────────────
export const Events = {
  ORDER_STATUS_CHANGED:       'order:status:changed',
  NEW_ORDER_FOR_SELLER:       'order:new:for_seller',
  ORDER_CANCELLED_FOR_SELLER: 'order:cancelled:for_seller',
  ORDER_ASSIGNED_TO_RIDER:    'order:assigned:to_rider',
  RIDER_LOCATION_UPDATE:      'rider:location:update',
} as const;

// ── Event payload types ───────────────────────────────────────────────────────
export interface OrderStatusChangedPayload {
  orderId:  string;
  status:   string;
  shopId:   string;
  sellerId: string;
  riderId:  string | null;
  customerId: string;
}

export interface NewOrderForSellerPayload {
  orderId:   string;
  shopId:    string;
  sellerId:  string;
  items:     Array<{ productName: string; quantity: number; unitPrice: number }>;
  totalAmount: number;
  paymentMethod: string;
  deliveryLocality: string;
}

export interface OrderCancelledForSellerPayload {
  orderId:  string;
  sellerId: string;
  reason:   string;
}

export interface OrderAssignedToRiderPayload {
  orderId:  string;
  riderId:  string;
  shopName: string;
  shopAddress: string;
  deliveryLocality: string;
  totalAmount: number;
  paymentMethod: string;
}

// ── Type-safe emit helpers ────────────────────────────────────────────────────
export function emitOrderStatusChanged(payload: OrderStatusChangedPayload): void {
  eventBus.emit(Events.ORDER_STATUS_CHANGED, payload);
}

export function emitNewOrderForSeller(payload: NewOrderForSellerPayload): void {
  eventBus.emit(Events.NEW_ORDER_FOR_SELLER, payload);
}

export function emitOrderCancelledForSeller(payload: OrderCancelledForSellerPayload): void {
  eventBus.emit(Events.ORDER_CANCELLED_FOR_SELLER, payload);
}

export function emitOrderAssignedToRider(payload: OrderAssignedToRiderPayload): void {
  eventBus.emit(Events.ORDER_ASSIGNED_TO_RIDER, payload);
}
