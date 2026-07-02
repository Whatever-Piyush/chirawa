import pino from 'pino';
import { env } from '../../config/env';

// One pino config for every non-request log line (Ops Phase: console sweep).
// Fastify owns request-scoped logging (app.ts, same shape); this covers code
// that runs outside a request — services shared by the API and worker, the
// event bus, background loops. JSON at info in production (PM2 captures to
// /var/log/chirawa/*.log), pretty at debug in dev. `svc`/`proc` bindings make
// lines greppable (`svc:"payments"`) instead of emoji-prefixed free text.
// LOG_LEVEL / LOG_PRETTY=false mirror app.ts's Fastify logger overrides (Perf
// phase) so BOTH loggers switch to production-shaped JSON together — the smoke
// suite asserts every stdout line parses as JSON (caught here: only app.ts had
// the overrides at first, and service logs stayed pretty).
export const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
  ...(env.NODE_ENV !== 'production' && process.env.LOG_PRETTY !== 'false' && {
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
