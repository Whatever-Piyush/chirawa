import fp from 'fastify-plugin';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env';
import { eventBus, Events, type NewOrderForSellerPayload } from '../../shared/events/event-bus';
import {
  QueueNames, JobNames, SELLER_ACCEPT_MS, autoAcceptJobId, type AutoAcceptPayload,
} from '../../worker/queues';
import { createOrdersService } from './orders.service';

// Processed IN the API process (not the separate worker) because auto-accepting
// an online order must emit ORDER_STATUS_CHANGED on this process's event bus to
// trigger dispatch + the customer "confirmed" notification.
async function sellerTimeoutPlugin(app: FastifyInstance): Promise<void> {
  const orders = createOrdersService(app.prisma, app.redis);

  // Every new order presented to a seller starts an acceptance timer.
  eventBus.on(Events.NEW_ORDER_FOR_SELLER, (payload: NewOrderForSellerPayload) => {
    void app.queues.sellerAccept.add(
      JobNames.AUTO_ACCEPT,
      { orderId: payload.orderId } satisfies AutoAcceptPayload,
      // Stable jobId dedupes against the worker's reconciliation path (0.4).
      { delay: SELLER_ACCEPT_MS, jobId: autoAcceptJobId(payload.orderId), removeOnComplete: true, removeOnFail: true },
    ).catch((err) => app.log.error({ err }, 'Failed to schedule seller auto-accept'));
  });

  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
  const worker = new Worker(
    QueueNames.SELLER_ACCEPT,
    async (job) => {
      if (job.name !== JobNames.AUTO_ACCEPT) return;
      const { orderId } = job.data as AutoAcceptPayload;
      const result = await orders.autoAcceptOrder(orderId);
      if (result.autoAccepted) app.log.info({ orderId }, '⏱️ Order auto-accepted (seller timeout)');
    },
    { connection, concurrency: 5 },
  );
  worker.on('failed', (job, err) => app.log.error({ err, jobId: job?.id }, 'Seller auto-accept job failed'));

  app.addHook('onClose', async () => {
    await worker.close();
    await connection.quit();
  });

  app.log.info('⏱️ Seller acceptance-timeout watcher ready');
}

export default fp(sellerTimeoutPlugin, { name: 'seller-timeout', dependencies: ['prisma', 'redis', 'queues'] });
