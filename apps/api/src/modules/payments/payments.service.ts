import type { PrismaClient } from '@prisma/client';
import {
  createRazorpayOrder, verifyPaymentSignature,
  createRefund, fetchPaymentsByOrderId, isRazorpayConfigured,
} from './razorpay.service';
import { env } from '../../config/env';
import {
  NotFoundError, ForbiddenError,
  ValidationError, BusinessRuleError, PaymentError,
} from '../../shared/errors/app-errors';
import { emitOrderStatusChanged, emitNewOrderForSeller } from '../../shared/events/event-bus';

export function createPaymentsService(prisma: PrismaClient) {

  async function createPaymentOrder(orderId: string, userId: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order');
    if (order.customerId !== userId) throw new ForbiddenError('Not your order');
    if (order.status !== 'pending_payment') throw new BusinessRuleError('Order payment already processed');

    if (!isRazorpayConfigured()) {
      const mockId = `order_DEV_${Date.now()}`;
      await prisma.payment.create({
        data: { orderId, razorpayOrderId: mockId, status: 'pending', amountPaise: order.totalAmount },
      });
      return { razorpayOrderId: mockId, razorpayKeyId: env.RAZORPAY_KEY_ID, amountPaise: order.totalAmount, currency: 'INR', isDev: true };
    }

    const rzpOrder = await createRazorpayOrder(order.totalAmount, orderId);
    await prisma.payment.create({
      data: { orderId, razorpayOrderId: rzpOrder.id, status: 'pending', amountPaise: order.totalAmount },
    });
    return { razorpayOrderId: rzpOrder.id, razorpayKeyId: env.RAZORPAY_KEY_ID, amountPaise: order.totalAmount, currency: 'INR', isDev: false };
  }

  async function verifyClientPayment(
    orderId: string, userId: string,
    razorpayOrderId: string, razorpayPaymentId: string, signature: string,
  ) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order');
    if (order.customerId !== userId) throw new ForbiddenError('Not your order');
    if (['paid', 'confirmed', 'delivered'].includes(order.status)) {
      return { success: true, message: 'Payment already confirmed' };
    }
    if (!isRazorpayConfigured()) {
      await markOrderPaid(prisma, orderId, razorpayPaymentId, 'upi');
      return { success: true, message: 'Payment confirmed (dev mode)' };
    }
    if (!verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, signature)) {
      throw new PaymentError('Payment signature invalid');
    }
    await markOrderPaid(prisma, orderId, razorpayPaymentId, 'upi');
    return { success: true, message: 'Payment confirmed' };
  }

  async function processWebhook(rawBody: string, signature: string) {
    const event = JSON.parse(rawBody) as {
      id: string; event: string;
      payload: { payment?: { entity: { id: string; order_id: string; method: string; amount: number; status: string; error_description?: string } } };
    };
    const eventId   = event.id;
    const eventType = event.event;

    try {
      await prisma.paymentWebhookEvent.create({
        data: { eventId, eventType, payload: event as object },
      });
    } catch {
      return { processed: false, eventType }; // Duplicate
    }

    if (eventType === 'payment.captured') {
      const entity  = event.payload.payment?.entity;
      if (entity) {
        const payment = await prisma.payment.findFirst({ where: { razorpayOrderId: entity.order_id } });
        if (payment) await markOrderPaid(prisma, payment.orderId, entity.id, entity.method);
      }
    }

    if (eventType === 'payment.failed') {
      const entity = event.payload.payment?.entity;
      if (entity) {
        await prisma.payment.updateMany({
          where: { razorpayOrderId: entity.order_id },
          data:  { status: 'failed', failureReason: entity.error_description ?? 'Payment failed' },
        });
      }
    }

    return { processed: true, eventType };
  }

  async function initiateRefund(orderId: string, adminId: string, reason: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId }, include: { payments: true },
    });
    if (!order) throw new NotFoundError('Order');

    const captured = order.payments.find((p) => p.status === 'captured' && p.razorpayPaymentId);
    if (!captured?.razorpayPaymentId) throw new BusinessRuleError('No captured payment found');

    if (isRazorpayConfigured()) {
      await createRefund(captured.razorpayPaymentId, order.totalAmount, { reason, orderId, adminId });
    }

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
        data: { orderId, status: 'cancelled', changedByRole: 'admin', changedById: adminId, reason: `Refund: ${reason}` },
      }),
      prisma.transaction.create({
        data: { type: 'refund', amountPaise: order.totalAmount, referenceId: orderId, referenceType: 'order', description: `Refund for order ${orderId}: ${reason}` },
      }),
    ]);

    emitOrderStatusChanged({
      orderId, status: 'cancelled',
      shopId: order.shopId, sellerId: '', riderId: order.riderId, customerId: order.customerId,
    });

    return { message: 'Refund initiated. 1-3 days mein wapas aa jayega.' };
  }

  async function reconcilePendingPayments(): Promise<number> {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
    const staleOrders   = await prisma.order.findMany({
      where:   { status: 'pending_payment', createdAt: { lt: thirtyMinsAgo } },
      include: { payments: { where: { razorpayOrderId: { not: null } } } },
      take:    20,
    });

    let reconciled = 0;
    for (const order of staleOrders) {
      const payment = order.payments[0];
      if (!payment?.razorpayOrderId || !isRazorpayConfigured()) continue;
      try {
        const rzpPayments = await fetchPaymentsByOrderId(payment.razorpayOrderId);
        const captured    = rzpPayments.find((p) => p.status === 'captured');
        if (captured) { await markOrderPaid(prisma, order.id, captured.id, captured.method); reconciled++; }
      } catch (err) {
        console.error(`Reconciliation failed for order ${order.id}:`, err);
      }
    }
    return reconciled;
  }

  return { createPaymentOrder, verifyClientPayment, processWebhook, initiateRefund, reconcilePendingPayments };
}

export async function markOrderPaid(
  prisma: PrismaClient,
  orderId: string,
  razorpayPaymentId: string,
  method: string,
): Promise<void> {
  const order = await prisma.order.findUnique({
    where:   { id: orderId },
    include: { shop: { include: { seller: true } } },
  });
  if (!order) return;
  if (['paid', 'confirmed', 'delivered', 'cancelled'].includes(order.status)) return;

  await prisma.$transaction([
    prisma.order.update({ where: { id: orderId }, data: { status: 'paid' } }),
    prisma.orderStatusHistory.create({
      data: { orderId, status: 'paid', changedByRole: 'customer', changedById: order.customerId, reason: `Payment: ${razorpayPaymentId}` },
    }),
    prisma.payment.updateMany({
      where: { orderId, status: 'pending' },
      data:  { razorpayPaymentId, status: 'captured', capturedAt: new Date(), method: method as never },
    }),
    prisma.transaction.create({
      data: { type: 'customer_payment', amountPaise: order.totalAmount, referenceId: orderId, referenceType: 'order', description: 'Online payment received' },
    }),
  ]);

  // Notify customer
  emitOrderStatusChanged({
    orderId, status: 'paid',
    shopId: order.shopId, sellerId: order.shop.seller.userId,
    riderId: null, customerId: order.customerId,
  });

  // Trigger seller new order alert after payment confirmed
  const items = await prisma.orderItem.findMany({ where: { orderId } });
  emitNewOrderForSeller({
    orderId, shopId: order.shopId,
    sellerId:         order.shop.seller.userId,
    items:            items.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice })),
    totalAmount:      order.totalAmount,
    paymentMethod:    order.paymentMethod,
    deliveryLocality: order.deliveryLocality,
  });

  console.log(`✅ Order ${orderId} marked as paid`);
}
