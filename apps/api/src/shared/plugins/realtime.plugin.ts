import fp from 'fastify-plugin';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env';
import { verifyAccessToken } from '../../modules/auth/token.service';
import {
  eventBus, Events,
  type OrderStatusChangedPayload,
  type NewOrderForSellerPayload,
  type OrderCancelledForSellerPayload,
  type OrderAssignedToRiderPayload,
  type OrderItemUnavailablePayload,
  type OrderEtaChangedPayload,
} from '../events/event-bus';
import { isAuthorizedForOrderRoom, emitToOrderAndUser, parseRiderLocation } from './realtime.helpers';

// Extend Fastify to expose Socket.io instance to routes
declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
  }
}

// Extend Socket to carry auth context
interface SocketData {
  userId:    string;
  role:      string;
  profileId: string;
}

async function realtimePlugin(app: FastifyInstance): Promise<void> {
  // Lock CORS to the configured frontends in production; '*' only in dev (2.5).
  const corsOrigin = env.NODE_ENV === 'production'
    ? env.FRONTEND_URLS.split(',').map((u) => u.trim()).filter(Boolean)
    : '*';

  const io = new SocketIOServer(app.server, {
    cors: {
      origin:      corsOrigin,
      methods:     ['GET', 'POST'],
      credentials: true,
    },
    // WebSocket ONLY (audit P0-2). PM2 cluster round-robins connections across
    // instances with no session affinity, and Engine.IO long-polling REQUIRES
    // affinity — a polling client gets "Session ID unknown" 400s and never
    // connects. Every client (customer/rider/seller apps, test-realtime.mjs)
    // already forces transports: ['websocket']; disabling polling server-side
    // makes the broken mode unreachable. Clients on WS-blocking networks fall
    // back to the apps' REST polling (e.g. OrderTracking's poll loop).
    transports:          ['websocket'],
    pingTimeout:         20000,
    pingInterval:        25000,
    upgradeTimeout:      10000,
    maxHttpBufferSize:   1e6, // 1MB max message size
  });

  // Redis adapter (2.1) — fans broadcasts across all PM2 instances so a status
  // change handled on instance A reaches a customer socket on instance B. Uses
  // two DEDICATED pub/sub clients (duplicated from app.redis); never the BullMQ
  // connection. ioredis auto-connects, so no explicit .connect() is needed.
  const pubClient = app.redis.duplicate();
  const subClient = app.redis.duplicate();
  pubClient.on('error', (err) => app.log.error({ err }, 'socket.io redis pub error'));
  subClient.on('error', (err) => app.log.error({ err }, 'socket.io redis sub error'));
  io.adapter(createAdapter(pubClient, subClient));

  // ── JWT Authentication Middleware ─────────────────────────────────────────
  // Every socket connection must send a valid JWT token
  io.use((socket: Socket, next) => {
    const token =
      (socket.handshake.auth as Record<string, unknown>)['token'] as string ??
      socket.handshake.headers['authorization']?.toString().replace('Bearer ', '');

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const payload = verifyAccessToken(token);
      (socket as Socket & { data: SocketData }).data = {
        userId:    payload.sub,
        role:      payload.role,
        profileId: payload.profileId,
      };
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  // ── Connection Handler ────────────────────────────────────────────────────
  io.on('connection', (socket: Socket & { data: SocketData }) => {
    const { userId, role, profileId } = socket.data;
    app.log.debug(`🔌 Socket connected: ${userId} (${role})`);

    // Auto-join personal room — for direct notifications
    void socket.join(`user:${userId}`);

    // Role-based rooms — seller gets seller room, rider gets rider room
    if (role === 'seller') void socket.join(`seller:${userId}`);
    if (role === 'rider')  void socket.join(`rider:${userId}`);

    // ── Subscribe to order updates ──────────────────────────────────────────
    // Client joins this room to receive live status + location for that order.
    // IDOR guard: only the order's customer / owning seller / assigned rider /
    // admin may join — never an arbitrary authenticated user. Fail-closed.
    socket.on('order:subscribe', async (orderId: string) => {
      if (typeof orderId !== 'string' || !orderId) return;
      try {
        const order = await app.prisma.order.findUnique({
          where:  { id: orderId },
          select: {
            customerId: true,
            riderId:    true,                                       // RiderProfile.id
            shop:       { select: { seller: { select: { userId: true } } } },
          },
        });
        if (!isAuthorizedForOrderRoom({ userId, role, profileId }, order)) {
          app.log.warn(`🚫 order:subscribe DENIED — ${userId} (${role}) → order:${orderId}`);
          return;
        }
        app.log.debug(`${userId} subscribed to order:${orderId}`);
        void socket.join(`order:${orderId}`);
      } catch (err) {
        app.log.error({ err }, `order:subscribe authz check failed for order:${orderId}`);
      }
    });

    socket.on('order:unsubscribe', (orderId: string) => {
      void socket.leave(`order:${orderId}`);
    });

    // ── Rider location push (every 8 seconds) ──────────────────────────────
    // Only THE ASSIGNED rider may broadcast into an order room (audit P0-5) —
    // previously any rider could push coordinates into ANY order room and
    // insert unbounded RiderLocation rows. The assignment check is memoized
    // per socket (30s TTL) so the steady-state path costs no DB read, and a
    // released/cancelled assignment stops broadcasting within the TTL.
    const riderOrderAuthz = new Map<string, number>();       // orderId → authorized-until (ms)
    const riderLocDbWrite = new Map<string, number>();       // orderId → last DB persist (ms)
    const RIDER_AUTHZ_TTL_MS    = 30_000;
    const RIDER_DB_WRITE_MIN_MS = 10_000;

    socket.on('rider:location', async (data: unknown) => {
      if (role !== 'rider') return;
      const loc = parseRiderLocation(data);                  // validates orderId/lat/lng bounds
      if (!loc) return;

      const now = Date.now();
      if ((riderOrderAuthz.get(loc.orderId) ?? 0) < now) {
        try {
          // Order.riderId / DeliveryAssignment.riderId store RiderProfile.id,
          // which is this socket's profileId for riders.
          const assignment = await app.prisma.deliveryAssignment.findFirst({
            where:  { orderId: loc.orderId, riderId: profileId, isActive: true },
            select: { id: true },
          });
          if (!assignment) {
            app.log.debug(`🚫 rider:location DENIED — ${userId} → order:${loc.orderId}`);
            return;
          }
          riderOrderAuthz.set(loc.orderId, now + RIDER_AUTHZ_TTL_MS);
        } catch (err) {
          app.log.error({ err }, `rider:location authz check failed for order:${loc.orderId}`);
          return; // fail-closed
        }
      }

      // Write to Redis — 30s TTL auto-expires if rider disconnects
      // Key format: rider:{riderId}:location
      await app.redis.setex(
        `rider:${userId}:location`,
        30,
        JSON.stringify({ lat: loc.lat, lng: loc.lng, ts: loc.timestamp }),
      ).catch(() => {}); // Non-blocking, never fail the socket event

      // Broadcast to all subscribers of this order room (customer + seller)
      io.to(`order:${loc.orderId}`).emit('order:location', {
        riderId:   userId,
        orderId:   loc.orderId,
        lat:       loc.lat,
        lng:       loc.lng,
        timestamp: loc.timestamp,
      });

      // Persist for support dispute records (7-day retention), throttled to one
      // row per order per 10s so a hot client can't amplify inserts — the live
      // broadcast above stays at full rate. Fire and forget.
      if (now - (riderLocDbWrite.get(loc.orderId) ?? 0) >= RIDER_DB_WRITE_MIN_MS) {
        riderLocDbWrite.set(loc.orderId, now);
        app.prisma.riderLocation.create({
          data: {
            riderId: userId,
            orderId: loc.orderId,
            lat:     loc.lat,
            lng:     loc.lng,
          },
        }).catch(() => {});
      }
    });

    // ── Rider availability toggle ───────────────────────────────────────────
    socket.on('rider:availability', async (status: 'online' | 'offline') => {
      if (role !== 'rider') return;
      if (!['online', 'offline'].includes(status)) return;

      await app.prisma.riderAvailability.upsert({
        where:  { riderId: userId },
        update: { status, lastSeenAt: new Date() },
        create: { riderId: userId, status },
      }).catch(() => {});

      socket.emit('rider:availability:confirmed', { status });
    });

    socket.on('disconnect', (reason) => {
      app.log.debug(`🔌 Socket disconnected: ${userId} — ${reason}`);
    });

    // Confirm connection to client
    socket.emit('connected', {
      userId,
      role,
      timestamp: new Date().toISOString(),
      message:   'Real-time connection established',
    });
  });

  // ── Wire Internal Event Bus → Socket.io ───────────────────────────────────
  // Services emit to eventBus → we broadcast via Socket.io
  // This is where the two systems meet.

  eventBus.on(Events.ORDER_STATUS_CHANGED, (payload: OrderStatusChangedPayload) => {
    // Single union emit to the order room + the customer's personal room. A
    // customer subscribed to BOTH receives this exactly once (was emitted twice).
    emitToOrderAndUser(io, payload.orderId, payload.customerId, 'order:status', {
      orderId:   payload.orderId,
      status:    payload.status,
      timestamp: new Date().toISOString(),
    });

    app.log.debug(`📡 Order ${payload.orderId} status → ${payload.status}`);
  });

  eventBus.on(Events.ORDER_ETA_CHANGED, (payload: OrderEtaChangedPayload) => {
    // Server-computed ETA changed (ETA MVP Phase 1). Send a DURATION + serverNow, not a
    // bare absolute timestamp, so the client countdown is clock-skew safe (review F3).
    const now = Date.now();
    const body = {
      orderId:          payload.orderId,
      secondsRemaining: Math.max(0, Math.round((new Date(payload.estimatedDeliveryAt).getTime() - now) / 1000)),
      spreadSeconds:    payload.etaSpreadSeconds,
      serverNow:        new Date(now).toISOString(),
      status:           payload.status,
      source:           payload.source,
    };
    // Single union emit (order room + customer room) — dedups for the customer
    // watching their own order, who is in both rooms (was emitted twice).
    emitToOrderAndUser(io, payload.orderId, payload.customerId, 'order:eta', body);
    app.log.debug(`⏱️  Order ${payload.orderId} eta → ${body.secondsRemaining}s`);
  });

  eventBus.on(Events.NEW_ORDER_FOR_SELLER, (payload: NewOrderForSellerPayload) => {
    // Full-screen modal trigger for seller app
    // The seller app shows an audible alarm until Accept/Reject is tapped
    io.to(`seller:${payload.sellerUserId}`).emit('order:new', {
      orderId:          payload.orderId,
      items:            payload.items,
      totalAmount:      payload.totalAmount,
      paymentMethod:    payload.paymentMethod,
      deliveryLocality: payload.deliveryLocality,
      timestamp:        new Date().toISOString(),
    });

    app.log.debug(`🔔 New order alert sent to seller: ${payload.sellerUserId}`);
  });

  eventBus.on(Events.ORDER_CANCELLED_FOR_SELLER, (payload: OrderCancelledForSellerPayload) => {
    // Customer cancelled — tell the seller so their queue updates + alarm closes
    io.to(`seller:${payload.sellerUserId}`).emit('order:cancelled', {
      orderId:   payload.orderId,
      reason:    payload.reason,
      timestamp: new Date().toISOString(),
    });

    app.log.debug(`❌ Order ${payload.orderId} cancelled → seller ${payload.sellerUserId}`);
  });

  eventBus.on(Events.ORDER_ASSIGNED_TO_RIDER, (payload: OrderAssignedToRiderPayload) => {
    // 60-second accept window starts on client when this arrives
    io.to(`rider:${payload.riderUserId}`).emit('order:assigned', {
      orderId:          payload.orderId,
      shopName:         payload.shopName,
      shopAddress:      payload.shopAddress,
      deliveryLocality: payload.deliveryLocality,
      totalAmount:      payload.totalAmount,
      paymentMethod:    payload.paymentMethod,
      timestamp:        new Date().toISOString(),
    });

    app.log.debug(`🚴 Order assigned to rider: ${payload.riderUserId}`);
  });

  eventBus.on(Events.ORDER_ITEM_UNAVAILABLE, (payload: OrderItemUnavailablePayload) => {
    // Live "item just sold out" update for the customer — the line was refunded
    // and we offer a substitute to tap (ask, don't auto-sub). Phase 5 safety net.
    io.to(`user:${payload.customerId}`).emit('order:item-unavailable', {
      orderId:       payload.orderId,
      productName:   payload.productName,
      refundedPaise: payload.refundedPaise,
      cancelled:     payload.cancelled,
      ...(payload.suggestion ? { suggestion: payload.suggestion } : {}),
      timestamp:     new Date().toISOString(),
    });

    app.log.debug(`🧺 Item unavailable on order ${payload.orderId} → customer ${payload.customerId}`);
  });

  // ── Decorate app with io instance ─────────────────────────────────────────
  app.decorate('io', io);

  app.addHook('onClose', async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await Promise.allSettled([pubClient.quit(), subClient.quit()]);
    app.log.info('Socket.io server closed');
  });

  app.log.info('⚡ Socket.io real-time server ready');
}

export default fp(realtimePlugin, {
  name:         'realtime',
  dependencies: ['prisma', 'redis'],
});
