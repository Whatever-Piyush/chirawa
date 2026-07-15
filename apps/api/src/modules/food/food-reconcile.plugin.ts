import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { onlinePaymentsEnabled } from '../../config/features';
import { isRazorpayConfigured, fetchPaymentsByOrderId } from '../payments/razorpay.service';
import { loadFoodConfig } from './food-config';
import { transitionFoodOrderStatus } from './food-status';
import { beginFoodRefund } from './food-refunds';
import {
  notifyRestaurantNewOrder, notifyCustomerFoodCancelled, notifyCustomerFoodPaid,
  notifyCustomerLateRefund,
} from './food-notify';

// ─── Food reconcile sweep (launch hardening P0-1) ─────────────────────────────
// The safety net that makes the UPI-only food pipeline money-safe without any
// marketplace change. Every cycle, entirely food-scoped:
//
//   1. RESCUE  — pending_payment orders whose Razorpay payment actually
//                captured (client verify never arrived: app crash, network
//                drop) → flip to paid + notify restaurant & customer.
//   2. EXPIRE  — pending_payment past the expiry window with NOTHING captured
//                → cancel (abandoned checkout; nothing owed).
//   3. TIMEOUT — paid but unaccepted past the accept window → cancel + durable
//                refund + notify customer (a restaurant that never responds
//                can't strand a paid customer).
//   4. RETRY   — refunds stuck at failed/pending → beginFoodRefund converges
//                them (it checks Razorpay's refund list first, so retries can
//                never double-refund).
//
// Concurrency: a short Redis SET NX lock elects one sweeper per cycle across
// PM2 instances; every mutation is an atomic CAS regardless, so even a lock
// miss cannot double-apply. All actions are idempotent.

const LOCK_KEY = 'food:reconcile:lock';
const SYSTEM_ACTOR = { role: 'system', id: '00000000-0000-0000-0000-000000000000' };
const BATCH = 20;

export async function runFoodReconcileSweep(app: FastifyInstance): Promise<void> {
  const { prisma, redis } = app;
  const cfg = await loadFoodConfig(prisma);
  const now = Date.now();
  const minAgeCutoff  = new Date(now - cfg.ops.reconcileMinAgeSeconds * 1000);
  const expiryCutoff  = new Date(now - cfg.ops.pendingPaymentExpiryMinutes * 60_000);
  const acceptCutoff  = new Date(now - cfg.ops.acceptTimeoutMinutes * 60_000);

  // ── 1 + 2: pending_payment — rescue captured money, expire abandoned ───────
  const pending = await prisma.foodOrder.findMany({
    where: { status: 'pending_payment', createdAt: { lt: minAgeCutoff }, razorpayOrderId: { not: null } },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
    include: { restaurant: { select: { name: true, sellerUserId: true } }, items: { select: { quantity: true } } },
  });

  for (const order of pending) {
    try {
      const payments = await fetchPaymentsByOrderId(order.razorpayOrderId!);
      const captured = payments.find((p) => p.status === 'captured');

      if (captured) {
        // RESCUE: money is captured — the order MUST become paid.
        const flipped = await prisma.$transaction((tx) =>
          transitionFoodOrderStatus(tx, order.id, 'pending_payment', 'paid',
            SYSTEM_ACTOR, { razorpayPaymentId: captured.id }),
        );
        if (flipped) {
          app.log.warn({ foodOrderId: order.id }, '🛟 food reconcile: rescued captured payment → paid');
          void notifyRestaurantNewOrder(redis, order.restaurant.sellerUserId, {
            id: order.id, totalPaise: order.totalPaise,
            itemCount: order.items.reduce((s, i) => s + i.quantity, 0),
          });
          void notifyCustomerFoodPaid(redis, order.customerId, {
            id: order.id, restaurantName: order.restaurant.name,
          });
        }
      } else if (order.createdAt < expiryCutoff) {
        // EXPIRE: nothing captured and the window is over — close it out.
        const flipped = await prisma.$transaction((tx) =>
          transitionFoodOrderStatus(tx, order.id, 'pending_payment', 'cancelled',
            { ...SYSTEM_ACTOR, reason: 'payment_timeout' }),
        );
        if (flipped) app.log.info({ foodOrderId: order.id }, 'food reconcile: expired unpaid order');
      }
    } catch (err) {
      app.log.error({ err, foodOrderId: order.id }, 'food reconcile: pending_payment check failed');
    }
  }

  // ── 3: accept timeout — paid orders the restaurant never touched ───────────
  const unaccepted = await prisma.foodOrder.findMany({
    where: { status: 'paid', paidAt: { lt: acceptCutoff } },
    orderBy: { paidAt: 'asc' },
    take: BATCH,
  });

  for (const order of unaccepted) {
    try {
      const flipped = await prisma.$transaction((tx) =>
        transitionFoodOrderStatus(tx, order.id, 'paid', 'cancelled',
          { ...SYSTEM_ACTOR, reason: 'restaurant_no_response' }),
      );
      if (!flipped) continue; // restaurant accepted in the same instant — their win
      app.log.warn({ foodOrderId: order.id }, '⏱️ food reconcile: accept timeout → cancelled + refund');
      const refunded = (await beginFoodRefund(prisma, order)) === 'processed';
      void notifyCustomerFoodCancelled(redis, order.customerId, {
        id: order.id, refunded, reason: 'restaurant_no_response',
      });
    } catch (err) {
      app.log.error({ err, foodOrderId: order.id }, 'food reconcile: accept-timeout handling failed');
    }
  }

  // ── 4: refund retries — converge failed/stuck refunds ──────────────────────
  const stuckRefunds = await prisma.foodOrder.findMany({
    where: {
      OR: [
        { refundStatus: 'failed' },
        { refundStatus: 'pending', updatedAt: { lt: new Date(now - 10 * 60_000) } },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take: 10,
    select: { id: true, razorpayPaymentId: true, totalPaise: true },
  });

  for (const order of stuckRefunds) {
    const outcome = await beginFoodRefund(prisma, order);
    if (outcome === 'processed') {
      app.log.info({ foodOrderId: order.id }, '💸 food reconcile: refund retry succeeded');
    }
  }

  // ── 5: LATE CAPTURE on cancelled orders (RC1 P0) ────────────────────────────
  // UPI collects complete asynchronously: an order cancelled while its payment
  // was in flight (customer cancel / stage-2 expiry) can capture AFTER the
  // cancellation — razorpayPaymentId stays null and no other path would ever
  // refund it. Look back over recently-cancelled orders that never recorded a
  // payment and ask Razorpay; anything captured gets the durable refund.
  const LOOKBACK_MS = 48 * 60 * 60 * 1000;
  const cancelledUnchecked = await prisma.foodOrder.findMany({
    where: {
      status: 'cancelled',
      razorpayOrderId: { not: null },
      razorpayPaymentId: null,
      refundStatus: 'none',
      cancelledAt: { gte: new Date(now - LOOKBACK_MS), lt: minAgeCutoff },
    },
    orderBy: { cancelledAt: 'asc' },
    take: BATCH,
    select: { id: true, customerId: true, razorpayOrderId: true, totalPaise: true },
  });

  for (const order of cancelledUnchecked) {
    try {
      const payments = await fetchPaymentsByOrderId(order.razorpayOrderId!);
      const captured = payments.find((p) => p.status === 'captured');
      if (!captured) {
        // Nothing captured — mark checked so this row isn't re-queried forever.
        // 'skipped' is terminal for refund bookkeeping (money never moved).
        await prisma.foodOrder.update({ where: { id: order.id }, data: { refundStatus: 'skipped' } });
        continue;
      }
      // CAS claim (RC1 Batch 3): stamp the payment id only while refundStatus
      // is still 'none' — if two sweepers both miss the best-effort Redis lock,
      // exactly one wins this row; the loser skips (no duplicate refund attempt,
      // no duplicate customer notification).
      const claimed = await prisma.foodOrder.updateMany({
        where: { id: order.id, refundStatus: 'none', razorpayPaymentId: null },
        data:  { razorpayPaymentId: captured.id },
      });
      if (claimed.count === 0) continue;
      app.log.warn({ foodOrderId: order.id }, '🛟 food reconcile: LATE CAPTURE on cancelled order — refunding');
      const refunded = (await beginFoodRefund(prisma, {
        id: order.id, razorpayPaymentId: captured.id, totalPaise: order.totalPaise,
      })) === 'processed';
      void notifyCustomerLateRefund(redis, order.customerId, { id: order.id, refunded });
    } catch (err) {
      app.log.error({ err, foodOrderId: order.id }, 'food reconcile: late-capture check failed');
    }
  }
}

async function foodReconcilePlugin(app: FastifyInstance): Promise<void> {
  let running = false;

  const tick = async (): Promise<void> => {
    // Food is UPI-only: with online payments off there is nothing to reconcile
    // (ordering itself is refused), and without real keys Razorpay reads fail.
    if (!onlinePaymentsEnabled() || !isRazorpayConfigured()) return;
    if (running) return; // never overlap within one process
    running = true;
    try {
      const cfg = await loadFoodConfig(app.prisma);
      // One sweeper per cycle across PM2 instances (correctness never depends
      // on this — every write is a CAS — it just avoids duplicate Razorpay reads).
      const locked = await app.redis.set(
        LOCK_KEY, String(process.pid), 'EX', Math.max(cfg.ops.reconcileIntervalSeconds - 10, 30), 'NX',
      );
      if (locked !== 'OK') return;
      await runFoodReconcileSweep(app);
    } catch (err) {
      app.log.error({ err }, 'food reconcile sweep failed');
    } finally {
      running = false;
    }
  };

  const cfg = await loadFoodConfig(app.prisma).catch(() => null);
  const intervalMs = (cfg?.ops.reconcileIntervalSeconds ?? 120) * 1000;
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();

  // One pass shortly after boot so a restart can't extend an outage window.
  const bootTimer = setTimeout(() => void tick(), 15_000);
  bootTimer.unref?.();

  app.addHook('onClose', async () => {
    clearInterval(timer);
    clearTimeout(bootTimer);
  });

  app.log.info('🛟 Food reconcile sweep ready (payment rescue · expiry · accept timeout · refund retry)');
}

export default fp(foodReconcilePlugin, { name: 'food-reconcile', dependencies: ['prisma', 'redis'] });
