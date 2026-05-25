import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createCartService } from './cart.service';
import {
  addToCartSchema, updateCartItemSchema,
  type AddToCartInput, type UpdateCartItemInput,
} from './cart.schema';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { ValidationError } from '../../shared/errors/app-errors';

export default async function cartRoutes(app: FastifyInstance): Promise<void> {
  const cartService = createCartService(app.prisma, app.redis);

  // All cart routes require auth
  app.addHook('preHandler', authenticate);

  // GET /api/v1/cart
  app.get('/', async (request, reply) => {
    const cart = await cartService.getCart(request.auth!.userId);
    return reply.send(cart);
  });

  // POST /api/v1/cart/items
  app.post(
    '/items',
    async (request: FastifyRequest<{ Body: AddToCartInput }>, reply) => {
      const parsed = addToCartSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const cart = await cartService.addItem(request.auth!.userId, parsed.data);
      return reply.status(200).send(cart);
    },
  );

  // PUT /api/v1/cart/items/:productId
  app.put(
    '/items/:productId',
    async (
      request: FastifyRequest<{
        Params: { productId: string };
        Body: UpdateCartItemInput;
      }>,
      reply,
    ) => {
      const parsed = updateCartItemSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const cart = await cartService.updateItem(
        request.auth!.userId,
        request.params.productId,
        parsed.data,
      );
      return reply.send(cart);
    },
  );

  // DELETE /api/v1/cart
  app.delete('/', async (request, reply) => {
    await cartService.clearCart(request.auth!.userId);
    return reply.status(204).send();
  });
}
