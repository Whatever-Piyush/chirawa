import type { Job, Queue } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { createDispatchService } from '../../modules/delivery/dispatch.service';
import { sendSms } from '../../modules/notifications/sms.service';
import { JobNames, type AssignOrderPayload } from '../queues';

// Retry cadence for the "no rider available" case (Task 5.3). Configurable so it
// can be shortened in tests. Default: every 60s, up to 10 attempts (~10 min),
// then escalate to the founder by SMS.
const RETRY_DELAY_MS = Number(process.env.ASSIGN_RETRY_MS ?? 60_000);
const MAX_ATTEMPTS   = Number(process.env.ASSIGN_MAX_ATTEMPTS ?? 10);

export async function processAssignOrder(
  job: Job<AssignOrderPayload>,
  prisma: PrismaClient,
  redis: Redis,
  queue: Queue,
): Promise<void> {
  const { orderId, attempt } = job.data;
  const dispatch = createDispatchService(prisma, redis);

  const result = await dispatch.assignOrder(orderId);

  if (result.assigned || result.reason === 'already_assigned') {
    console.log(`🛵 [assign] order ${orderId} resolved (${result.assigned ? 'assigned' : 'already assigned'})`);
    return;
  }

  // No rider available yet.
  if (attempt < MAX_ATTEMPTS) {
    await queue.add(
      JobNames.ASSIGN_ORDER,
      { orderId, attempt: attempt + 1 } satisfies AssignOrderPayload,
      { delay: RETRY_DELAY_MS, removeOnComplete: true, removeOnFail: true },
    );
    console.log(`🛵 [assign] order ${orderId} no rider (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying in ${RETRY_DELAY_MS}ms`);
    return;
  }

  // Exhausted retries → escalate to the founder. The admin dispatch view already
  // surfaces the order as unassigned; here we proactively SMS so it isn't missed.
  await escalate(prisma, orderId);
}

async function escalate(prisma: PrismaClient, orderId: string): Promise<void> {
  const cfg = await prisma.appConfig.findUnique({ where: { key: 'support_phone' } });
  const short = orderId.slice(-6).toUpperCase();
  console.error(`🛵 [assign] order ${orderId} UNASSIGNED after max attempts — escalating`);
  if (cfg?.value) {
    await sendSms(
      cfg.value,
      `Bringly: Order #${short} ko koi rider nahi mila. Admin app me manually assign karein.`,
    ).catch((err) => console.error('Escalation SMS failed:', err));
  }
}
