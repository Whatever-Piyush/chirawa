import pino from 'pino';
import { env } from '../config/env';

// Structured logger for the worker process (P1-9). Mirrors the API's Fastify
// pino config (app.ts) so both processes emit the same shape: JSON at info in
// production (PM2 captures to /var/log/chirawa/worker-*.log), pretty at debug
// in dev. The worker was console.log-only before — no levels, no structure,
// nothing greppable when a settlement failed at 3 AM.
export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  base: { proc: 'worker' },
  ...(env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname,proc', colorize: true },
    },
  }),
});
