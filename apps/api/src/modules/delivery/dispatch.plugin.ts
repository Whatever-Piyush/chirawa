import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { eventBus, Events, type OrderStatusChangedPayload } from '../../shared/events/event-bus';
import { createDispatchService } from './dispatch.service';
import { JobNames, type AssignOrderPayload } from '../../worker/queues';

const RETRY_DELAY_MS = Number(process.env.ASSIGN_RETRY_MS ?? 60_000);

// Auto-assignment trigger (Chunk 5.3): when an order becomes `confirmed` (seller
// accepted), hand it to the best available rider. The first attempt runs
// in-process for speed; if no rider is online it enqueues a BullMQ retry job
// (the worker retries every 60s and escalates to the founder after ~10 min).
// Fire-and-forget so it never blocks the status transition that emitted it.
async function dispatchPlugin(app: FastifyInstance): Promise<void> {
  const dispatch = createDispatchService(app.prisma, app.redis);

  eventBus.on(Events.ORDER_STATUS_CHANGED, (payload: OrderStatusChangedPayload) => {
    if (payload.status !== 'confirmed') return;
    void (async () => {
      try {
        const result = await dispatch.assignOrder(payload.orderId);
        if (result.assigned) {
          app.log.info({ orderId: payload.orderId, riderId: result.riderId, zone: result.zone }, '🛵 Auto-assigned order');
          return;
        }
        if (result.reason === 'already_assigned') return;

        // No rider online right now → hand off to the worker for retry/escalation.
        await app.queues.assignment.add(
          JobNames.ASSIGN_ORDER,
          { orderId: payload.orderId, attempt: 1 } satisfies AssignOrderPayload,
          { delay: RETRY_DELAY_MS, removeOnComplete: true, removeOnFail: true },
        );
        app.log.warn({ orderId: payload.orderId, reason: result.reason }, '🛵 No rider yet — queued for retry');
      } catch (err) {
        app.log.error({ err, orderId: payload.orderId }, '🛵 Auto-assign failed');
      }
    })();
  });

  app.log.info('🛵 Dispatch auto-assignment ready');
}

export default fp(dispatchPlugin, { name: 'dispatch', dependencies: ['prisma', 'redis', 'queues'] });
