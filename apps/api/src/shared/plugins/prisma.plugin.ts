import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

async function prismaPlugin(app: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient({
    log: app.log.level === 'debug'
      ? ['query', 'info', 'warn', 'error']
      : ['warn', 'error'],
  });

  await prisma.$connect();
  app.log.info('PostgreSQL connected via Prisma');

  app.decorate('prisma', prisma);

  // Disconnect cleanly on server shutdown
  app.addHook('onClose', async () => {
    await prisma.$disconnect();
    app.log.info('PostgreSQL disconnected');
  });
}

// fp() makes the decoration available outside the plugin's Fastify scope
export default fp(prismaPlugin, { name: 'prisma' });
