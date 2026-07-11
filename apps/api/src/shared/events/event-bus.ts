import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { env } from '../../config/env';
import { serviceLogger } from '../observability/logger';

const log = serviceLogger('event-bus');

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
 * re-emits remote events onto its local bus.
 *
 * ── Exactly-once across instances (P0-1) ────────────────────────────────────
 * PM2 runs SEVERAL API instances, and pub/sub delivers every message to EVERY
 * subscriber. The old design (emit locally + every OTHER instance re-emits)
 * therefore ran every side-effectful listener once per instance: N duplicate
 * FCM pushes, N duplicate socket emits (each reaches all clients via the
 * Socket.IO Redis adapter), N racing dispatch/batching runs.
 *
 * Now each message carries a unique eventId, and every subscriber — including
 * the emitting process — races a Redis `SET evt:claim:{eventId} NX` for it.
 * Exactly one instance wins and runs the local listeners; the rest drop the
 * message. Processes WITHOUT the bridge (the worker, unit tests) keep the old
 * synchronous local emit, so a bridge-less process still delivers to its own
 * listeners.
 *
 * Failure bias: if Redis errors during publish or claim, we emit locally
 * anyway — a duplicate notification is recoverable; a lost ORDER_STATUS_CHANGED
 * (order never dispatched to a rider) is not.
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
  // Unique per dispatch — the cross-instance claim key. Optional so a message
  // from an old-version process (rolling reload window) still parses; those
  // fall back to the legacy skip-own-origin behaviour.
  eventId?: string;
  event:   string;
  payload: unknown;
}

// Claim TTL only needs to outlive the pub/sub fan-out window (ms in practice);
// 5 minutes is generous without accumulating keys.
const EVENT_CLAIM_TTL_SECONDS = 300;
const claimKey = (eventId: string): string => `evt:claim:${eventId}`;

// Lazy publisher connection (created on first emit, in whichever process emits).
let publisher: Redis | null = null;
function getPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });
    publisher.on('error', (err) => log.error({ err }, 'publisher connection error'));
  }
  return publisher;
}

let subscriber: Redis | null = null;

/**
 * Publish the event to Redis; exactly one bridge-running process (possibly this
 * one) claims and handles it. Publishing is fire-and-forget: a pub/sub hiccup
 * must never block or fail the request/job path that triggered the event —
 * but if the bridge is active here and the publish FAILS, we fall back to a
 * local emit so the event is never silently lost.
 *
 * A process without the bridge (worker, unit tests, one-off scripts) keeps the
 * legacy synchronous local emit so its own listeners still fire.
 */
function dispatch(event: string, payload: unknown): void {
  const message: BridgeMessage = { origin: PROCESS_ID, eventId: randomUUID(), event, payload };
  const bridged = subscriber !== null;

  // Bridge-less process: local, synchronous delivery (legacy behaviour).
  if (!bridged) {
    eventBus.emit(event, payload);
  }

  getPublisher()
    .publish(EVENT_CHANNEL, JSON.stringify(message))
    .catch((err) => {
      log.error({ err, event }, 'publish failed');
      // Bridged process would otherwise lose the event entirely — deliver
      // locally. Other instances may miss it, but the side effects still run.
      if (bridged) eventBus.emit(event, payload);
    });
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
  subscriber.on('error', (err) => log.error({ err }, 'subscriber connection error'));

  subscriber.on('message', (channel, raw) => {
    if (channel !== EVENT_CHANNEL) return;
    void handleBridgeMessage(raw, tryClaimEvent, (event, payload) => eventBus.emit(event, payload), PROCESS_ID);
  });

  await subscriber.subscribe(EVENT_CHANNEL);
}

// Race the cross-instance claim for one event id. 'OK' ⇒ this process won and
// must run the listeners. The subscriber connection is in subscriber mode
// (SUBSCRIBE-only per ioredis), so the claim runs on the publisher connection.
async function tryClaimEvent(eventId: string): Promise<boolean> {
  const res = await getPublisher().set(claimKey(eventId), PROCESS_ID, 'EX', EVENT_CLAIM_TTL_SECONDS, 'NX');
  return res === 'OK';
}

/**
 * Handle one raw bridge message. Exported for unit tests (pure over its
 * injected claim/emit functions).
 *
 *  - Message WITH eventId → claim it; only the winner emits (exactly-once
 *    across all bridge-running instances, including the origin).
 *  - Claim ERROR (Redis hiccup) → emit anyway: prefer a duplicate side effect
 *    over a lost order event.
 *  - Message WITHOUT eventId (old-version process during a rolling reload) →
 *    legacy behaviour: skip our own echo, emit the rest.
 */
export async function handleBridgeMessage(
  raw: string,
  claim: (eventId: string) => Promise<boolean>,
  emit: (event: string, payload: unknown) => void,
  selfId: string,
): Promise<void> {
  let msg: BridgeMessage;
  try {
    msg = JSON.parse(raw) as BridgeMessage;
  } catch (err) {
    log.error({ err }, 'bridge received unparseable message');
    return;
  }

  if (!msg.eventId) {
    // Legacy message (mixed-version reload window): origin already emitted locally.
    if (msg.origin !== selfId) emit(msg.event, msg.payload);
    return;
  }

  try {
    if (await claim(msg.eventId)) emit(msg.event, msg.payload);
  } catch (err) {
    log.error({ err, event: msg.event }, 'claim failed — emitting locally');
    emit(msg.event, msg.payload);
  }
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
// ID DISCIPLINE (P1-3): every party id in an event payload is a **User.id** and
// is named `*UserId`. Profile ids (SellerProfile.id / RiderProfile.id — e.g.
// Order.riderId) must NEVER enter a payload: FCM tokens and socket rooms are
// keyed by User.id, so a profile id silently drops the notification.
export interface OrderStatusChangedPayload {
  orderId:  string;
  status:   string;
  shopId:   string;
  customerId: string; // User.id (customers have no separate profile-id keying)
  // NOTE: deliberately NO seller/rider ids here. Half the emit sites used to
  // pass '' or a RiderProfile.id, silently killing seller/rider pushes (P1-3).
  // Consumers that need them resolve User.ids from the order via
  // resolveOrderPartyUserIds (notifications module) — one authoritative path.
  // Set on a 'cancelled' transition when a prepaid payment was auto-refunded,
  // so the notification layer can tell the customer the exact amount (Chunk 3.5).
  refundedPaise?: number;
}

export interface NewOrderForSellerPayload {
  orderId:   string;
  shopId:    string;
  sellerUserId: string; // seller's User.id — NOT SellerProfile.id
  items:     Array<{ productName: string; quantity: number; unitPrice: number }>;
  totalAmount: number;
  paymentMethod: string;
  deliveryLocality: string;
}

export interface OrderCancelledForSellerPayload {
  orderId:  string;
  sellerUserId: string; // seller's User.id — NOT SellerProfile.id
  reason:   string;
}

export interface OrderAssignedToRiderPayload {
  orderId:  string;
  riderUserId: string; // rider's User.id — NOT RiderProfile.id (Order.riderId!)
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
