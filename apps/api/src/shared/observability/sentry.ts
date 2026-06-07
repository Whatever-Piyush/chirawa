import * as Sentry from '@sentry/node';
import { env } from '../../config/env';

let enabled = false;

/**
 * Initialise Sentry for a process (4.1). No-op when SENTRY_DSN is empty, so dev
 * and unconfigured environments are unaffected. Call once, as early as possible.
 */
export function initSentry(component: 'api' | 'worker'): void {
  if (!env.SENTRY_DSN || enabled) return;
  Sentry.init({
    dsn:         env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release:     env.SENTRY_RELEASE || undefined,
    tracesSampleRate: 0, // errors only for now; turn up for perf tracing later
    initialScope: { tags: { component } },
  });
  enabled = true;
}

/** Report an error with optional context (orderId/userId/...). No-op if disabled. */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

/** Flush buffered events before the process exits. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  await Sentry.flush(timeoutMs).catch(() => undefined);
}
