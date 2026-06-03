import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { eventBus, Events, type OrderStatusChangedPayload } from '../../shared/events/event-bus';
import { createBatchingService } from './batching.service';
import { JobNames, type AssignBatchPayload } from '../../worker/queues';

// Accumulation window: a confirmed order opens (or joins) a batch; the batch is
// assigned when it fills (3 orders) or its window elapses (Task 5.4). Configurable.
const BATCH_WINDOW_MS = Number(process.env.BATCH_WINDOW_MS ?? 180_000); // 3 min

// Auto-dispatch trigger (Chunk 5.3/5.4): when an order becomes `confirmed`, slot
// it into a delivery batch and schedule that batch's assignment via the worker
// (which assigns to the best rider and retries/escalates if none is online).
// Fire-and-forget so it never blocks the status transition that emitted it.
async function dispatchPlugin(app: FastifyInstance): Promise<void> {
  const batching = createBatchingService(app.prisma, app.redis);

  eventBus.on(Events.ORDER_STATUS_CHANGED, (payload: OrderStatusChangedPayload) => {
    if (payload.status !== 'confirmed') return;
    void (async () => {
      try {
        const { batchId, action } = await batching.addConfirmedOrderToBatch(payload.orderId, BATCH_WINDOW_MS);

        if (action === 'joined' || action === 'none') {
          // An existing batch (and its scheduled assignment job) already covers this.
          app.log.info({ orderId: payload.orderId, batchId, action }, '🛵 Order added to batch');
          return;
        }

        // 'new' → assign after the window; 'assign-now' (batch full) → assign immediately.
        const delay = action === 'assign-now' ? 0 : BATCH_WINDOW_MS;
        await app.queues.assignment.add(
          JobNames.ASSIGN_BATCH,
          { batchId, attempt: 1 } satisfies AssignBatchPayload,
          { delay, removeOnComplete: true, removeOnFail: true },
        );
        app.log.info({ orderId: payload.orderId, batchId, action, delay }, '🛵 Batch scheduled for assignment');
      } catch (err) {
        app.log.error({ err, orderId: payload.orderId }, '🛵 Batch dispatch failed');
      }
    })();
  });

  app.log.info('🛵 Dispatch (batched auto-assignment) ready');
}

export default fp(dispatchPlugin, { name: 'dispatch', dependencies: ['prisma', 'redis', 'queues'] });
