import type { Queue } from 'bullmq';
import { QueueNames, JobNames } from './queues';

/**
 * Sets up all recurring job schedules.
 * Safe to call on every worker startup — BullMQ deduplicates by job key.
 */
export async function setupSchedules(queues: {
  settlement:     Queue;
  reconciliation: Queue;
  cleanup:        Queue;
}): Promise<void> {
  console.log('⏰ Setting up job schedules...');

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

  console.log('✅ All job schedules configured');
}
