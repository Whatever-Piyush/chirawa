import fp from 'fastify-plugin';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { verifyAccessToken } from '../../modules/auth/token.service';
import {
  eventBus, Events,
  type OrderStatusChangedPayload,
  type NewOrderForSellerPayload,
  type OrderAssignedToRiderPayload,
} from '../events/event-bus';

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
  const io = new SocketIOServer(app.server, {
    cors: {
      origin:      '*', // Tightened in production via env
      methods:     ['GET', 'POST'],
      credentials: true,
    },
    transports:          ['websocket', 'polling'],
    pingTimeout:         20000,
    pingInterval:        25000,
    upgradeTimeout:      10000,
    maxHttpBufferSize:   1e6, // 1MB max message size
  });

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
    const { userId, role } = socket.data;
    app.log.debug(`🔌 Socket connected: ${userId} (${role})`);

    // Auto-join personal room — for direct notifications
    void socket.join(`user:${userId}`);

    // Role-based rooms — seller gets seller room, rider gets rider room
    if (role === 'seller') void socket.join(`seller:${userId}`);
    if (role === 'rider')  void socket.join(`rider:${userId}`);

    // ── Subscribe to order updates ──────────────────────────────────────────
    // Client joins this room to receive live status + location for that order
    socket.on('order:subscribe', (orderId: string) => {
      if (typeof orderId !== 'string' || !orderId) return;
      app.log.debug(`${userId} subscribed to order:${orderId}`);
      void socket.join(`order:${orderId}`);
    });

    socket.on('order:unsubscribe', (orderId: string) => {
      void socket.leave(`order:${orderId}`);
    });

    // ── Rider location push (every 8 seconds) ──────────────────────────────
    // Only riders can send location. Server writes to Redis + broadcasts.
    socket.on(
      'rider:location',
      async (data: { orderId: string; lat: number; lng: number; timestamp: number }) => {
        if (role !== 'rider') return;
        if (!data?.orderId || !data?.lat || !data?.lng) return;

        // Write to Redis — 30s TTL auto-expires if rider disconnects
        // Key format: rider:{riderId}:location
        await app.redis.setex(
          `rider:${userId}:location`,
          30,
          JSON.stringify({ lat: data.lat, lng: data.lng, ts: data.timestamp }),
        ).catch(() => {}); // Non-blocking, never fail the socket event

        // Broadcast to all subscribers of this order room (customer + seller)
        io.to(`order:${data.orderId}`).emit('order:location', {
          riderId:   userId,
          orderId:   data.orderId,
          lat:       data.lat,
          lng:       data.lng,
          timestamp: data.timestamp,
        });

        // Write to DB for support dispute records (7-day retention)
        // Fire and forget — never block location broadcasting
        app.prisma.riderLocation.create({
          data: {
            riderId: userId,
            orderId: data.orderId,
            lat:     data.lat,
            lng:     data.lng,
          },
        }).catch(() => {});
      },
    );

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
    // Broadcast to everyone watching this order
    io.to(`order:${payload.orderId}`).emit('order:status', {
      orderId:   payload.orderId,
      status:    payload.status,
      timestamp: new Date().toISOString(),
    });

    // Also notify customer's personal room (even if not subscribed to order room)
    io.to(`user:${payload.customerId}`).emit('order:status', {
      orderId: payload.orderId,
      status:  payload.status,
      timestamp: new Date().toISOString(),
    });

    app.log.debug(`📡 Order ${payload.orderId} status → ${payload.status}`);
  });

  eventBus.on(Events.NEW_ORDER_FOR_SELLER, (payload: NewOrderForSellerPayload) => {
    // Full-screen modal trigger for seller app
    // The seller app shows an audible alarm until Accept/Reject is tapped
    io.to(`seller:${payload.sellerId}`).emit('order:new', {
      orderId:          payload.orderId,
      items:            payload.items,
      totalAmount:      payload.totalAmount,
      paymentMethod:    payload.paymentMethod,
      deliveryLocality: payload.deliveryLocality,
      timestamp:        new Date().toISOString(),
    });

    app.log.debug(`🔔 New order alert sent to seller: ${payload.sellerId}`);
  });

  eventBus.on(Events.ORDER_ASSIGNED_TO_RIDER, (payload: OrderAssignedToRiderPayload) => {
    // 60-second accept window starts on client when this arrives
    io.to(`rider:${payload.riderId}`).emit('order:assigned', {
      orderId:          payload.orderId,
      shopName:         payload.shopName,
      shopAddress:      payload.shopAddress,
      deliveryLocality: payload.deliveryLocality,
      totalAmount:      payload.totalAmount,
      paymentMethod:    payload.paymentMethod,
      timestamp:        new Date().toISOString(),
    });

    app.log.debug(`🚴 Order assigned to rider: ${payload.riderId}`);
  });

  // ── Decorate app with io instance ─────────────────────────────────────────
  app.decorate('io', io);

  app.addHook('onClose', async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    app.log.info('Socket.io server closed');
  });

  app.log.info('⚡ Socket.io real-time server ready');
}

export default fp(realtimePlugin, {
  name:         'realtime',
  dependencies: ['prisma', 'redis'],
});
