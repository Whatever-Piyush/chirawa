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

  /**
   * A multi-shop cart is split into one order PER shop at checkout. This creates
   * a SINGLE Razorpay order for the grand total of all of them (so the customer
   * pays once for everything), with one Payment row per order sharing that
   * razorpayOrderId. Verification/webhook then settle every linked order.
   */
  async function createCartPaymentOrder(orderIds: string[], userId: string) {
    const orders = await prisma.order.findMany({ where: { id: { in: orderIds }, customerId: userId } });
    if (orders.length === 0) throw new NotFoundError('Order');
    const payable = orders.filter((o) => o.status === 'pending_payment');
    if (payable.length === 0) throw new BusinessRuleError('Order payment already processed');

    const grandTotal = payable.reduce((s, o) => s + o.totalAmount, 0);

    const razorpayOrderId = isRazorpayConfigured()
      ? (await createRazorpayOrder(grandTotal, payable[0]!.id)).id
      : `order_DEV_${Date.now()}`;

    // One Payment row per order, all sharing the single razorpayOrderId.
    await prisma.$transaction(
      payable.map((o) => prisma.payment.create({
        data: { orderId: o.id, razorpayOrderId, status: 'pending', amountPaise: o.totalAmount },
      })),
    );

    return {
      razorpayOrderId,
      razorpayKeyId: env.RAZORPAY_KEY_ID,
      amountPaise:   grandTotal,
      currency:      'INR',
      isDev:         !isRazorpayConfigured(),
    };
  }

  // Mark every order linked to a razorpayOrderId as paid (idempotent).
  async function settleOrdersForRazorpayOrder(razorpayOrderId: string, paymentId: string, method: string) {
    const payments = await prisma.payment.findMany({
      where: { razorpayOrderId }, select: { orderId: true },
    });
    const orderIds = [...new Set(payments.map((p) => p.orderId))];
    for (const id of orderIds) {
      const o = await prisma.order.findUnique({ where: { id }, select: { status: true } });
      if (o && !['paid', 'confirmed', 'delivered'].includes(o.status)) {
        await markOrderPaid(prisma, id, paymentId, method);
      }
    }
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
    if (isRazorpayConfigured() && !verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, signature)) {
      throw new PaymentError('Payment signature invalid');
    }
    // Settle EVERY order in this payment group, not just the one the client named —
    // a multi-shop cart pays once but produced several orders.
    await settleOrdersForRazorpayOrder(razorpayOrderId, razorpayPaymentId, 'upi');
    return { success: true, message: isRazorpayConfigured() ? 'Payment confirmed' : 'Payment confirmed (dev mode)' };
  }

  async function processWebhook(rawBody: string, signature: string) {
    const event = JSON.parse(rawBody) as {
      id: string; event: string;
      payload: { payment?: { entity: { id: string; order_id: string; method: string; amount: number; status: string; error_description?: string } } };
    };
    const eventId   = event.id;
    const eventType = event.event;

    // Idempotency: skip only events we've ALREADY processed-and-recorded (Phase 1.8).
    const seen = await prisma.paymentWebhookEvent.findUnique({ where: { eventId } });
    if (seen) return { processed: false, eventType };

    // Process FIRST, record AFTER success. The handlers below are idempotent
    // (markOrderPaid no-ops once paid; failed-update only touches pending rows),
    // so a re-delivery is safe. Crucially, a transient failure here throws WITHOUT
    // recording the event, so Razorpay's retry re-runs it — fixing the old
    // record-then-process flow that silently swallowed events on failure.
    if (eventType === 'payment.captured') {
      const entity  = event.payload.payment?.entity;
      if (entity) {
        // Settle every order linked to this Razorpay order (multi-shop carts).
        await settleOrdersForRazorpayOrder(entity.order_id, entity.id, entity.method);
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

    // Record only after successful processing. A concurrent delivery may have
    // recorded it between our check and here — the unique constraint makes that
    // create fail, which is benign (the work is already done + idempotent).
    await prisma.paymentWebhookEvent
      .create({ data: { eventId, eventType, payload: event as object } })
      .catch(() => undefined);

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

  return { createPaymentOrder, createCartPaymentOrder, verifyClientPayment, processWebhook, initiateRefund, reconcilePendingPayments };
}

// ── Auto-refund helper (Chunk 3.5) ──────────────────────────────────────────
// Refunds a prepaid order's captured payment via Razorpay and records it. Does
// NOT change order status — the caller (customer cancel / seller reject) owns
// the status transition. Returns the refunded paise, or null when there is
// nothing to refund (COD, unpaid, or no captured Razorpay payment).
export async function refundCapturedOrderPayment(
  prisma: PrismaClient,
  orderId: string,
  reason: string,
): Promise<number | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId }, include: { payments: true },
  });
  if (!order || order.paymentMethod === 'cod') return null;

  const captured = order.payments.find((p) => p.status === 'captured' && p.razorpayPaymentId);
  if (!captured?.razorpayPaymentId) return null;

  // Hit Razorpay only when configured; in dev-mock mode we still record the
  // refund so the order/accounting state is consistent.
  if (isRazorpayConfigured()) {
    await createRefund(captured.razorpayPaymentId, order.totalAmount, { reason, orderId });
  }

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: captured.id },
      data:  { status: 'refunded', refundedPaise: order.totalAmount },
    }),
    prisma.transaction.create({
      data: {
        type: 'refund', amountPaise: order.totalAmount,
        referenceId: orderId, referenceType: 'order',
        description: `Auto-refund on cancellation: ${reason}`,
      },
    }),
  ]);

  return order.totalAmount;
}

// ── Partial line refund (Catalog Engine Phase 5 safety net) ─────────────────
// Refunds a SPECIFIC amount (one order line) on a prepaid order without changing
// order status or fully refunding it — used when the rider finds one item out of
// stock but the rest of the order proceeds. The payment row's `refundedPaise` is
// incremented (status stays 'captured' since the order isn't fully refunded).
// Returns the refunded paise, or null when there's nothing to refund via Razorpay
// (COD / unpaid / no captured payment — those are reconciled as reduced cash due).
export async function refundOrderLine(
  prisma: PrismaClient,
  orderId: string,
  amountPaise: number,
  reason: string,
): Promise<number | null> {
  if (amountPaise <= 0) return null;
  const order = await prisma.order.findUnique({
    where: { id: orderId }, include: { payments: true },
  });
  if (!order || order.paymentMethod === 'cod') return null;

  const captured = order.payments.find((p) => p.status === 'captured' && p.razorpayPaymentId);
  if (!captured?.razorpayPaymentId) return null;

  if (isRazorpayConfigured()) {
    await createRefund(captured.razorpayPaymentId, amountPaise, { reason, orderId });
  }

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: captured.id },
      data:  { refundedPaise: { increment: amountPaise } },
    }),
    prisma.transaction.create({
      data: {
        type: 'refund', amountPaise,
        referenceId: orderId, referenceType: 'order',
        description: `Line refund: ${reason}`,
      },
    }),
  ]);

  return amountPaise;
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
