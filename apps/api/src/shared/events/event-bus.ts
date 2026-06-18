import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { env } from '../../config/env';

/**
 * Internal event bus — decouples business logic from real-time transport.
 *
 * Services (orders, payments) EMIT events here.
 * The Socket.io + notification plugins LISTEN and act (broadcast / push).
 *
 * This means: services never import Socket.io, Socket.io never imports services.
 *
 * ── Cross-process delivery ──────────────────────────────────────────────────
 * The listeners (Socket.io, FCM) only ever run inside the API process, but some
 * emitters run in the WORKER process (e.g. batching.service assigns a rider).
 * A plain EventEmitter is in-process only, so worker-emitted events used to be
 * silently dropped — the rider got no socket update and no push.
 *
 * To fix that, every emit is ALSO published to a Redis pub/sub channel. Each
 * process that cares (the API) subscribes via `startEventBusBridge()` and
 * re-emits remote events onto its local bus. Messages are tagged with the
 * emitting process's id so a process never re-handles its own event twice.
 */
export const eventBus = new EventEmitter();
eventBus.setMaxListeners(20);

// Unique id for THIS process — lets the bridge ignore the echo of our own
// publishes (we already delivered them to local listeners synchronously).
const PROCESS_ID = randomUUID();

// Single Redis channel all event-bus traffic flows through.
const EVENT_CHANNEL = 'chirawa:events:v1';

interface BridgeMessage {
  origin:  string;
  event:   string;
  payload: unknown;
}

// Lazy publisher connection (created on first emit, in whichever process emits).
let publisher: Redis | null = null;
function getPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });
    publisher.on('error', (err) => console.error('event-bus publisher error:', err.message));
  }
  return publisher;
}

let subscriber: Redis | null = null;

/**
 * Emit locally AND publish to Redis so other processes' bridges receive it.
 * The Redis publish is fire-and-forget: a pub/sub hiccup must never block or
 * fail the request/job path that triggered the event.
 */
function dispatch(event: string, payload: unknown): void {
  // 1. Local, synchronous delivery — unchanged behaviour for same-process listeners.
  eventBus.emit(event, payload);

  // 2. Cross-process fan-out via Redis.
  const message: BridgeMessage = { origin: PROCESS_ID, event, payload };
  getPublisher()
    .publish(EVENT_CHANNEL, JSON.stringify(message))
    .catch((err) => console.error(`event-bus publish failed (${event}):`, err.message));
}

/**
 * Subscribe this process to remote events. Call once during startup in any
 * process that has local listeners (the API). Idempotent.
 */
export async function startEventBusBridge(): Promise<void> {
  if (subscriber) return;

  subscriber = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });
  subscriber.on('error', (err) => console.error('event-bus subscriber error:', err.message));

  subscriber.on('message', (channel, raw) => {
    if (channel !== EVENT_CHANNEL) return;
    try {
      const msg = JSON.parse(raw) as BridgeMessage;
      // Skip our own echo — those listeners already fired in dispatch().
      if (msg.origin === PROCESS_ID) return;
      eventBus.emit(msg.event, msg.payload);
    } catch (err) {
      console.error('event-bus bridge: bad message', (err as Error).message);
    }
  });

  await subscriber.subscribe(EVENT_CHANNEL);
}

/** Tear down Redis connections on shutdown. */
export async function closeEventBus(): Promise<void> {
  await Promise.allSettled([
    subscriber?.quit(),
    publisher?.quit(),
  ]);
  subscriber = null;
  publisher  = null;
}

// ── Event names ───────────────────────────────────────────────────────────────
export const Events = {
  ORDER_STATUS_CHANGED:       'order:status:changed',
  NEW_ORDER_FOR_SELLER:       'order:new:for_seller',
  ORDER_CANCELLED_FOR_SELLER: 'order:cancelled:for_seller',
  ORDER_ASSIGNED_TO_RIDER:    'order:assigned:to_rider',
  ORDER_ITEM_UNAVAILABLE:     'order:item:unavailable',
  RIDER_LOCATION_UPDATE:      'rider:location:update',
  ORDER_ETA_CHANGED:          'order:eta:changed',
} as const;

// ── Event payload types ───────────────────────────────────────────────────────
export interface OrderStatusChangedPayload {
  orderId:  string;
  status:   string;
  shopId:   string;
  sellerId: string;
  riderId:  string | null;
  customerId: string;
  // Set on a 'cancelled' transition when a prepaid payment was auto-refunded,
  // so the notification layer can tell the customer the exact amount (Chunk 3.5).
  refundedPaise?: number;
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

// Catalog Engine Phase 5 — the rider found an item out of stock at pickup. The
// line was refunded (prepaid) / deducted from cash due (COD); the customer gets a
// live in-app update + an optional substitute suggestion (ask, don't auto-sub).
export interface OrderItemUnavailablePayload {
  customerId:    string;
  orderId:       string;
  productName:   string;
  refundedPaise: number;
  cancelled:     boolean; // true when it was the order's only line → whole order cancelled
  suggestion?:   { productId: string; name: string; pricePaise: number };
}

// Server-computed delivery ETA changed (ETA MVP Phase 1). estimatedDeliveryAt is an
// ISO string; the socket layer derives secondsRemaining + serverNow at emit time.
export interface OrderEtaChangedPayload {
  orderId:             string;
  customerId:          string;
  estimatedDeliveryAt: string;  // ISO
  etaSpreadSeconds:    number;
  status:              string;
  source:              string;
}

// ── Type-safe emit helpers ────────────────────────────────────────────────────
// Each goes through dispatch(): local delivery + Redis fan-out to other processes.
export function emitOrderStatusChanged(payload: OrderStatusChangedPayload): void {
  dispatch(Events.ORDER_STATUS_CHANGED, payload);
}

export function emitOrderEtaChanged(payload: OrderEtaChangedPayload): void {
  dispatch(Events.ORDER_ETA_CHANGED, payload);
}

export function emitNewOrderForSeller(payload: NewOrderForSellerPayload): void {
  dispatch(Events.NEW_ORDER_FOR_SELLER, payload);
}

export function emitOrderCancelledForSeller(payload: OrderCancelledForSellerPayload): void {
  dispatch(Events.ORDER_CANCELLED_FOR_SELLER, payload);
}

export function emitOrderAssignedToRider(payload: OrderAssignedToRiderPayload): void {
  dispatch(Events.ORDER_ASSIGNED_TO_RIDER, payload);
}

export function emitOrderItemUnavailable(payload: OrderItemUnavailablePayload): void {
  dispatch(Events.ORDER_ITEM_UNAVAILABLE, payload);
}
