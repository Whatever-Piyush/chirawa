import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { startEventBusBridge, closeEventBus } from '../events/event-bus';

/**
 * Starts the cross-process event-bus bridge so events emitted in the WORKER
 * process (e.g. rider assignment from batching.service) reach the Socket.io and
 * notification listeners that live here in the API process.
 *
 * Must register AFTER redis so a connection is already available, and BEFORE the
 * realtime/notifications plugins isn't required — those only register listeners
 * on the local EventEmitter, which the bridge feeds at runtime.
 */
async function eventBusPlugin(app: FastifyInstance): Promise<void> {
  await startEventBusBridge();
  app.log.info('🔗 Event-bus cross-process bridge ready');

  app.addHook('onClose', async () => {
    await closeEventBus();
    app.log.info('Event-bus bridge closed');
  });
}

export default fp(eventBusPlugin, {
  name:         'event-bus',
  dependencies: ['redis'],
});
