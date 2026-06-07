import 'dotenv/config';

import { Worker, Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { env } from '../config/env';
import { QueueNames, JobNames } from './queues';
import { setupSchedules } from './scheduler';
import { runDailySettlement, processSingleSellerSettle, runPayoutReconciliation } from './jobs/settlement.job';
import { runPaymentReconciliation } from './jobs/reconciliation.job';
import { runLocationCleanup, runOtpCleanup, runTokenCleanup, runCartCleanup } from './jobs/cleanup.job';
import { processUnlockReferral } from './jobs/referral.job';
import { processAssignBatch } from './jobs/assignment.job';
import { closeEventBus } from '../shared/events/event-bus';
import { initSentry, captureError, flushSentry } from '../shared/observability/sentry';

initSentry('worker'); // no-op without SENTRY_DSN (4.1)

// BullMQ auto-connects — do NOT call .connect() manually
const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck:     false,
});

const redisForCleanup = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
});

const prisma = new PrismaClient();

const settlementQueue     = new Queue(QueueNames.SETTLEMENT,     { connection: redisConnection });
const reconciliationQueue = new Queue(QueueNames.RECONCILIATION, { connection: redisConnection });
const cleanupQueue        = new Queue(QueueNames.CLEANUP,        { connection: redisConnection });
const referralQueue       = new Queue(QueueNames.REFERRAL,       { connection: redisConnection });
const assignmentQueue     = new Queue(QueueNames.ORDER_ASSIGNMENT, { connection: redisConnection });
// Reconciliation (worker) enqueues seller auto-accept here; the API-tier worker
// in seller-timeout.plugin consumes it (0.4).
const sellerAcceptQueue   = new Queue(QueueNames.SELLER_ACCEPT,   { connection: redisConnection });

const settlementWorker = new Worker(
  QueueNames.SETTLEMENT,
  async (job) => {
    if (job.name === JobNames.DAILY_SETTLEMENT)     await runDailySettlement(prisma);
    if (job.name === JobNames.SINGLE_SELLER_SETTLE) await processSingleSellerSettle(job, prisma);
    if (job.name === JobNames.PAYOUT_RECONCILE)     await runPayoutReconciliation(prisma);
  },
  { connection: redisConnection, concurrency: 1 },
);

const reconciliationWorker = new Worker(
  QueueNames.RECONCILIATION,
  async (job) => {
    if (job.name === JobNames.PAYMENT_RECONCILE) await runPaymentReconciliation(prisma, redisForCleanup, sellerAcceptQueue);
  },
  { connection: redisConnection, concurrency: 1 },
);

const cleanupWorker = new Worker(
  QueueNames.CLEANUP,
  async (job) => {
    const { type } = job.data as { type: string };
    if (type === 'location') await runLocationCleanup(prisma);
    if (type === 'otp')      await runOtpCleanup(prisma);
    if (type === 'token')    await runTokenCleanup(prisma);
    if (type === 'cart')     await runCartCleanup(prisma, redisForCleanup);
  },
  { connection: redisConnection, concurrency: 2 },
);

const referralWorker = new Worker(
  QueueNames.REFERRAL,
  async (job) => {
    if (job.name === JobNames.UNLOCK_REFERRAL) await processUnlockReferral(job, prisma);
  },
  { connection: redisConnection, concurrency: 5 },
);

const assignmentWorker = new Worker(
  QueueNames.ORDER_ASSIGNMENT,
  async (job) => {
    if (job.name === JobNames.ASSIGN_BATCH) {
      await processAssignBatch(job, prisma, redisForCleanup, assignmentQueue);
    }
  },
  { connection: redisConnection, concurrency: 3 },
);

const workers = [settlementWorker, reconciliationWorker, cleanupWorker, referralWorker, assignmentWorker];

workers.forEach((worker) => {
  worker.on('completed', (job) => console.log(`✅ Job completed: ${job.name}`));
  worker.on('failed',    (job, err) => {
    console.error(`❌ Job failed: ${job?.name}:`, err.message);
    captureError(err, { jobName: job?.name, jobId: job?.id });
  });
  worker.on('error',     (err) => { console.error('Worker error:', err.message); captureError(err); });
});

async function start(): Promise<void> {
  await prisma.$connect();

  console.log('🔧 Chirawa Worker started');
  console.log('   Settlement worker  : ready');
  console.log('   Reconciliation     : ready');
  console.log('   Cleanup worker     : ready');
  console.log('   Referral worker    : ready');
  console.log('   Assignment worker  : ready');

  await setupSchedules({
    settlement:     settlementQueue,
    reconciliation: reconciliationQueue,
    cleanup:        cleanupQueue,
  });
}

let isShuttingDown = false;

async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('Worker shutting down...');
  try {
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all([
      settlementQueue, reconciliationQueue, cleanupQueue, referralQueue, assignmentQueue, sellerAcceptQueue,
    ].map((q) => q.close()));
    await closeEventBus();
    await flushSentry();
    await prisma.$disconnect();
  } catch {
    // Ignore cleanup errors
  }
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT',  () => void shutdown());

void start().catch((err) => {
  console.error('Worker startup failed:', err);
  process.exit(1);
});
