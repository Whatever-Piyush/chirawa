import fp from 'fastify-plugin';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { QueueNames } from '../../worker/queues';
import { env } from '../../config/env';

declare module 'fastify' {
  interface FastifyInstance {
    queues: {
      settlement:     Queue;
      reconciliation: Queue;
      cleanup:        Queue;
      referral:       Queue;
      notification:   Queue;
    };
  }
}

async function queuePlugin(app: FastifyInstance): Promise<void> {
  // BullMQ needs its own Redis connection with maxRetriesPerRequest: null
  const connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck:     false,
    lazyConnect:          true,
  });

  await connection.connect();

  const queues = {
    settlement:     new Queue(QueueNames.SETTLEMENT,     { connection }),
    reconciliation: new Queue(QueueNames.RECONCILIATION, { connection }),
    cleanup:        new Queue(QueueNames.CLEANUP,        { connection }),
    referral:       new Queue(QueueNames.REFERRAL,       { connection }),
    notification:   new Queue(QueueNames.NOTIFICATION,   { connection }),
  };

  app.decorate('queues', queues);

  app.addHook('onClose', async () => {
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await connection.quit();
  });

  app.log.info('📬 Job queues ready');
}

export default fp(queuePlugin, {
  name:         'queues',
  dependencies: ['prisma', 'redis'],
});
