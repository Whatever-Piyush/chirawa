import type { PrismaClient } from '@prisma/client';
import {
  createRazorpayOrder, verifyPaymentSignature,
  createRefund, fetchPaymentsByOrderId,
  isRazorpayConfigured,
} from './razorpay.service';
import { env } from '../../config/env';
import {
  NotFoundError, ForbiddenError,
  ValidationError, BusinessRuleError, PaymentError,
} from '../../shared/errors/app-errors';

export function createPaymentsService(prisma: PrismaClient) {

  // ── Create Razorpay payment order ──────────────────────────────────────────
  // Called after placeOrder() for non-COD payments
  async function createPaymentOrder(orderId: string, userId: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order');
    if (order.customerId !== userId) throw new ForbiddenError('Not your order');
    if (order.status !== 'pending_payment') {
      throw new BusinessRuleError('Order payment already processed');
    }

    // Dev mode — return mock if Razorpay not configured
    if (!isRazorpayConfigured()) {
      console.warn('⚠️  Razorpay not configured — returning mock payment order');
      const mockId = `order_DEV_${Date.now()}`;
      await prisma.payment.create({
        data: {
          orderId,
          razorpayOrderId: mockId,
          status:          'pending',
          amountPaise:     order.totalAmount,
        },
      });
      return {
        razorpayOrderId: mockId,
        razorpayKeyId:   env.RAZORPAY_KEY_ID,
        amountPaise:     order.totalAmount,
        currency:        'INR',
        isDev:           true,
      };
    }

    const razorpayOrder = await createRazorpayOrder(order.totalAmount, orderId);

    await prisma.payment.create({
      data: {
        orderId,
        razorpayOrderId: razorpayOrder.id,
        status:          'pending',
        amountPaise:     order.totalAmount,
      },
    });

    return {
      razorpayOrderId: razorpayOrder.id,
      razorpayKeyId:   env.RAZORPAY_KEY_ID,
      amountPaise:     order.totalAmount,
      currency:        'INR',
      isDev:           false,
    };
  }

  // ── Verify payment from client callback ───────────────────────────────────
  // Client sends this after Razorpay checkout completes on their device
  // This is the "fast path" for UI feedback — webhook is the source of truth
  async function verifyClientPayment(
    orderId:           string,
    userId:            string,
    razorpayOrderId:   string,
    razorpayPaymentId: string,
    signature:         string,
  ) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order');
    if (order.customerId !== userId) throw new ForbiddenError('Not your order');

    // Already paid — idempotent, just return success
    if (['paid', 'confirmed', 'delivered'].includes(order.status)) {
      return { success: true, message: 'Payment already confirmed' };
    }

    // Dev mode — skip signature check
    if (!isRazorpayConfigured()) {
      await markOrderPaid(prisma, orderId, razorpayPaymentId, 'upi');
      return { success: true, message: 'Payment confirmed (dev mode)' };
    }

    // Verify HMAC signature
    const isValid = verifyPaymentSignature(
      razorpayOrderId, razorpayPaymentId, signature,
    );

    if (!isValid) {
      throw new PaymentError('Payment signature invalid. Do not trust this payment.');
    }

    await markOrderPaid(prisma, orderId, razorpayPaymentId, 'upi');
    return { success: true, message: 'Payment confirmed' };
  }

  // ── Process Razorpay webhook ───────────────────────────────────────────────
  // This is the AUTHORITATIVE payment confirmation path
  // The webhook fires even if the customer's app crashes mid-payment
  async function processWebhook(
    rawBody:   string,
    signature: string,
  ): Promise<{ processed: boolean; eventType: string }> {
    // Parse event
    const event = JSON.parse(rawBody) as {
      id:      string;
      event:   string;
      payload: {
        payment?: {
          entity: {
            id:                string;
            order_id:          string;
            method:            string;
            amount:            number;
            status:            string;
            error_description?: string;
          };
        };
      };
    };

    const eventId   = event.id;
    const eventType = event.event;

    // Idempotency guard — if this event was already processed, return immediately
    try {
      await prisma.paymentWebhookEvent.create({
        data: {
          eventId,
          eventType,
          payload: event as object,
        },
      });
    } catch {
      // Unique constraint violation = duplicate event
      return { processed: false, eventType };
    }

    // Handle payment captured
    if (eventType === 'payment.captured') {
      const paymentEntity = event.payload.payment?.entity;
      if (paymentEntity) {
        // Find our order by razorpay order ID
        const payment = await prisma.payment.findFirst({
          where: { razorpayOrderId: paymentEntity.order_id },
        });

        if (payment) {
          await markOrderPaid(
            prisma,
            payment.orderId,
            paymentEntity.id,
            paymentEntity.method,
          );
        }
      }
    }

    // Handle payment failed
    if (eventType === 'payment.failed') {
      const paymentEntity = event.payload.payment?.entity;
      if (paymentEntity) {
        await prisma.payment.updateMany({
          where: { razorpayOrderId: paymentEntity.order_id },
          data: {
            status:        'failed',
            failureReason: paymentEntity.error_description ?? 'Payment failed',
          },
        });
      }
    }

    return { processed: true, eventType };
  }

  // ── Initiate refund (admin action) ─────────────────────────────────────────
  async function initiateRefund(
    orderId:  string,
    adminId:  string,
    reason:   string,
  ) {
    const order = await prisma.order.findUnique({
      where:   { id: orderId },
      include: { payments: true },
    });

    if (!order) throw new NotFoundError('Order');

    const captured = order.payments.find(
      (p) => p.status === 'captured' && p.razorpayPaymentId,
    );

    if (!captured?.razorpayPaymentId) {
      throw new BusinessRuleError('No captured payment found to refund');
    }

    if (!isRazorpayConfigured()) {
      // Dev mode mock refund
      console.warn('⚠️  Mock refund issued (Razorpay not configured)');
    } else {
      await createRefund(captured.razorpayPaymentId, order.totalAmount, {
        reason,
        orderId,
        adminId,
      });
    }

    // Update DB
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: captured.id },
        data:  { status: 'refunded', refundedPaise: order.totalAmount },
      }),
      prisma.order.update({
        where: { id: orderId },
        data:  { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId,
          status:        'cancelled',
          changedByRole: 'admin',
          changedById:   adminId,
          reason:        `Refund: ${reason}`,
        },
      }),
      prisma.transaction.create({
        data: {
          type:          'refund',
          amountPaise:   order.totalAmount,
          referenceId:   orderId,
          referenceType: 'order',
          description:   `Refund issued for order ${orderId}: ${reason}`,
        },
      }),
    ]);

    return { message: 'Refund initiated. 1-3 days mein wapas aa jayega.' };
  }

  // ── Reconciliation — check pending payments older than 30 min ─────────────
  // Called by BullMQ every 15 minutes (Step 10)
  async function reconcilePendingPayments(): Promise<number> {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

    const staleOrders = await prisma.order.findMany({
      where: {
        status:    'pending_payment',
        createdAt: { lt: thirtyMinsAgo },
      },
      include: { payments: { where: { razorpayOrderId: { not: null } } } },
      take: 20,
    });

    let reconciled = 0;

    for (const order of staleOrders) {
      const payment = order.payments[0];
      if (!payment?.razorpayOrderId || !isRazorpayConfigured()) continue;

      try {
        const rzpPayments = await fetchPaymentsByOrderId(payment.razorpayOrderId);
        const captured    = rzpPayments.find((p) => p.status === 'captured');

        if (captured) {
          await markOrderPaid(prisma, order.id, captured.id, captured.method);
          reconciled++;
        }
      } catch (err) {
        console.error(`Reconciliation failed for order ${order.id}:`, err);
      }
    }

    return reconciled;
  }

  return {
    createPaymentOrder, verifyClientPayment,
    processWebhook, initiateRefund, reconcilePendingPayments,
  };
}

// ─── Shared helper — mark order as paid ──────────────────────────────────────
// Called from BOTH client callback and webhook — must be idempotent
export async function markOrderPaid(
  prisma:            PrismaClient,
  orderId:           string,
  razorpayPaymentId: string,
  method:            string,
): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return;

  // Already paid — no-op (idempotency)
  if (['paid', 'confirmed', 'delivered', 'cancelled'].includes(order.status)) {
    return;
  }

  await prisma.$transaction([
    prisma.order.update({
      where: { id: orderId },
      data:  { status: 'paid' },
    }),
    prisma.orderStatusHistory.create({
      data: {
        orderId,
        status:        'paid',
        changedByRole: 'customer',
        changedById:   order.customerId,
        reason:        `Payment captured: ${razorpayPaymentId}`,
      },
    }),
    prisma.payment.updateMany({
      where: { orderId, status: 'pending' },
      data:  {
        razorpayPaymentId,
        status:     'captured',
        capturedAt: new Date(),
        method:     method as 'upi' | 'card' | 'wallet' | 'cod',
      },
    }),
    prisma.transaction.create({
      data: {
        type:          'customer_payment',
        amountPaise:   order.totalAmount,
        referenceId:   orderId,
        referenceType: 'order',
        description:   `Online payment received for order`,
      },
    }),
  ]);

  console.log(`✅ Order ${orderId} marked as paid — ${razorpayPaymentId}`);
}
