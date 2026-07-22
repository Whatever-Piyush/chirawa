import type Redis from 'ioredis';
import { sendPush } from '../notifications/fcm.service';
import { serviceLogger } from '../../shared/observability/logger';

const log = serviceLogger('food-notify');

// ─── Food push notifications (launch hardening P0-3) ──────────────────────────
// Best-effort pushes over the EXISTING notifications infra: device tokens live
// in Redis under fcm:token:<userId> (registered by all three apps) and go out
// through the shared fcm.service. A push failure must never fail an order flow.

const fcmTokenKey = (userId: string) => `fcm:token:${userId}`;

async function pushToUser(
  redis: Redis,
  userId: string | null | undefined,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<void> {
  if (!userId) return;
  try {
    const token = await redis.get(fcmTokenKey(userId));
    if (!token) return; // device never registered — polling remains the fallback
    await sendPush({ token, title, body, data });
  } catch (err) {
    log.warn({ err, userId }, 'food push failed (best-effort)');
  }
}

/** New PAID order → wake the restaurant's device (Restaurant Mode tab). */
export async function notifyRestaurantNewOrder(
  redis: Redis,
  sellerUserId: string | null,
  order: { id: string; totalPaise: number; itemCount: number },
): Promise<void> {
  await pushToUser(redis, sellerUserId,
    '🍽️ Naya food order!',
    `${order.itemCount} item — ₹${Math.round(order.totalPaise / 100)}. Abhi accept karein.`,
    { foodOrderId: order.id, screen: 'RestaurantOrders' });
}

/** Order cancelled (reject / timeout) → tell the customer, mention the refund. */
export async function notifyCustomerFoodCancelled(
  redis: Redis,
  customerId: string,
  order: { id: string; refunded: boolean; reason: 'restaurant_rejected' | 'restaurant_no_response' },
): Promise<void> {
  const why = order.reason === 'restaurant_no_response'
    ? 'Restaurant respond nahi kar paya'
    : 'Restaurant ne order accept nahi kiya';
  await pushToUser(redis, customerId,
    'Food order cancel ho gaya',
    order.refunded ? `${why} — poora refund 5-7 din mein aa jayega.` : `${why}.`,
    { foodOrderId: order.id, screen: 'FoodOrderTracking' });
}

/** Order milestone pushes (RC1 P2 — marketplace parity). Deliberately only the
 *  three moments a customer cares about; the tracking screen's poll covers the
 *  rest without notification fatigue. */
const MILESTONE_COPY: Record<string, { title: string; body: string }> = {
  confirmed:        { title: 'Restaurant ne order accept kiya ✓', body: 'Aapka khana jald banna shuru hoga.' },
  out_for_delivery: { title: 'Khana raaste mein hai 🛵',          body: 'Rider aapke address ke liye nikal chuka hai.' },
  delivered:        { title: 'Order deliver ho gaya 🎉',          body: 'Mazedaar khane ka lutf uthayein!' },
};

export async function notifyCustomerFoodMilestone(
  redis: Redis,
  customerId: string,
  foodOrderId: string,
  status: string,
): Promise<void> {
  const copy = MILESTONE_COPY[status];
  if (!copy) return;
  await pushToUser(redis, customerId, copy.title, copy.body,
    { foodOrderId, screen: 'FoodOrderTracking' });
}

/** Money captured AFTER the order was already cancelled → refund on its way. */
export async function notifyCustomerLateRefund(
  redis: Redis,
  customerId: string,
  order: { id: string; refunded: boolean },
): Promise<void> {
  await pushToUser(redis, customerId,
    'Aapka payment mila — refund ho raha hai',
    order.refunded
      ? 'Order pehle hi cancel ho chuka tha, isliye poora paisa 5-7 din mein wapas aa jayega.'
      : 'Order pehle hi cancel ho chuka tha — refund process ho raha hai.',
    { foodOrderId: order.id, screen: 'FoodOrderTracking' });
}

/** Payment rescued by the reconciler (verify call never arrived). */
export async function notifyCustomerFoodPaid(
  redis: Redis,
  customerId: string,
  order: { id: string; restaurantName: string },
): Promise<void> {
  await pushToUser(redis, customerId,
    'Payment mil gaya ✓',
    `${order.restaurantName} ko aapka order bhej diya gaya hai.`,
    { foodOrderId: order.id, screen: 'FoodOrderTracking' });
}
