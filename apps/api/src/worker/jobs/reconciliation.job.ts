import type { PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { sendPush } from '../../modules/notifications/fcm.service';
import { SellerNotifications } from '../../modules/notifications/notification.templates';
import { JobNames, SELLER_ACCEPT_MS, autoAcceptJobId, type AutoAcceptPayload } from '../queues';

/**
 * Payment reconciliation — runs every 15 minutes.
 *
 * Finds orders stuck in `pending_payment` for >30 minutes,
 * polls Razorpay to check if payment actually succeeded,
 * and marks them paid if so.
 *
 * This is the safety net for: app crashes mid-payment,
 * network drops after Razorpay charges the customer,
 * webhook delivery failures.
 */
export async function runPaymentReconciliation(
  prisma: PrismaClient,
  redis: Redis,
  sellerAcceptQueue: Queue,
): Promise<void> {
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

  const staleOrders = await prisma.order.findMany({
    where: {
      status:    'pending_payment',
      createdAt: { lt: thirtyMinsAgo },
    },
    include: {
      payments: {
        where:  { razorpayOrderId: { not: null } },
        select: { id: true, razorpayOrderId: true },
      },
    },
    take: 20,
  });

  if (!staleOrders.length) return;

  console.log(`🔍 Reconciling ${staleOrders.length} stale orders...`);

  // Import here to avoid circular deps
  const { isRazorpayConfigured, fetchPaymentsByOrderId } =
    await import('../../modules/payments/razorpay.service');
  const { markOrderPaid } =
    await import('../../modules/payments/payments.service');

  let reconciled = 0;

  for (const order of staleOrders) {
    const payment = order.payments[0];
    if (!payment?.razorpayOrderId) continue;

    try {
      if (!isRazorpayConfigured()) {
        console.log(`[DEV] Skip reconciliation for order ${order.id} — Razorpay not configured`);
        continue;
      }

      const rzpPayments = await fetchPaymentsByOrderId(payment.razorpayOrderId);
      const captured    = rzpPayments.find((p) => p.status === 'captured');

      if (captured) {
        await markOrderPaid(prisma, order.id, captured.id, captured.method);
        await progressReconciledOrder(prisma, redis, sellerAcceptQueue, order.id);
        reconciled++;
        console.log(`✅ Reconciled order ${order.id}`);
      }
    } catch (err) {
      console.error(`Reconciliation error for order ${order.id}:`, err);
    }
  }

  if (reconciled > 0) {
    console.log(`💰 Reconciled ${reconciled} payments`);
  }
}

/**
 * After a reconciled payment, make sure the order can actually PROGRESS.
 *
 * Why we can't rely on the event bus here:
 * markOrderPaid emits NEW_ORDER_FOR_SELLER, which in the API process drives the
 * seller FCM (notifications.plugin) and the auto-accept timer (seller-timeout.plugin).
 * But this code runs in the WORKER process, which has NO event-bus listeners. The
 * only cross-process delivery is the Redis pub/sub bridge, and that is
 * fire-and-forget with no persistence or replay — a hiccup silently drops the
 * message. Reconciliation exists precisely for orders whose normal payment flow
 * ALREADY failed, so leaning on the same lossy path would let a paid order stall
 * forever. We therefore do both critical effects here, directly and durably:
 *   1. enqueue the seller auto-accept job (BullMQ → persisted in Redis, retried),
 *   2. push the seller an FCM new-order alert (no listener exists in this process).
 */
async function progressReconciledOrder(
  prisma: PrismaClient,
  redis: Redis,
  sellerAcceptQueue: Queue,
  orderId: string,
): Promise<void> {
  const order = await prisma.order.findUnique({
    where:  { id: orderId },
    select: { totalAmount: true, shop: { select: { seller: { select: { userId: true } } } } },
  });
  const sellerUserId = order?.shop.seller.userId;
  if (!order || !sellerUserId) return;

  // 1. Durable auto-accept scheduling. Deterministic jobId dedupes against the
  //    API-tier timer if the event bridge happened to deliver as well.
  await sellerAcceptQueue.add(
    JobNames.AUTO_ACCEPT,
    { orderId } satisfies AutoAcceptPayload,
    // removeOnComplete: true frees the deterministic jobId for re-arming;
    // failures are KEPT via DEFAULT_JOB_OPTIONS retention (P1-8).
    { delay: SELLER_ACCEPT_MS, jobId: autoAcceptJobId(orderId), removeOnComplete: true },
  ).catch((err) => console.error(`Failed to schedule auto-accept for ${orderId}:`, err));

  // 2. Direct seller FCM (mirrors notifications.plugin's NEW_ORDER_FOR_SELLER).
  const token = await redis.get(`fcm:token:${sellerUserId}`);
  if (!token) return;
  const notif = SellerNotifications.newOrder(order.totalAmount);
  await sendPush({ token, ...notif, data: { orderId, screen: 'OrderQueue' }, channel: 'chirawa_alerts' });
  await prisma.notification.create({
    data: { userId: sellerUserId, channel: 'fcm', eventType: 'new_order', title: notif.title, body: notif.body },
  }).catch(() => {}); // logging is non-blocking
}
