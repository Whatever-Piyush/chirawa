import type { PrismaClient } from '@prisma/client';

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
export async function runPaymentReconciliation(prisma: PrismaClient): Promise<void> {
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
