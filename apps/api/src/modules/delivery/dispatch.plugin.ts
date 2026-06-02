import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { eventBus, Events, type OrderStatusChangedPayload } from '../../shared/events/event-bus';
import { createDispatchService } from './dispatch.service';

// Auto-assignment trigger (Chunk 5.3): when an order becomes `confirmed` (seller
// accepted), hand it to the best available rider. Runs in-process off the event
// bus — fire-and-forget so it never blocks the status transition that emitted it.
// (A BullMQ retry/escalation layer for the "no rider available" case is the next
// step; for now an unassigned order is logged and can be assigned manually via
// POST /delivery/orders/:id/assign.)
async function dispatchPlugin(app: FastifyInstance): Promise<void> {
  const dispatch = createDispatchService(app.prisma, app.redis);

  eventBus.on(Events.ORDER_STATUS_CHANGED, (payload: OrderStatusChangedPayload) => {
    if (payload.status !== 'confirmed') return;
    void (async () => {
      try {
        const result = await dispatch.assignOrder(payload.orderId);
        if (result.assigned) {
          app.log.info({ orderId: payload.orderId, riderId: result.riderId, zone: result.zone }, '🛵 Auto-assigned order');
        } else {
          app.log.warn({ orderId: payload.orderId, reason: result.reason }, '🛵 Auto-assign: no rider yet');
        }
      } catch (err) {
        app.log.error({ err, orderId: payload.orderId }, '🛵 Auto-assign failed');
      }
    })();
  });

  app.log.info('🛵 Dispatch auto-assignment ready');
}

export default fp(dispatchPlugin, { name: 'dispatch', dependencies: ['prisma', 'redis'] });
