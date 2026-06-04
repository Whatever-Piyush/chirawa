import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createDispatchService } from './dispatch.service';
import { authenticate, requireRole } from '../../shared/middleware/auth.middleware';
import { ValidationError } from '../../shared/errors/app-errors';

const availabilitySchema = z.object({
  status: z.enum(['online', 'offline', 'on_delivery']),
  lat:    z.number().min(-90).max(90).optional(),
  lng:    z.number().min(-180).max(180).optional(),
});

export default async function deliveryRoutes(app: FastifyInstance): Promise<void> {
  const dispatch = createDispatchService(app.prisma, app.redis);

  // GET /api/v1/delivery/availability — rider's current online/offline status
  app.get(
    '/availability',
    { preHandler: [authenticate, requireRole('rider')] },
    async (request, reply) => {
      return reply.send(await dispatch.getAvailability(request.auth!.userId));
    },
  );

  // PATCH /api/v1/delivery/availability — rider goes online / offline (Task 5.2)
  app.patch(
    '/availability',
    { preHandler: [authenticate, requireRole('rider')] },
    async (request, reply) => {
      const parsed = availabilitySchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      const result = await dispatch.setAvailability(
        request.auth!.userId, parsed.data.status, parsed.data.lat, parsed.data.lng,
      );
      return reply.send(result);
    },
  );

  // GET /api/v1/delivery/active — rider's current delivery batch (Task 5.5)
  app.get(
    '/active',
    { preHandler: [authenticate, requireRole('rider')] },
    async (request, reply) => {
      return reply.send(await dispatch.getActiveDelivery(request.auth!.userId));
    },
  );

  // POST /api/v1/delivery/orders/:orderId/pickup — rider picked the order up
  app.post(
    '/orders/:orderId/pickup',
    { preHandler: [authenticate, requireRole('rider')] },
    async (request, reply) => {
      const { orderId } = request.params as { orderId: string };
      return reply.send(await dispatch.markPickedUp(request.auth!.userId, orderId));
    },
  );

  // POST /api/v1/delivery/orders/:orderId/start-delivery — out for delivery
  app.post(
    '/orders/:orderId/start-delivery',
    { preHandler: [authenticate, requireRole('rider')] },
    async (request, reply) => {
      const { orderId } = request.params as { orderId: string };
      return reply.send(await dispatch.startDelivery(request.auth!.userId, orderId));
    },
  );

  // POST /api/v1/delivery/orders/:orderId/assign — manual / admin trigger of
  // auto-assignment (Task 5.3). The BullMQ worker calls the same service path.
  app.post(
    '/orders/:orderId/assign',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { orderId } = request.params as { orderId: string };
      const result = await dispatch.assignOrder(orderId);
      return reply.send(result);
    },
  );
}
