import { baseLogger } from '../shared/observability/logger';

// Structured logger for the worker process (P1-9). Child of the shared base
// (shared/observability/logger.ts) so both processes emit the same shape:
// JSON at info in production (PM2 captures to /var/log/chirawa/worker-*.log),
// pretty at debug in dev. The worker was console.log-only before — no levels,
// no structure, nothing greppable when a settlement failed at 3 AM.
export const logger = baseLogger.child({ proc: 'worker' });
