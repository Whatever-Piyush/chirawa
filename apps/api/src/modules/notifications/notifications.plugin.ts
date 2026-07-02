import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { sendPush } from './fcm.service';
import { sendSms, SmsTemplates } from './sms.service';
import { CustomerNotifications, SellerNotifications, RiderNotifications } from './notification.templates';
import {
  eventBus, Events,
  type OrderStatusChangedPayload,
  type NewOrderForSellerPayload,
  type OrderAssignedToRiderPayload,
} from '../../shared/events/event-bus';

// Redis key for FCM device tokens
const fcmTokenKey = (userId: string) => `fcm:token:${userId}`;

async function notificationsPlugin(app: FastifyInstance): Promise<void> {

  // ── Helper: get FCM token for a user ──────────────────────────────────────
  async function getToken(userId: string): Promise<string | null> {
    if (!userId) return null;
    return app.redis.get(fcmTokenKey(userId));
  }

  // ── Helper: get user phone for SMS ────────────────────────────────────────
  async function getPhone(userId: string): Promise<string | null> {
    if (!userId) return null;
    const user = await app.prisma.user.findUnique({
      where:  { id: userId },
      select: { phone: true },
    });
    return user?.phone ?? null;
  }

  // ── Log notification to DB ────────────────────────────────────────────────
  async function logNotification(
    userId: string,
    channel: 'fcm' | 'sms' | 'in_app',
    eventType: string,
    title?: string,
    body?: string,
  ): Promise<void> {
    await app.prisma.notification.create({
      // Coalesce to null — Prisma's optional columns are `string | null`, and
      // exactOptionalPropertyTypes rejects passing an explicit `undefined`.
      data: { userId, channel, eventType, title: title ?? null, body: body ?? null },
    }).catch(() => {}); // Non-blocking
  }

  // ── ORDER STATUS CHANGED ──────────────────────────────────────────────────
  eventBus.on(Events.ORDER_STATUS_CHANGED, async (payload: OrderStatusChangedPayload) => {
    const { orderId, status, customerId, sellerId, riderId } = payload;

    try {
      switch (status) {

        // ── Confirmed → notify customer ──────────────────────────────────────
        case 'confirmed': {
          const shop = await app.prisma.shop.findUnique({
            where: { id: payload.shopId }, select: { name: true },
          });
          const notif   = CustomerNotifications.orderConfirmed(shop?.name ?? 'Dukaan');
          const token   = await getToken(customerId);
          if (token) {
            await sendPush({ token, ...notif, data: { orderId, screen: 'OrderTracking' } });
            await logNotification(customerId, 'fcm', 'order_confirmed', notif.title, notif.body);
          }
          break;
        }

        // ── Out for delivery → notify customer ───────────────────────────────
        case 'out_for_delivery': {
          // Use the server-computed ETA (ETA MVP Phase 1) instead of a hardcoded
          // string; fall back to a soft "jaldi" when it's not available.
          const ord = await app.prisma.order.findUnique({
            where: { id: orderId }, select: { estimatedDeliveryAt: true },
          });
          const mins = ord?.estimatedDeliveryAt
            ? Math.max(1, Math.round((ord.estimatedDeliveryAt.getTime() - Date.now()) / 60000))
            : null;
          const notif = CustomerNotifications.outForDelivery(mins ? `${mins} minute` : 'jaldi');
          const token = await getToken(customerId);
          if (token) {
            await sendPush({ token, ...notif, data: { orderId, screen: 'OrderTracking' } });
            await logNotification(customerId, 'fcm', 'out_for_delivery', notif.title, notif.body);
          }
          break;
        }

        // ── Picked up → notify customer ──────────────────────────────────────
        case 'picked_up': {
          const notif = CustomerNotifications.orderPickedUp();
          const token = await getToken(customerId);
          if (token) {
            await sendPush({ token, ...notif, data: { orderId, screen: 'OrderTracking' } });
            await logNotification(customerId, 'fcm', 'order_picked_up', notif.title, notif.body);
          }
          break;
        }

        // ── Delivered → FCM + SMS to customer ───────────────────────────────
        case 'delivered': {
          const order = await app.prisma.order.findUnique({
            where: { id: orderId }, select: { totalAmount: true },
          });
          const notif = CustomerNotifications.orderDelivered();
          const [token, phone] = await Promise.all([getToken(customerId), getPhone(customerId)]);

          if (token) {
            await sendPush({ token, ...notif, data: { orderId, screen: 'OrderHistory' } });
            await logNotification(customerId, 'fcm', 'order_delivered', notif.title, notif.body);
          }
          if (phone) {
            await sendSms(phone, SmsTemplates.orderDelivered(order?.totalAmount ?? 0));
            await logNotification(customerId, 'sms', 'order_delivered');
          }

          // Also notify seller via FCM (earnings update)
          if (sellerId) {
            const sellerToken = await getToken(sellerId);
            if (sellerToken) {
              await sendPush({
                token: sellerToken,
                title: '✅ Order Deliver Ho Gaya!',
                body:  `Order #${orderId.slice(-6).toUpperCase()} deliver ho gaya. Settlement kal milega.`,
                data:  { orderId, screen: 'Settlement' },
              });
            }
          }
          break;
        }

        // ── Cancelled → FCM + SMS to customer + seller + rider ───────────────
        case 'cancelled': {
          // Prepaid orders that were auto-refunded get a refund-specific message
          // with the exact amount; everything else gets the generic cancel notice.
          const notif = payload.refundedPaise && payload.refundedPaise > 0
            ? CustomerNotifications.paymentRefunded(payload.refundedPaise)
            : CustomerNotifications.orderCancelled();
          const [token, phone] = await Promise.all([getToken(customerId), getPhone(customerId)]);

          if (token) {
            await sendPush({ token, ...notif, data: { orderId, screen: 'OrderHistory' } });
            await logNotification(customerId, 'fcm', 'order_cancelled', notif.title, notif.body);
          }
          if (phone) {
            await sendSms(phone, SmsTemplates.orderCancelled());
          }

          // Notify seller
          if (sellerId) {
            const sellerToken = await getToken(sellerId);
            if (sellerToken) {
              const sellerNotif = SellerNotifications.orderCancelled(orderId);
              await sendPush({ token: sellerToken, ...sellerNotif, data: { orderId } });
            }
          }

          // Notify rider if assigned
          if (riderId) {
            const riderToken = await getToken(riderId);
            if (riderToken) {
              const riderNotif = RiderNotifications.orderCancelled();
              await sendPush({ token: riderToken, ...riderNotif, data: { orderId } });
            }
          }
          break;
        }

        // ── Paid → notify seller to prepare ─────────────────────────────────
        case 'paid': {
          if (sellerId) {
            const order = await app.prisma.order.findUnique({
              where: { id: orderId }, select: { totalAmount: true },
            });
            const sellerToken = await getToken(sellerId);
            if (sellerToken) {
              const notif = SellerNotifications.newOrder(order?.totalAmount ?? 0);
              await sendPush({
                token:   sellerToken,
                ...notif,
                data:    { orderId, screen: 'OrderQueue' },
                channel: 'chirawa_alerts', // High-priority channel
              });
              await logNotification(sellerId, 'fcm', 'new_order', notif.title, notif.body);
            }
          }
          break;
        }
      }
    } catch (err) {
      // Notifications must NEVER crash the order flow
      app.log.error({ err, orderId, status }, 'Notification failed (non-fatal)');
    }
  });

  // ── NEW ORDER FOR SELLER ──────────────────────────────────────────────────
  eventBus.on(Events.NEW_ORDER_FOR_SELLER, async (payload: NewOrderForSellerPayload) => {
    try {
      const token = await getToken(payload.sellerId);
      if (!token) return;

      const notif = SellerNotifications.newOrder(payload.totalAmount);
      await sendPush({
        token,
        ...notif,
        data:    { orderId: payload.orderId, screen: 'OrderQueue' },
        channel: 'chirawa_alerts', // Uses alarm sound on Android
      });

      await logNotification(payload.sellerId, 'fcm', 'new_order', notif.title, notif.body);
    } catch (err) {
      app.log.error({ err }, 'Seller notification failed');
    }
  });

  // ── ORDER ASSIGNED TO RIDER ───────────────────────────────────────────────
  eventBus.on(Events.ORDER_ASSIGNED_TO_RIDER, async (payload: OrderAssignedToRiderPayload) => {
    try {
      const token = await getToken(payload.riderId);
      if (!token) return;

      const notif = RiderNotifications.newAssignment(
        payload.shopName,
        payload.totalAmount,
        payload.paymentMethod,
      );

      await sendPush({
        token,
        ...notif,
        data:    { orderId: payload.orderId, screen: 'IncomingOrder' },
        channel: 'chirawa_alerts',
      });

      await logNotification(payload.riderId, 'fcm', 'order_assigned', notif.title, notif.body);
    } catch (err) {
      app.log.error({ err }, 'Rider notification failed');
    }
  });

  app.log.info('🔔 Notification service ready');
}

export default fp(notificationsPlugin, {
  name:         'notifications',
  dependencies: ['prisma', 'redis'],
});
