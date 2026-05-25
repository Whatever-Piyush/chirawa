import type { FastifyInstance } from 'fastify';

export default async function routes(app: FastifyInstance): Promise<void> {
  app.get('/', async (_req, reply) => {
    return reply.send({ status: 'stub — implementation coming in a future step' });
  });
}
