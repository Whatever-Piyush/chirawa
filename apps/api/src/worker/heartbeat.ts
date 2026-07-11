import type { Logger } from 'pino';

// Dead-man's-switch heartbeat for the worker process (P1-9), same semantics as
// the backup pipeline's healthcheck ping (scripts/backup-runtime.ts): GET the
// URL periodically; if the pings STOP, the monitor (healthchecks.io-style)
// alerts. This is deliberately liveness-only — job-level failures already page
// via Sentry (final-attempt captureError, P1-8); what nothing caught before
// was the whole worker process being down: no settlements, no reconciliation,
// no batch assignment, and the first symptom was sellers calling about money.
//
// Never throws, never blocks shutdown (timer is unref'ed). Empty URL = disabled
// (dev default; production warns at boot via collectProductionWarnings).

export const WORKER_HEARTBEAT_INTERVAL_MS = 60_000;

export function startWorkerHeartbeat(url: string, logger: Logger): () => void {
  if (!url) return () => {};

  const ping = async (): Promise<void> => {
    try {
      await fetch(url, { method: 'GET' });
    } catch (err) {
      // Non-fatal by design: a dead monitor must never hurt the worker.
      logger.warn({ err }, 'worker heartbeat ping failed (non-fatal)');
    }
  };

  void ping(); // first ping at boot — flips the monitor green immediately
  const timer = setInterval(() => void ping(), WORKER_HEARTBEAT_INTERVAL_MS);
  timer.unref();

  logger.info({ intervalMs: WORKER_HEARTBEAT_INTERVAL_MS }, '💓 worker heartbeat enabled');
  return () => clearInterval(timer);
}
