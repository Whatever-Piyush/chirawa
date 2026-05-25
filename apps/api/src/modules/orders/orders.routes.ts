import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createOrdersService } from './orders.service';
import { createPaymentsService } from '../payments/payments.service';
import { placeOrderSchema, type PlaceOrderInput } from './orders.schema';
import { authenticate, requireRole } from '../../shared/middleware/auth.middleware';
import { ValidationError } from '../../shared/errors/app-errors';

export default async function ordersRoutes(app: FastifyInstance): Promise<void> {
  const ordersService   = createOrdersService(app.prisma, app.redis);
  const paymentsService = createPaymentsService(app.prisma);

  app.addHook('preHandler', authenticate);

  // ── POST /api/v1/orders ────────────────────────────────────────────────────
  app.post(
    '/',
    async (request: FastifyRequest<{ Body: PlaceOrderInput }>, reply) => {
      const parsed = placeOrderSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const order = await ordersService.placeOrder(
        request.auth!.userId,
        parsed.data,
      );

      // For online payments, create Razorpay order immediately
      if (parsed.data.paymentMethod !== 'cod') {
        const payment = await paymentsService.createPaymentOrder(
          order.orderId,
          request.auth!.userId,
        );
        return reply.status(201).send({
          ...order,
          razorpayOrderId: payment.razorpayOrderId,
          razorpayKeyId:   payment.razorpayKeyId,
          amountPaise:     payment.amountPaise,
        });
      }

      return reply.status(201).send(order);
    },
  );

  // ── GET /api/v1/orders ─────────────────────────────────────────────────────
  app.get('/', async (request, reply) => {
    const orders = await ordersService.getMyOrders(
      request.auth!.userId,
      request.auth!.role,
    );
    return reply.send(orders);
  });

  // ── GET /api/v1/orders/:id ─────────────────────────────────────────────────
  app.get(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const order = await ordersService.getOrder(
        request.params.id,
        request.auth!.userId,
        request.auth!.role,
      );
      return reply.send(order);
    },
  );

  // ── DELETE /api/v1/orders/:id — cancel order ───────────────────────────────
  app.delete(
    '/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { reason?: string };
      }>,
      reply,
    ) => {
      const result = await ordersService.cancelOrder(
        request.params.id,
        request.auth!.userId,
        (request.body as { reason?: string })?.reason,
      );
      return reply.send(result);
    },
  );

  // ── POST /api/v1/orders/:id/cod-collected — rider confirms COD ─────────────
  app.post(
    '/:id/cod-collected',
    { preHandler: [requireRole('rider')] },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { amountPaise: number };
      }>,
      reply,
    ) => {
      const { amountPaise } = request.body as { amountPaise: number };
      const result = await ordersService.codCollected(
        request.params.id,
        request.auth!.userId,
        amountPaise,
      );
      return reply.send(result);
    },
  );
}
