import 'dotenv/config';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env';

import prismaPlugin        from './shared/plugins/prisma.plugin';
import redisPlugin         from './shared/plugins/redis.plugin';
import realtimePlugin      from './shared/plugins/realtime.plugin';
import notificationsPlugin from './modules/notifications/notifications.plugin';

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

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      ...(env.NODE_ENV !== 'production' && {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname', colorize: true },
        },
      }),
    },
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });

  // ── Infrastructure ────────────────────────────────────────────────────────
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(realtimePlugin);
  await app.register(notificationsPlugin); // After prisma + redis

  // ── HTTP Plugins ──────────────────────────────────────────────────────────
  await app.register(sensible);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin:         env.FRONTEND_URLS.split(',').map((u) => u.trim()),
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  await app.register(rateLimit, {
    global:     true,
    // Dev gets a generous limit so HMR/poll loops don't trip the limiter;
    // production stays tight at 100/min per IP.
    max:        env.NODE_ENV === 'development' ? 1000 : 100,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error:   'Too Many Requests',
      message: `Bahut zyada requests. ${context.after} baad try karein.`,
      code:    'RATE_LIMIT_EXCEEDED',
    }),
  });

  // ── Global Error Handler ──────────────────────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Request error');
    if (error instanceof Error && 'statusCode' in error && 'code' in error) {
      return reply.status(error.statusCode as number).send({
        statusCode: error.statusCode, error: error.name,
        message: error.message, code: error.code,
      });
    }
    if (error.validation) {
      return reply.status(400).send({
        statusCode: 400, error: 'Bad Request',
        message: 'Invalid request data', code: 'VALIDATION_ERROR',
        details: error.validation,
      });
    }
    if (error.statusCode === 429) return reply.status(429).send(error);
    return reply.status(500).send({
      statusCode: 500, error: 'Internal Server Error',
      message: env.NODE_ENV === 'production'
        ? 'Kuch galat ho gaya. Dobara try karein.'
        : error.message,
      code: 'INTERNAL_ERROR',
    });
  });

  // ── Health Check ──────────────────────────────────────────────────────────
  app.get('/health',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (_req, reply) => reply.send({
      status: 'ok', service: 'chirawa-api',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      environment: env.NODE_ENV,
    }),
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

  return app;
}
