// MUST be first — loads apps/api/.env into process.env before anything reads it
import 'dotenv/config';

import { buildApp } from './app';
import { env } from './config/env';

async function main(): Promise<void> {
  const app = await buildApp();

  try {
    const address = await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`🚀 Chirawa API → ${address}`);
    app.log.info(`❤️  Health   → ${address}/health`);
    app.log.info(`🌍 Env      → ${env.NODE_ENV}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.warn(`${signal} received — shutting down`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
