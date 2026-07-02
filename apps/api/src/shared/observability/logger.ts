import pino from 'pino';
import { env } from '../../config/env';

// One pino config for every non-request log line (Ops Phase: console sweep).
// Fastify owns request-scoped logging (app.ts, same shape); this covers code
// that runs outside a request — services shared by the API and worker, the
// event bus, background loops. JSON at info in production (PM2 captures to
// /var/log/chirawa/*.log), pretty at debug in dev. `svc`/`proc` bindings make
// lines greppable (`svc:"payments"`) instead of emoji-prefixed free text.
export const baseLogger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  ...(env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname,proc,svc', colorize: true },
    },
  }),
});

/** Child logger for a service/module — every line carries `svc` for grep. */
export function serviceLogger(svc: string): pino.Logger {
  return baseLogger.child({ svc });
}
