import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createOrdersService } from './orders.service';
import { createPaymentsService } from '../payments/payments.service';
import { placeOrderSchema, rateOrderSchema, type PlaceOrderInput, type RateOrderInput } from './orders.schema';
import { authenticate, requireRole } from '../../shared/middleware/auth.middleware';
import { ValidationError } from '../../shared/errors/app-errors';
import { runIdempotent, readIdempotencyKey } from '../../shared/utils/idempotency';
import { perUserRateLimit } from '../../shared/middleware/rate-limit';

export default async function ordersRoutes(app: FastifyInstance): Promise<void> {
  const ordersService   = createOrdersService(app.prisma, app.redis);
  const paymentsService = createPaymentsService(app.prisma);

  app.addHook('preHandler', authenticate);

  // POST /api/v1/orders — per-user cap on checkout (4.8) on top of the global per-IP limit.
  app.post('/', perUserRateLimit(20, '1 minute'), async (request: FastifyRequest<{ Body: PlaceOrderInput }>, reply) => {
    const parsed = placeOrderSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');

    // The actual order-creation work, run at most once per Idempotency-Key.
    const createOrder = async (): Promise<{ status: number; body: unknown }> => {
      const order = await ordersService.placeOrder(request.auth!.userId, parsed.data);

      if (parsed.data.paymentMethod !== 'cod') {
        // A multi-shop cart produced one order per shop; charge the grand total of
        // ALL of them in a single Razorpay order (previously only the primary order
        // was charged, undercharging multi-shop carts).
        const payment = await paymentsService.createCartPaymentOrder(order.orderIds, request.auth!.userId);
        return { status: 201, body: { ...order, razorpayOrderId: payment.razorpayOrderId, razorpayKeyId: payment.razorpayKeyId, amountPaise: payment.amountPaise } };
      }
      return { status: 201, body: order };
    };

    // Idempotency-Key (optional): guards against double-tap / retry-after-timeout
    // creating duplicate orders + duplicate Razorpay charges. Scoped per user.
    const idemKey = readIdempotencyKey(request.headers['idempotency-key']);
    const result = idemKey
      ? await runIdempotent(app.redis, `order:${request.auth!.userId}`, idemKey, createOrder)
      : await createOrder();

    return reply.status(result.status).send(result.body);
  });

  // GET /api/v1/orders
  app.get('/', async (request, reply) => {
    const orders = await ordersService.getMyOrders(request.auth!.userId, request.auth!.role);
    return reply.send(orders);
  });

  // GET /api/v1/orders/:id
  app.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const order = await ordersService.getOrder(request.params.id, request.auth!.userId, request.auth!.role);
    return reply.send(order);
  });

  // DELETE /api/v1/orders/:id
  app.delete('/:id', async (request: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>, reply) => {
    const result = await ordersService.cancelOrder(request.params.id, request.auth!.userId, (request.body as { reason?: string })?.reason);
    return reply.send(result);
  });

  // ── Seller actions ────────────────────────────────────────────────────────

  // POST /api/v1/orders/:id/accept
  app.post('/:id/accept',
    { preHandler: [requireRole('seller')] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const result = await ordersService.sellerAcceptOrder(request.params.id, request.auth!.userId);
      return reply.send(result);
    },
  );

  // POST /api/v1/orders/:id/reject
  app.post('/:id/reject',
    { preHandler: [requireRole('seller')] },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { reason: string } }>, reply) => {
      const { reason } = request.body as { reason: string };
      const result = await ordersService.sellerRejectOrder(request.params.id, request.auth!.userId, reason ?? 'Seller ne reject kiya');
      return reply.send(result);
    },
  );

  // POST /api/v1/orders/:id/preparing
  app.post('/:id/preparing',
    { preHandler: [requireRole('seller')] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const result = await ordersService.sellerMarkPreparing(request.params.id, request.auth!.userId);
      return reply.send(result);
    },
  );

  // POST /api/v1/orders/:id/ready
  app.post('/:id/ready',
    { preHandler: [requireRole('seller')] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const result = await ordersService.sellerMarkReady(request.params.id, request.auth!.userId);
      return reply.send(result);
    },
  );

  // POST /api/v1/orders/:id/cod-collected
  app.post('/:id/cod-collected',
    { preHandler: [requireRole('rider')] },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { amountPaise: number } }>, reply) => {
      const { amountPaise } = request.body as { amountPaise: number };
      const result = await ordersService.codCollected(request.params.id, request.auth!.userId, amountPaise);
      return reply.send(result);
    },
  );

  // POST /api/v1/orders/:id/delivered — rider marks a non-COD (prepaid) order
  // delivered. COD orders use /cod-collected instead (records the cash).
  app.post('/:id/delivered',
    { preHandler: [requireRole('rider')] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const result = await ordersService.markDelivered(request.params.id, request.auth!.userId);
      return reply.send(result);
    },
  );

  // ── Customer post-delivery rating ─────────────────────────────────────────

  // POST /api/v1/orders/:id/rating
  app.post('/:id/rating',
    { preHandler: [requireRole('customer')] },
    async (request: FastifyRequest<{ Params: { id: string }; Body: RateOrderInput }>, reply) => {
      const parsed = rateOrderSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid rating');
      }
      const result = await ordersService.rateOrder(
        request.params.id,
        request.auth!.userId,
        parsed.data.rating,
        parsed.data.comment,
      );
      return reply.send(result);
    },
  );

  // ── Customer: change delivery address (before pickup) ─────────────────────

  // PATCH /api/v1/orders/:id/delivery-address  { addressId }
  app.patch('/:id/delivery-address',
    { preHandler: [requireRole('customer')] },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { addressId?: unknown } }>, reply) => {
      const { addressId } = request.body;
      if (typeof addressId !== 'string' || !addressId) {
        throw new ValidationError('addressId is required');
      }
      const result = await ordersService.updateDeliveryAddress(request.params.id, request.auth!.userId, addressId);
      return reply.send(result);
    },
  );

  // ── Customer: update receiver contact (before pickup) ─────────────────────

  // PATCH /api/v1/orders/:id/receiver  { name, phone }
  app.patch('/:id/receiver',
    { preHandler: [requireRole('customer')] },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { name?: unknown; phone?: unknown } }>, reply) => {
      const { name, phone } = request.body;
      if (typeof name !== 'string' || typeof phone !== 'string') {
        throw new ValidationError('name and phone are required');
      }
      const result = await ordersService.updateReceiver(request.params.id, request.auth!.userId, name, phone);
      return reply.send(result);
    },
  );
}
