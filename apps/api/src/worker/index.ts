import 'dotenv/config';

import { Worker, Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { env } from '../config/env';
import { QueueNames, JobNames, DEFAULT_JOB_OPTIONS } from './queues';
import { setupSchedules } from './scheduler';
import { runDailySettlement, processSingleSellerSettle, runPayoutReconciliation } from './jobs/settlement.job';
import { runPaymentReconciliation } from './jobs/reconciliation.job';
import { runLocationCleanup, runOtpCleanup, runTokenCleanup, runCartCleanup } from './jobs/cleanup.job';
import { sweepExpiredReservations } from '../modules/inventory/reservations.service';
import { runInventoryReconciliation } from '../modules/inventory/reconcile.service';
import { getInventoryConfig } from '../modules/inventory/inventory.config';
import { runMorningCardPush } from './jobs/morning-card.job';
import { processAssignBatch } from './jobs/assignment.job';
import { runCatalogEnrichment } from './jobs/enrichment.job';
import { createOffDumpSource } from '../services/off-source';
import { closeEventBus } from '../shared/events/event-bus';
import { initSentry, captureError, flushSentry } from '../shared/observability/sentry';
import { logger } from './logger';
import { startWorkerHeartbeat } from './heartbeat';

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

const settlementQueue     = new Queue(QueueNames.SETTLEMENT, { connection: redisConnection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
const reconciliationQueue = new Queue(QueueNames.RECONCILIATION, { connection: redisConnection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
const cleanupQueue        = new Queue(QueueNames.CLEANUP, { connection: redisConnection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
const assignmentQueue     = new Queue(QueueNames.ORDER_ASSIGNMENT, { connection: redisConnection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
// Reconciliation (worker) enqueues seller auto-accept here; the API-tier worker
// in seller-timeout.plugin consumes it (0.4).
const sellerAcceptQueue   = new Queue(QueueNames.SELLER_ACCEPT, { connection: redisConnection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
const enrichmentQueue     = new Queue(QueueNames.ENRICHMENT, { connection: redisConnection, defaultJobOptions: DEFAULT_JOB_OPTIONS });

// OFF bulk-dump source for catalog image enrichment (Phase 2). No dump configured
// → the worker marks items needs_manual; never touches the live OFF API for bulk.
const offSource = createOffDumpSource(env.OFF_DUMP_PATH);

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
    if (job.name === JobNames.RESERVATION_SWEEP) {
      await sweepExpiredReservations(prisma as never, await getInventoryConfig(prisma));
    }
    if (job.name === JobNames.INVENTORY_RECONCILE) await runInventoryReconciliation(prisma);
    if (job.name === JobNames.MORNING_CARD_PUSH) await runMorningCardPush(prisma, redisForCleanup);
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


const assignmentWorker = new Worker(
  QueueNames.ORDER_ASSIGNMENT,
  async (job) => {
    if (job.name === JobNames.ASSIGN_BATCH) {
      await processAssignBatch(job, prisma, redisForCleanup, assignmentQueue);
    }
  },
  { connection: redisConnection, concurrency: 3 },
);

// Concurrency 1: enrichment is a paced, rate-limited batch sweep — one at a time.
const enrichmentWorker = new Worker(
  QueueNames.ENRICHMENT,
  async (job) => {
    if (job.name === JobNames.CATALOG_ENRICH) await runCatalogEnrichment(prisma, { source: offSource });
  },
  { connection: redisConnection, concurrency: 1 },
);

const workers = [settlementWorker, reconciliationWorker, cleanupWorker, assignmentWorker, enrichmentWorker];

workers.forEach((worker) => {
  worker.on('completed', (job) => logger.info({ jobName: job.name, jobId: job.id }, `✅ Job completed: ${job.name}`));
  // 'failed' fires per ATTEMPT (P1-8). Distinguish will-retry from final so
  // logs tell the truth and Sentry only pages when BullMQ has actually given
  // up — not 5 times for one flaky Redis blip.
  worker.on('failed',    (job, err) => {
    const attemptsMade  = job?.attemptsMade ?? 0;
    const attemptsTotal = job?.opts.attempts ?? 1;
    if (job && attemptsMade < attemptsTotal) {
      logger.warn({ jobName: job.name, jobId: job.id, attemptsMade, attemptsTotal, err: err.message },
        `⚠️ Job failed, retrying (${attemptsMade}/${attemptsTotal}): ${job.name}`);
      return;
    }
    logger.error({ jobName: job?.name, jobId: job?.id, attemptsMade, attemptsTotal, err },
      `❌ Job FAILED permanently (${attemptsMade}/${attemptsTotal} attempts): ${job?.name}`);
    captureError(err, { jobName: job?.name, jobId: job?.id, attemptsMade });
  });
  worker.on('error',     (err) => { logger.error({ err }, 'Worker error'); captureError(err); });
});

async function start(): Promise<void> {
  await prisma.$connect();

  logger.info({ workers: ['settlement', 'reconciliation', 'cleanup', 'assignment', 'enrichment'] }, '🔧 Chirawa Worker started');

  // Liveness dead-man's switch (P1-9): pings stop ⇒ the monitor pages.
  startWorkerHeartbeat(env.WORKER_HEARTBEAT_URL, logger);

  await setupSchedules({
    settlement:     settlementQueue,
    reconciliation: reconciliationQueue,
    cleanup:        cleanupQueue,
    enrichment:     enrichmentQueue,
  });
}

let isShuttingDown = false;

async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info('Worker shutting down...');
  try {
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all([
      settlementQueue, reconciliationQueue, cleanupQueue, assignmentQueue, sellerAcceptQueue, enrichmentQueue,
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
  logger.error({ err }, 'Worker startup failed');
  process.exit(1);
});
