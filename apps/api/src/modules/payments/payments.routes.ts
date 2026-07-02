import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createPaymentsService } from './payments.service';
import {
  authenticate, requireRole,
} from '../../shared/middleware/auth.middleware';
import { verifyWebhookSignature } from './razorpay.service';
import { ValidationError, AuthenticationError } from '../../shared/errors/app-errors';
import { perUserRateLimit } from '../../shared/middleware/rate-limit';
import { z } from 'zod';

const verifyPaymentSchema = z.object({
  razorpayOrderId:   z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

export default async function paymentsRoutes(app: FastifyInstance): Promise<void> {
  const paymentsService = createPaymentsService(app.prisma);

  // ── POST /api/v1/payments/orders/:orderId ─────────────────────────────────
  // Create Razorpay payment order for a placed order
  // Route generics (<{ Params/Body }>) instead of annotated request/reply params —
  // a fully-annotated handler pins the route generic to RouteGenericInterface and
  // fails the exactOptionalPropertyTypes baseline (Fastify v4 TS docs).
  app.post<{ Params: { orderId: string } }>(
    '/orders/:orderId',
    { ...perUserRateLimit(30, '1 minute'), preHandler: [authenticate] },
    async (request, reply) => {
      const result = await paymentsService.createPaymentOrder(
        request.params.orderId,
        request.auth!.userId,
      );
      return reply.send(result);
    },
  );

  // ── POST /api/v1/payments/verify/:orderId ──────────────────────────────────
  // Client calls this after Razorpay checkout completes
  app.post<{
    Params: { orderId: string };
    Body: z.infer<typeof verifyPaymentSchema>;
  }>(
    '/verify/:orderId',
    { ...perUserRateLimit(30, '1 minute'), preHandler: [authenticate] },
    async (request, reply) => {
      const parsed = verifyPaymentSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const result = await paymentsService.verifyClientPayment(
        request.params.orderId,
        request.auth!.userId,
        parsed.data.razorpayOrderId,
        parsed.data.razorpayPaymentId,
        parsed.data.razorpaySignature,
      );
      return reply.send(result);
    },
  );

  // ── POST /api/v1/payments/refund/:orderId ──────────────────────────────────
  // Admin-only: initiate refund for an order
  app.post<{
    Params: { orderId: string };
    Body: { reason: string };
  }>(
    '/refund/:orderId',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { reason } = request.body as { reason: string };
      if (!reason?.trim()) throw new ValidationError('Refund reason required');

      const result = await paymentsService.initiateRefund(
        request.params.orderId,
        request.auth!.userId,
        reason,
      );
      return reply.send(result);
    },
  );

  // ── POST /api/v1/payments/webhook/razorpay ────────────────────────────────
  // Razorpay fires this on every payment event
  // Uses a sub-scope to capture raw body for signature verification
  await app.register(async (webhookScope) => {
    // Custom parser — captures raw body AS STRING before JSON parse
    // Required for HMAC-SHA256 signature verification
    webhookScope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (
        _req: FastifyRequest,
        body: Buffer,
        done: (err: Error | null, body?: unknown) => void,
      ) => {
        const rawBody = body.toString('utf8');
        // Attach to request for use in handler
        (_req as FastifyRequest & { rawBody: string }).rawBody = rawBody;
        try {
          done(null, JSON.parse(rawBody));
        } catch (err) {
          done(err as Error);
        }
      },
    );

    webhookScope.post(
      '/webhook/razorpay',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const rawBody  = (request as FastifyRequest & { rawBody: string }).rawBody ?? '';
        const sig      = request.headers['x-razorpay-signature'] as string ?? '';

        // Verify webhook signature — reject anything that fails
        if (!verifyWebhookSignature(rawBody, sig)) {
          throw new AuthenticationError('Invalid webhook signature');
        }

        // Process and respond within 5 seconds (Razorpay timeout)
        const result = await paymentsService.processWebhook(rawBody, sig);

        return reply.status(200).send({
          received: true,
          ...result,
        });
      },
    );
  });
}
