import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createUsersService } from './users.service';
import {
  updateProfileSchema, createAddressSchema, updateAddressSchema,
  type UpdateProfileInput, type CreateAddressInput, type UpdateAddressInput,
} from './users.schema';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { ValidationError } from '../../shared/errors/app-errors';

export default async function usersRoutes(app: FastifyInstance): Promise<void> {
  const usersService = createUsersService(app.prisma);

  // All users routes require auth
  app.addHook('preHandler', authenticate);

  // GET /api/v1/users/me
  app.get('/me', async (request, reply) => {
    const profile = await usersService.getMe(request.auth!.userId, request.auth!.role);
    return reply.send(profile);
  });

  // PUT /api/v1/users/me
  app.put(
    '/me',
    async (request: FastifyRequest<{ Body: UpdateProfileInput }>, reply: FastifyReply) => {
      const parsed = updateProfileSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');

      const result = await usersService.updateProfile(
        request.auth!.userId,
        request.auth!.role,
        parsed.data,
      );
      return reply.send(result);
    },
  );

  // GET /api/v1/users/me/loyalty
  app.get('/me/loyalty', async (request, reply) => {
    const loyalty = await usersService.getLoyalty(request.auth!.userId);
    return reply.send(loyalty);
  });

  // GET /api/v1/users/me/addresses
  app.get('/me/addresses', async (request, reply) => {
    const addresses = await usersService.getAddresses(request.auth!.userId);
    return reply.send(addresses);
  });

  // POST /api/v1/users/me/addresses
  app.post(
    '/me/addresses',
    async (request: FastifyRequest<{ Body: CreateAddressInput }>, reply: FastifyReply) => {
      const parsed = createAddressSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');

      const address = await usersService.createAddress(request.auth!.userId, parsed.data);
      return reply.status(201).send(address);
    },
  );

  // PUT /api/v1/users/me/addresses/:id
  app.put(
    '/me/addresses/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateAddressInput }>,
      reply: FastifyReply,
    ) => {
      const parsed = updateAddressSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');

      const address = await usersService.updateAddress(
        request.auth!.userId,
        request.params.id,
        parsed.data,
      );
      return reply.send(address);
    },
  );

  // DELETE /api/v1/users/me/addresses/:id
  app.delete(
    '/me/addresses/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await usersService.deleteAddress(request.auth!.userId, request.params.id);
      return reply.status(204).send();
    },
  );

  // PATCH /api/v1/users/me/addresses/:id/default
  app.patch(
    '/me/addresses/:id/default',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await usersService.setDefaultAddress(request.auth!.userId, request.params.id);
      return reply.send({ message: 'Default address set' });
    },
  );
}
