import 'dotenv/config';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { env } from './config/env';
import { MAX_IMAGE_BYTES } from './services/r2.service';

import prismaPlugin        from './shared/plugins/prisma.plugin';
import redisPlugin         from './shared/plugins/redis.plugin';
import eventBusPlugin      from './shared/plugins/event-bus.plugin';
import queuePlugin         from './shared/plugins/queue.plugin';
import realtimePlugin      from './shared/plugins/realtime.plugin';
import notificationsPlugin from './modules/notifications/notifications.plugin';
import dispatchPlugin       from './modules/delivery/dispatch.plugin';
import sellerTimeoutPlugin  from './modules/orders/seller-timeout.plugin';

import authRoutes          from './modules/auth/auth.routes';
import usersRoutes         from './modules/users/users.routes';
import catalogRoutes       from './modules/catalog/catalog.routes';
import searchRoutes        from './modules/catalog/search.routes';
import cartRoutes          from './modules/cart/cart.routes';
import pricingRoutes       from './modules/pricing/pricing.routes';
import ordersRoutes        from './modules/orders/orders.routes';
import paymentsRoutes      from './modules/payments/payments.routes';
import deliveryRoutes      from './modules/delivery/delivery.routes';
import adminRoutes         from './modules/admin/admin.routes';
import loyaltyRoutes       from './modules/loyalty/loyalty.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import sellersRoutes       from './modules/sellers/sellers.routes';
import geoRoutes           from './modules/geo/geo.routes';
import recoveryRoutes      from './modules/recovery/recovery.routes';
import { initSentry, captureError } from './shared/observability/sentry';

export async function buildApp(): Promise<FastifyInstance> {
  initSentry('api'); // no-op without SENTRY_DSN (4.1)
  const app = Fastify({
    logger: {
      // LOG_LEVEL overrides the default in any environment (ops + load tests);
      // LOG_PRETTY=false drops the dev pretty-transport so a dev-mode process
      // can log production-shaped JSON (pino-pretty is real per-line overhead —
      // pretty debug logs would skew any measurement taken in dev mode).
      level: process.env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
      ...(env.NODE_ENV !== 'production' && process.env.LOG_PRETTY !== 'false' && {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname', colorize: true },
        },
      }),
    },
    trustProxy: env.TRUST_PROXY,
    genReqId: () => crypto.randomUUID(),
  });

  // ── Infrastructure ────────────────────────────────────────────────────────
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(eventBusPlugin);       // After redis — bridges worker→API events over Redis pub/sub
  await app.register(queuePlugin);          // After prisma + redis — job queues (app.queues)
  await app.register(realtimePlugin);
  await app.register(notificationsPlugin); // After prisma + redis
  await app.register(dispatchPlugin);       // Auto-assign confirmed orders to riders (after queues)
  await app.register(sellerTimeoutPlugin);  // Auto-accept orders on seller timeout (after queues)

  // ── HTTP Plugins ──────────────────────────────────────────────────────────
  await app.register(sensible);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin:         env.FRONTEND_URLS.split(',').map((u) => u.trim()),
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  // RATE_LIMIT_DISABLED=true skips the limiter entirely — load-test harness
  // only (scripts/loadtest), IMPOSSIBLE in production. Route-level
  // `config.rateLimit` entries are inert without the plugin, so no route breaks.
  const rateLimitDisabled =
    env.NODE_ENV !== 'production' && process.env.RATE_LIMIT_DISABLED === 'true';
  if (rateLimitDisabled) {
    app.log.warn('⚠️  rate limiting DISABLED (RATE_LIMIT_DISABLED=true, non-production)');
  } else {
    await app.register(rateLimit, {
      global:     true,
      // Dev gets a generous limit so HMR/poll loops don't trip the limiter;
      // production stays tight at 100/min per IP.
      max:        env.NODE_ENV === 'development' ? 1000 : 100,
      timeWindow: '1 minute',
      errorResponseBuilder: (_req, context) => ({
        success: false,
        error: {
          code:    'RATE_LIMIT_EXCEEDED',
          message: `Bahut zyada requests. ${context.after} baad try karein.`,
        },
      }),
    });
  }

  // Multipart — image uploads (admin only). 5 MB cap, single file per request.
  await app.register(multipart, {
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  });

  // ── Global Error Handler ──────────────────────────────────────────────────
  // Every error response follows a single shape: { success: false, error: { code, message } }.
  // Error codes are SCREAMING_SNAKE_CASE (see shared/errors/app-errors.ts).
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Request error');

    // App-defined errors (AppError subclasses) carry statusCode + code.
    if (error instanceof Error && 'statusCode' in error && 'code' in error) {
      return reply.status(error.statusCode as number).send({
        success: false,
        error: { code: String((error as { code: unknown }).code), message: error.message },
      });
    }

    // Fastify schema validation failures.
    if (error.validation) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request data' },
      });
    }

    // Rate limiter (defensive — errorResponseBuilder already shapes the body).
    if (error.statusCode === 429) {
      return reply.status(429).send({
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: error.message || 'Too many requests' },
      });
    }

    // Anything else → 500. Report to Sentry with request context (4.1).
    captureError(error, {
      reqId:  request.id,
      method: request.method,
      url:    request.url,
      userId: (request as { auth?: { userId?: string } }).auth?.userId,
    });
    // Never leak stack traces in production.
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message:
          env.NODE_ENV === 'production'
            ? 'Kuch galat ho gaya. Dobara try karein.'
            : error.message,
      },
    });
  });

  // ── Liveness (/health) — process is up. Used by PM2/uptime pings. ───────────
  app.get('/health',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (_req, reply) => reply.send({
      status: 'ok', service: 'chirawa-api',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      environment: env.NODE_ENV,
    }),
  );

  // ── Readiness (/ready) — DB + Redis reachable (4.4). Returns 503 if not, so a
  // load balancer / PM2 doesn't route traffic to a half-booted instance. ───────
  app.get('/ready',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (_req, reply) => {
      const [db, redis] = await Promise.all([
        app.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
        app.redis.ping().then((r) => r === 'PONG').catch(() => false),
      ]);
      const ready = db && redis;
      return reply.status(ready ? 200 : 503).send({
        status: ready ? 'ready' : 'not_ready',
        checks: { database: db, redis },
        timestamp: new Date().toISOString(),
      });
    },
  );

  // ── Module Routes ─────────────────────────────────────────────────────────
  await app.register(authRoutes,          { prefix: '/api/v1/auth' });
  await app.register(usersRoutes,         { prefix: '/api/v1/users' });
  await app.register(catalogRoutes,       { prefix: '/api/v1/catalog' });
  await app.register(searchRoutes,        { prefix: '/api/v1' });
  await app.register(cartRoutes,          { prefix: '/api/v1/cart' });
  await app.register(pricingRoutes,       { prefix: '/api/v1/pricing' });
  await app.register(ordersRoutes,        { prefix: '/api/v1/orders' });
  await app.register(paymentsRoutes,      { prefix: '/api/v1/payments' });
  await app.register(deliveryRoutes,      { prefix: '/api/v1/delivery' });
  await app.register(adminRoutes,         { prefix: '/api/v1/admin' });
  await app.register(loyaltyRoutes,       { prefix: '/api/v1/loyalty' });
  await app.register(notificationsRoutes, { prefix: '/api/v1/notifications' });
  await app.register(sellersRoutes,       { prefix: '/api/v1/sellers' });
  await app.register(geoRoutes,           { prefix: '/api/v1/geo' });
  await app.register(recoveryRoutes,      { prefix: '/api/v1/recovery' }); // Seller Sprint 5 Phase A (internal)

  return app;
}
