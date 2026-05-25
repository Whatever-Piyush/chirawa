import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors/app-errors';

const fcmTokenKey = (userId: string) => `fcm:token:${userId}`;

const registerTokenSchema = z.object({
  token:    z.string().min(10).max(500),
  platform: z.enum(['android', 'ios']).default('android'),
});

export default async function notificationsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  // POST /api/v1/notifications/register-token
  // Called by React Native app on startup and when FCM token refreshes
  app.post(
    '/register-token',
    async (
      request: FastifyRequest<{
        Body: z.infer<typeof registerTokenSchema>;
      }>,
      reply,
    ) => {
      const parsed = registerTokenSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const { token, platform } = parsed.data;
      const userId = request.auth!.userId;

      // Store in Redis — 90 day TTL (tokens expire if app not opened)
      await app.redis.setex(
        fcmTokenKey(userId),
        90 * 24 * 60 * 60,
        token,
      );

      app.log.debug(`FCM token registered for ${userId} (${platform})`);

      return reply.status(200).send({ message: 'Token registered' });
    },
  );

  // DELETE /api/v1/notifications/register-token
  // Called on logout — removes token so notifications stop
  app.delete(
    '/register-token',
    async (request, reply) => {
      await app.redis.del(fcmTokenKey(request.auth!.userId));
      return reply.status(204).send();
    },
  );

  // GET /api/v1/notifications — get my notification history
  app.get(
    '/',
    async (request, reply) => {
      const notifications = await app.prisma.notification.findMany({
        where:   { userId: request.auth!.userId },
        orderBy: { sentAt: 'desc' },
        take:    50,
        select:  { id: true, channel: true, eventType: true, title: true, body: true, sentAt: true, isRead: true },
      });
      return reply.send(notifications);
    },
  );

  // PATCH /api/v1/notifications/:id/read
  app.patch(
    '/:id/read',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply,
    ) => {
      await app.prisma.notification.updateMany({
        where: { id: request.params.id, userId: request.auth!.userId },
        data:  { isRead: true },
      });
      return reply.status(200).send({ message: 'Marked as read' });
    },
  );
}
