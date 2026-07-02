import type { Job, Queue } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { createBatchingService } from '../../modules/delivery/batching.service';
import { sendSms } from '../../modules/notifications/sms.service';
import { JobNames, type AssignBatchPayload } from '../queues';

// Retry cadence for the "no rider available" case (Task 5.3). Configurable so it
// can be shortened in tests. Default: every 60s, up to 10 attempts (~10 min),
// then escalate to the founder by SMS.
const RETRY_DELAY_MS = Number(process.env.ASSIGN_RETRY_MS ?? 60_000);
const MAX_ATTEMPTS   = Number(process.env.ASSIGN_MAX_ATTEMPTS ?? 10);

export async function processAssignBatch(
  job: Job<AssignBatchPayload>,
  prisma: PrismaClient,
  redis: Redis,
  queue: Queue,
): Promise<void> {
  const { batchId, attempt } = job.data;
  const batching = createBatchingService(prisma, redis);

  const result = await batching.assignBatch(batchId);

  if (result.assigned) {
    console.log(`🛵 [assign] batch ${batchId} -> rider ${result.riderId} (${result.orderCount} orders)`);
    return;
  }
  if (result.reason === 'already_handled' || result.reason === 'empty' || result.reason === 'not_found') {
    console.log(`🛵 [assign] batch ${batchId} skipped (${result.reason})`);
    return;
  }

  // No rider available yet → retry, then escalate.
  if (attempt < MAX_ATTEMPTS) {
    await queue.add(
      JobNames.ASSIGN_BATCH,
      { batchId, attempt: attempt + 1 } satisfies AssignBatchPayload,
      { delay: RETRY_DELAY_MS }, // retries/retention from DEFAULT_JOB_OPTIONS (P1-8)
    );
    console.log(`🛵 [assign] batch ${batchId} no rider (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying in ${RETRY_DELAY_MS}ms`);
    return;
  }

  await escalate(prisma, batchId);
}

async function escalate(prisma: PrismaClient, batchId: string): Promise<void> {
  const cfg = await prisma.appConfig.findUnique({ where: { key: 'support_phone' } });
  console.error(`🛵 [assign] batch ${batchId} UNASSIGNED after max attempts — escalating`);
  if (cfg?.value) {
    await sendSms(
      cfg.value,
      `Bringly: Ek batch (${batchId.slice(-6).toUpperCase()}) ko koi rider nahi mila. Admin app me manually assign karein.`,
    ).catch((err) => console.error('Escalation SMS failed:', err));
  }
}
