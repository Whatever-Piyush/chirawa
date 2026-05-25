import 'dotenv/config';
import { buildApp } from './app';
import { env } from './config/env';

async function main(): Promise<void> {
  const app = await buildApp();

  try {
    const address = await app.listen({
      port: env.PORT,
      host: env.HOST,
    });

    app.log.info(`🚀 Chirawa API → ${address}`);
    app.log.info(`❤️  Health   → ${address}/health`);
    app.log.info(`🌍 Env      → ${env.NODE_ENV}`);
    app.log.info(`📦 Modules  → auth, users, catalog, cart, pricing, orders, payments, delivery, admin, loyalty`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown — lets in-flight requests finish
  // PM2 sends SIGINT on `pm2 reload` (zero-downtime)
  const shutdown = async (signal: string): Promise<void> => {
    app.log.warn(`${signal} received — shutting down gracefully`);
    await app.close();
    app.log.info('Server closed. Bye!');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));
}

void main();
