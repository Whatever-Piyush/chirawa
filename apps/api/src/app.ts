import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env';

// Module route plugins — all stubbed now, filled in per step
import authRoutes     from './modules/auth/auth.routes';
import usersRoutes    from './modules/users/users.routes';
import catalogRoutes  from './modules/catalog/catalog.routes';
import cartRoutes     from './modules/cart/cart.routes';
import pricingRoutes  from './modules/pricing/pricing.routes';
import ordersRoutes   from './modules/orders/orders.routes';
import paymentsRoutes from './modules/payments/payments.routes';
import deliveryRoutes from './modules/delivery/delivery.routes';
import adminRoutes    from './modules/admin/admin.routes';
import loyaltyRoutes  from './modules/loyalty/loyalty.routes';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      ...(env.NODE_ENV !== 'production' && {
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
            colorize: true,
          },
        },
      }),
    },
    // Trust Cloudflare/Nginx proxy headers (X-Forwarded-For)
    trustProxy: true,
    // Include a request ID on every request for log tracing
    genReqId: () => crypto.randomUUID(),
  });

  // ── Security & Utility Plugins ──────────────────────────────────────────────
  await app.register(sensible); // Adds reply.notFound(), badRequest() etc

  await app.register(helmet, {
    contentSecurityPolicy: false, // API only — no HTML served
  });

  await app.register(cors, {
    origin: env.FRONTEND_URLS.split(',').map((u) => u.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    // Custom Hindi error message
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Bahut zyada requests. ${context.after} baad try karein.`,
      code: 'RATE_LIMIT_EXCEEDED',
    }),
  });

  // ── Global Error Handler ──────────────────────────────────────────────────
  // Single place that converts ALL errors to consistent JSON.
  // Order matters: check most specific conditions first.
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Request error');

    // Our custom AppError (ValidationError, NotFoundError, etc.)
    if (error instanceof Error && 'statusCode' in error && 'code' in error) {
      return reply.status(error.statusCode as number).send({
        statusCode: error.statusCode,
        error: error.name,
        message: error.message,
        code: error.code,
      });
    }

    // Fastify's built-in validation errors (JSON schema failures)
    if (error.validation) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid request data',
        code: 'VALIDATION_ERROR',
        details: error.validation,
      });
    }

    // Rate limit (already formatted by errorResponseBuilder above)
    if (error.statusCode === 429) {
      return reply.status(429).send(error);
    }

    // Unhandled — hide internals in production
    return reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: env.NODE_ENV === 'production'
        ? 'Kuch galat ho gaya. Dobara try karein.'
        : error.message,
      code: 'INTERNAL_ERROR',
    });
  });

  // ── Health Check ──────────────────────────────────────────────────────────
  // Higher rate limit — used by UptimeRobot every 5 minutes
  app.get(
    '/health',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (_request, reply) => {
      return reply.send({
        status: 'ok',
        service: 'chirawa-api',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        environment: env.NODE_ENV,
      });
    },
  );

  // ── Module Routes ──────────────────────────────────────────────────────────
  // Each module is a Fastify plugin with its own encapsulated scope.
  // Prefix = /api/v1/{module} — versioned for future API changes.
  await app.register(authRoutes,     { prefix: '/api/v1/auth' });
  await app.register(usersRoutes,    { prefix: '/api/v1/users' });
  await app.register(catalogRoutes,  { prefix: '/api/v1/catalog' });
  await app.register(cartRoutes,     { prefix: '/api/v1/cart' });
  await app.register(pricingRoutes,  { prefix: '/api/v1/pricing' });
  await app.register(ordersRoutes,   { prefix: '/api/v1/orders' });
  await app.register(paymentsRoutes, { prefix: '/api/v1/payments' });
  await app.register(deliveryRoutes, { prefix: '/api/v1/delivery' });
  await app.register(adminRoutes,    { prefix: '/api/v1/admin' });
  await app.register(loyaltyRoutes,  { prefix: '/api/v1/loyalty' });

  return app;
}
