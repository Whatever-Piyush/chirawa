import type { Queue } from 'bullmq';
import { QueueNames, JobNames } from './queues';
import { logger } from './logger';

/**
 * Sets up all recurring job schedules.
 * Safe to call on every worker startup — BullMQ deduplicates by job key.
 */
export async function setupSchedules(queues: {
  settlement:     Queue;
  reconciliation: Queue;
  cleanup:        Queue;
  enrichment:     Queue;
}): Promise<void> {
  logger.info('⏰ Setting up job schedules...');

  // ── Daily settlement — 11:00 AM IST (05:30 UTC) ────────────────────────────
  await queues.settlement.add(
    JobNames.DAILY_SETTLEMENT,
    {},
    {
      repeat:     { pattern: '30 5 * * *' }, // 11 AM IST = 05:30 UTC
      jobId:      'daily-settlement-recurring',
      removeOnComplete: { count: 30 },
      removeOnFail:     { count: 10 },
    },
  );

  // ── Payout reconcile — every 30 minutes (finalize in-flight payouts, 0.3) ──
  await queues.settlement.add(
    JobNames.PAYOUT_RECONCILE,
    {},
    {
      repeat:     { every: 30 * 60 * 1000 },
      jobId:      'payout-reconcile-recurring',
      removeOnComplete: { count: 10 },
      removeOnFail:     { count: 5 },
    },
  );

  // ── Payment reconciliation — every 15 minutes ─────────────────────────────
  await queues.reconciliation.add(
    JobNames.PAYMENT_RECONCILE,
    {},
    {
      repeat:     { every: 15 * 60 * 1000 }, // 15 minutes in ms
      jobId:      'payment-reconcile-recurring',
      removeOnComplete: { count: 10 },
      removeOnFail:     { count: 5 },
    },
  );

  // ── Reservation expiry sweep — every 60s (Inventory Engine) ───────────────
  // Releases prepaid holds whose payment never landed within the TTL. Idempotent
  // (held-claim guard), so overlap/rerun is harmless.
  await queues.reconciliation.add(
    JobNames.RESERVATION_SWEEP,
    {},
    {
      repeat:     { every: 60 * 1000 },
      jobId:      'reservation-sweep-recurring',
      removeOnComplete: { count: 5 },
      removeOnFail:     { count: 5 },
    },
  );

  // ── Inventory reconciler — 2:30 AM IST (21:00 UTC) (Inventory Engine) ─────
  // Asserts the stock invariants nightly and auto-fixes the safe ones — the
  // same discipline as payment reconciliation, applied to inventory.
  await queues.reconciliation.add(
    JobNames.INVENTORY_RECONCILE,
    {},
    {
      repeat:     { pattern: '0 21 * * *' },
      jobId:      'inventory-reconcile-recurring',
      removeOnComplete: { count: 7 },
      removeOnFail:     { count: 5 },
    },
  );

  // ── Morning verification card — 9:00 AM IST (03:30 UTC) (Inventory Engine) ─
  // Pushes each seller their ≤N most-doubted tracked items at shop-open time.
  await queues.reconciliation.add(
    JobNames.MORNING_CARD_PUSH,
    {},
    {
      repeat:     { pattern: '30 3 * * *' },
      jobId:      'morning-card-push-recurring',
      removeOnComplete: { count: 7 },
      removeOnFail:     { count: 5 },
    },
  );

  // ── Location cleanup — 2 AM IST (20:30 UTC previous day) ─────────────────
  await queues.cleanup.add(
    JobNames.LOCATION_CLEANUP,
    { type: 'location' },
    {
      repeat:     { pattern: '30 20 * * *' },
      jobId:      'location-cleanup-recurring',
      removeOnComplete: { count: 7 },
    },
  );

  // ── OTP cleanup — every 6 hours ───────────────────────────────────────────
  await queues.cleanup.add(
    JobNames.OTP_CLEANUP,
    { type: 'otp' },
    {
      repeat:     { every: 6 * 60 * 60 * 1000 },
      jobId:      'otp-cleanup-recurring',
      removeOnComplete: { count: 5 },
    },
  );

  // ── Token cleanup — daily at 3 AM ─────────────────────────────────────────
  await queues.cleanup.add(
    JobNames.TOKEN_CLEANUP,
    { type: 'token' },
    {
      repeat:     { pattern: '30 21 * * *' }, // 3 AM IST
      jobId:      'token-cleanup-recurring',
      removeOnComplete: { count: 7 },
    },
  );

  // ── Cart cleanup — hourly ─────────────────────────────────────────────────
  await queues.cleanup.add(
    JobNames.CART_CLEANUP,
    { type: 'cart' },
    {
      repeat:     { every: 60 * 60 * 1000 },
      jobId:      'cart-cleanup-recurring',
      removeOnComplete: { count: 5 },
    },
  );

  // ── Catalog image enrichment — nightly 1 AM IST (19:30 UTC), off-peak ──────
  // Sweeps un-imaged MasterCatalog rows against the OFF dump (Phase 2). Async,
  // rate-limited, idempotent — safe to repeat.
  await queues.enrichment.add(
    JobNames.CATALOG_ENRICH,
    {},
    {
      repeat:     { pattern: '30 19 * * *' },
      jobId:      'catalog-enrich-recurring',
      removeOnComplete: { count: 7 },
      removeOnFail:     { count: 5 },
    },
  );

  logger.info('✅ All job schedules configured');
}
