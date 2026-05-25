import fp from 'fastify-plugin';
import Redis from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

async function redisPlugin(app: FastifyInstance): Promise<void> {
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    // Keep connection alive
    keepAlive: 10000,
    // Reconnect strategy
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });

  await redis.connect();
  app.log.info('Redis connected');

  app.decorate('redis', redis);

  app.addHook('onClose', async () => {
    await redis.quit();
    app.log.info('Redis disconnected');
  });
}

export default fp(redisPlugin, { name: 'redis' });
