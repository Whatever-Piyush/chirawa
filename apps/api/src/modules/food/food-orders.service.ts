import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import {
  NotFoundError, ForbiddenError, BusinessRuleError, PaymentError,
} from '../../shared/errors/app-errors';
import { onlinePaymentsEnabled } from '../../config/features';
import { env } from '../../config/env';
import {
  createRazorpayOrder, verifyPaymentSignature,
} from '../payments/razorpay.service';
import { computeIsOpen } from '../catalog/catalog.service';
import { loadFoodConfig } from './food-config';
import { applyMarkup, computeFoodBill } from './food-pricing';
import { transitionFoodOrderStatus } from './food-status';
import { createFoodCartService } from './food-cart.service';
import { beginFoodRefund } from './food-refunds';
import {
  notifyRestaurantNewOrder, notifyCustomerFoodCancelled, notifyCustomerFoodMilestone,
} from './food-notify';
import { redactFoodOrderForViewer } from './food-redact';
import type { PlaceFoodOrderInput, VerifyFoodPaymentInput } from './food.schema';

// ─── Food orders service (Food.md §6, §7) ─────────────────────────────────────
// Own pipeline against food_orders — the marketplace orders.service is never
// called or modified. Shared infra reused through stable interfaces only:
// Razorpay create/verify/refund, the pure IST open-hours helper, and the
// platform feature flag that gates online payments (Food is UPI-only, so food
// ordering REQUIRES that flag — the flag itself is untouched).

// Statuses a restaurant may see/manage. pending_payment is deliberately
// excluded everywhere restaurant-facing: an unpaid order isn't real yet.
const RESTAURANT_VISIBLE = [
  'paid', 'confirmed', 'preparing', 'ready_for_pickup',
  'picked_up', 'out_for_delivery', 'delivered', 'cancelled',
] as const;

// IST = UTC+5:30 (no DST). Start of "today" in IST, expressed in UTC — used for
// the Restaurant Mode "Today's Orders" scope.
export function istDayStartUtc(now: Date = new Date()): Date {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const dayStartIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(dayStartIst - IST_OFFSET_MS);
}

interface AuthLike { userId: string; role: string; profileId: string }

export function createFoodOrdersService(prisma: PrismaClient, redis: Redis) {
  const cartService = createFoodCartService(prisma);

  // ── Place a food order (customer) — UPI-only, one restaurant ───────────────
  async function placeOrder(userId: string, input: PlaceFoodOrderInput) {
    // Food is UPI-only (Food.md §5): with platform online payments off there is
    // no payable path at all, so refuse up-front with an honest message.
    if (!onlinePaymentsEnabled()) {
      throw new BusinessRuleError('Food orders UPI se hote hain — online payment abhi enabled nahi hai');
    }

    const cart = await cartService.getCart(userId);
    if (!cart.restaurantId || cart.items.length === 0) {
      throw new BusinessRuleError('Food cart khaali hai');
    }
    const unavailable = cart.items.filter((i) => !i.isAvailable);
    if (unavailable.length > 0) {
      throw new BusinessRuleError(`${unavailable[0]!.name} abhi available nahi hai — cart se hata kar order karein`);
    }

    const restaurant = await prisma.restaurant.findUnique({ where: { id: cart.restaurantId } });
    if (!restaurant || !restaurant.isActive) throw new NotFoundError('Restaurant');
    if (!computeIsOpen(restaurant)) {
      throw new BusinessRuleError(
        `${restaurant.name} abhi band hai — ${restaurant.openTime} se ${restaurant.closeTime} tak khula rehta hai`,
      );
    }

    const address = await prisma.address.findUnique({ where: { id: input.addressId } });
    if (!address || address.isDeleted) throw new NotFoundError('Address');
    if (address.userId !== userId) throw new ForbiddenError('Not your address');

    const cfg  = await loadFoodConfig(prisma);
    const bill = computeFoodBill(
      cart.items.map((i) => ({ unitPricePaise: i.unitPricePaise, quantity: i.quantity })),
      cfg,
    );

    // Razorpay order FIRST with a pre-generated id as receipt: if the DB tx
    // fails afterwards, the orphan Razorpay order is harmless (unpaid, expires);
    // the reverse ordering would consume the cart with nothing to pay.
    const foodOrderId = crypto.randomUUID();
    const rzp = await createRazorpayOrder(bill.totalPaise, `food_${foodOrderId}`);

    await prisma.$transaction(async (tx) => {
      await tx.foodOrder.create({
        data: {
          id: foodOrderId,
          customerId: userId,
          restaurantId: restaurant.id,
          deliveryStreet: address.street, deliveryLandmark: address.landmark,
          deliveryLocality: address.locality, deliveryCity: address.city,
          deliveryPincode: address.pincode, deliveryLat: address.lat, deliveryLng: address.lng,
          ...(input.receiverName ? { receiverName: input.receiverName } : {}),
          ...(input.receiverPhone ? { receiverPhone: input.receiverPhone } : {}),
          itemsSubtotalPaise: bill.itemsSubtotalPaise,
          deliveryFeePaise:   bill.deliveryFeePaise,
          totalPaise:         bill.totalPaise,
          status: 'pending_payment', paymentMethod: 'upi',
          razorpayOrderId: rzp.id,
        },
      });
      await tx.foodOrderItem.createMany({
        data: cart.items.map((i) => ({
          foodOrderId,
          menuItemId: i.menuItemId,
          name: i.name,
          unitPrice: i.unitPricePaise,
          quantity: i.quantity,
          subtotal: i.subtotalPaise,
        })),
      });
      await tx.foodOrderStatusHistory.create({
        data: { foodOrderId, status: 'pending_payment', changedByRole: 'customer', changedById: userId },
      });
      // Consume the cart in the same tx (mirrors marketplace placeOrder).
      await tx.foodCart.deleteMany({ where: { userId } });
    });

    return {
      foodOrderId,
      status:          'pending_payment' as const,
      razorpayOrderId: rzp.id,
      razorpayKeyId:   env.RAZORPAY_KEY_ID,
      amountPaise:     bill.totalPaise,
      restaurantName:  restaurant.name,
      etaMinMinutes:   cfg.eta.minMinutes,
      etaMaxMinutes:   cfg.eta.maxMinutes,
      message:         'Payment complete karein',
    };
  }

  // ── Verify UPI payment (customer) → pending_payment → paid ─────────────────
  async function verifyPayment(userId: string, foodOrderId: string, input: VerifyFoodPaymentInput) {
    const order = await prisma.foodOrder.findUnique({ where: { id: foodOrderId } });
    if (!order) throw new NotFoundError('Food order');
    if (order.customerId !== userId) throw new ForbiddenError('Not your order');
    if (order.razorpayOrderId !== input.razorpayOrderId) {
      throw new PaymentError('Payment order mismatch');
    }
    // Idempotent: a re-verify of an already-paid order succeeds silently.
    if (order.status !== 'pending_payment') {
      if (order.status === 'paid' || order.paidAt) return { foodOrderId, status: order.status };

      // LATE CAPTURE ON A CANCELLED ORDER (RC1 P0): UPI collects complete
      // asynchronously — the order may have been cancelled (customer cancel /
      // expiry sweep) while the payment was still in flight. A valid signature
      // here means the money IS captured, so refund it immediately instead of
      // stranding it. (The reconcile sweep is the catch-all for the same case
      // when this verify call never arrives.)
      if (order.status === 'cancelled') {
        const validLate = verifyPaymentSignature(input.razorpayOrderId, input.razorpayPaymentId, input.razorpaySignature);
        if (!validLate) throw new PaymentError('Payment signature invalid');
        await prisma.foodOrder.update({
          where: { id: foodOrderId },
          data:  { razorpayPaymentId: input.razorpayPaymentId },
        });
        const outcome = await beginFoodRefund(prisma, { ...order, razorpayPaymentId: input.razorpayPaymentId });
        return {
          foodOrderId,
          status: 'cancelled' as const,
          refunded: outcome === 'processed',
          message: 'Order cancel ho chuka tha — aapka paisa refund kiya ja raha hai (5-7 din)',
        };
      }

      throw new BusinessRuleError(`Order is ${order.status} — payment verify nahi ho sakta`);
    }

    const valid = verifyPaymentSignature(input.razorpayOrderId, input.razorpayPaymentId, input.razorpaySignature);
    if (!valid) throw new PaymentError('Payment signature invalid');

    const flipped = await prisma.$transaction((tx) =>
      transitionFoodOrderStatus(tx, foodOrderId, 'pending_payment', 'paid',
        { role: 'customer', id: userId },
        { razorpayPaymentId: input.razorpayPaymentId }),
    );

    // Wake the restaurant's device (P0-3) — best-effort, never blocks the reply.
    // Gated on the CAS result (RC1 Batch 3): a concurrent double-verify (or a
    // verify racing the reconciler's rescue) loses the compare-and-set and must
    // NOT send a second "new order" push — exactly one flip, exactly one push.
    if (flipped) {
      void (async () => {
        const paid = await prisma.foodOrder.findUnique({
          where:   { id: foodOrderId },
          include: { restaurant: { select: { sellerUserId: true } }, items: { select: { quantity: true } } },
        });
        if (paid) {
          await notifyRestaurantNewOrder(redis, paid.restaurant.sellerUserId, {
            id: paid.id, totalPaise: paid.totalPaise,
            itemCount: paid.items.reduce((s, i) => s + i.quantity, 0),
          });
        }
      })();
    }

    return { foodOrderId, status: 'paid' as const, message: 'Payment ho gaya! Restaurant ko order bhej diya' };
  }

  // ── Customer order list / detail ────────────────────────────────────────────
  async function getMyOrders(userId: string, opts?: { page?: number | undefined; limit?: number | undefined }) {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 50);
    const page  = Math.max(opts?.page ?? 1, 1);
    return prisma.foodOrder.findMany({
      where:   { customerId: userId },
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
      include: {
        restaurant: { select: { id: true, name: true, cuisine: true, logoUrl: true } },
        items:      true,
      },
    });
  }

  async function getOrder(foodOrderId: string, auth: AuthLike) {
    const order = await prisma.foodOrder.findUnique({
      where:   { id: foodOrderId },
      include: {
        restaurant:    { select: { id: true, name: true, cuisine: true, address: true, lat: true, lng: true, sellerUserId: true, prepTimeMinutes: true } },
        items:         true,
        statusHistory: { orderBy: { changedAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundError('Food order');

    const allowed =
      auth.role === 'admin' ||
      (auth.role === 'customer' && order.customerId === auth.userId) ||
      (auth.role === 'seller'   && order.restaurant.sellerUserId === auth.userId) ||
      (auth.role === 'rider'    && order.riderId === auth.profileId);
    if (!allowed) throw new ForbiddenError('Not your order');

    const cfg = await loadFoodConfig(prisma);
    // PII window (RC1 P1): shape the payload by viewer role — sellers never see
    // customer contact/address; riders never see payment identifiers.
    return redactFoodOrderForViewer(
      { ...order, eta: { minMinutes: cfg.eta.minMinutes, maxMinutes: cfg.eta.maxMinutes } },
      auth.role,
    );
  }

  // ── Customer cancel — only before the restaurant starts cooking ────────────
  async function cancelByCustomer(userId: string, foodOrderId: string, reason?: string) {
    const order = await prisma.foodOrder.findUnique({ where: { id: foodOrderId } });
    if (!order) throw new NotFoundError('Food order');
    if (order.customerId !== userId) throw new ForbiddenError('Not your order');
    if (!['pending_payment', 'paid'].includes(order.status)) {
      throw new BusinessRuleError('Restaurant ne order accept kar liya hai — ab cancel nahi ho sakta');
    }

    const flipped = await prisma.$transaction((tx) =>
      transitionFoodOrderStatus(tx, foodOrderId, order.status, 'cancelled',
        { role: 'customer', id: userId, reason: reason ?? 'customer_cancelled' }),
    );
    if (!flipped) throw new BusinessRuleError('Order ka status badal gaya — refresh karein');

    // Durable refund (P0-4): tracked in refund_status; the reconcile sweep
    // retries failures, so the customer's money can never be silently lost.
    let refunded = false;
    if (order.status === 'paid') refunded = (await beginFoodRefund(prisma, order)) === 'processed';
    return {
      foodOrderId, status: 'cancelled' as const,
      message: refunded
        ? 'Order cancel — refund 5-7 din mein aa jayega'
        : 'Order cancel ho gaya',
    };
  }

  // ── Restaurant Mode (Food.md §11.2) ─────────────────────────────────────────
  async function getMyRestaurant(sellerUserId: string) {
    return prisma.restaurant.findFirst({
      where:  { sellerUserId, isActive: true },
      select: {
        id: true, name: true, cuisine: true, isOpen: true,
        openTime: true, closeTime: true, prepTimeMinutes: true,
      },
    });
  }

  async function requireMyRestaurant(sellerUserId: string) {
    const restaurant = await getMyRestaurant(sellerUserId);
    if (!restaurant) throw new ForbiddenError('No restaurant linked to this account');
    return restaurant;
  }

  async function listRestaurantOrders(
    sellerUserId: string,
    opts: { scope: 'today' | 'history'; page?: number | undefined; limit?: number | undefined },
  ) {
    const restaurant = await requireMyRestaurant(sellerUserId);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 50);
    const page  = Math.max(opts.page ?? 1, 1);

    const where = {
      restaurantId: restaurant.id,
      status: { in: [...RESTAURANT_VISIBLE] },
      ...(opts.scope === 'today' ? { createdAt: { gte: istDayStartUtc() } } : {}),
    };
    // Explicit select (RC1 P1 — PII window): the restaurant runs the kitchen;
    // it never needs the customer's phone, street, coordinates, customerId, or
    // payment identifiers. Locality + receiver name are enough for context.
    const orders = await prisma.foodOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
      select: {
        id: true, status: true,
        itemsSubtotalPaise: true, deliveryFeePaise: true, totalPaise: true,
        deliveryLocality: true, receiverName: true,
        cancelReason: true, createdAt: true,
        items: true,
      },
    });
    return { restaurant, orders };
  }

  // One shared guard for every restaurant order action.
  async function restaurantOrderAction(
    sellerUserId: string, foodOrderId: string,
    from: string | string[], to: string, reason?: string,
  ) {
    const restaurant = await requireMyRestaurant(sellerUserId);
    const order = await prisma.foodOrder.findUnique({ where: { id: foodOrderId } });
    if (!order || order.restaurantId !== restaurant.id) throw new NotFoundError('Food order');

    const fromStates = Array.isArray(from) ? from : [from];
    if (!fromStates.includes(order.status)) {
      throw new BusinessRuleError(`Order is ${order.status} — yeh action ab nahi ho sakta`);
    }

    const flipped = await prisma.$transaction((tx) =>
      transitionFoodOrderStatus(tx, foodOrderId, order.status, to,
        { role: 'seller', id: sellerUserId, ...(reason ? { reason } : {}) }),
    );
    if (!flipped) throw new BusinessRuleError('Order ka status badal gaya — refresh karein');
    return order;
  }

  async function acceptOrder(sellerUserId: string, foodOrderId: string) {
    const order = await restaurantOrderAction(sellerUserId, foodOrderId, 'paid', 'confirmed');
    void notifyCustomerFoodMilestone(redis, order.customerId, foodOrderId, 'confirmed');
    return { foodOrderId, status: 'confirmed' as const };
  }

  async function rejectOrder(sellerUserId: string, foodOrderId: string, reason?: string) {
    const order = await restaurantOrderAction(
      sellerUserId, foodOrderId, ['paid', 'confirmed'], 'cancelled', reason ?? 'restaurant_rejected',
    );
    // Durable auto-refund (Food.md §6 + P0-4) — retried by the sweep on failure.
    const refunded = (await beginFoodRefund(prisma, order)) === 'processed';
    void notifyCustomerFoodCancelled(redis, order.customerId, {
      id: order.id, refunded, reason: 'restaurant_rejected',
    });
    return {
      foodOrderId, status: 'cancelled' as const,
      refunded,
      message: refunded ? 'Order reject — customer ko refund ho jayega' : 'Order reject ho gaya',
    };
  }

  async function markPreparing(sellerUserId: string, foodOrderId: string) {
    await restaurantOrderAction(sellerUserId, foodOrderId, 'confirmed', 'preparing');
    return { foodOrderId, status: 'preparing' as const };
  }

  async function markReady(sellerUserId: string, foodOrderId: string) {
    await restaurantOrderAction(sellerUserId, foodOrderId, 'preparing', 'ready_for_pickup');
    return { foodOrderId, status: 'ready_for_pickup' as const };
  }

  // ── Restaurant self-serve (launch hardening P1): open/close + sold-out ─────

  async function setRestaurantOpen(sellerUserId: string, isOpen: boolean) {
    const restaurant = await requireMyRestaurant(sellerUserId);
    await prisma.restaurant.update({ where: { id: restaurant.id }, data: { isOpen } });
    return { ...restaurant, isOpen };
  }

  // Full menu INCLUDING unavailable items — the management view, not the
  // customer catalog (which filters to isAvailable).
  async function getRestaurantMenu(sellerUserId: string) {
    const restaurant = await requireMyRestaurant(sellerUserId);
    const items = await prisma.menuItem.findMany({
      where:   { restaurantId: restaurant.id },
      orderBy: [{ menuCategoryId: 'asc' }, { sortOrder: 'asc' }],
      select: {
        id: true, name: true, pricePaise: true, isVeg: true, isAvailable: true,
        menuCategory: { select: { name: true } },
      },
    });
    return {
      restaurant,
      items: items.map((m) => ({
        id: m.id, name: m.name, pricePaise: m.pricePaise, isVeg: m.isVeg,
        isAvailable: m.isAvailable, category: m.menuCategory?.name ?? 'Menu',
      })),
    };
  }

  async function setMenuItemAvailability(sellerUserId: string, menuItemId: string, isAvailable: boolean) {
    const restaurant = await requireMyRestaurant(sellerUserId);
    // updateMany scoped by restaurantId = ownership check + write in one shot.
    const res = await prisma.menuItem.updateMany({
      where: { id: menuItemId, restaurantId: restaurant.id },
      data:  { isAvailable },
    });
    if (res.count === 0) throw new NotFoundError('Menu item');
    return { menuItemId, isAvailable };
  }

  // ── Admin: refunds needing attention (launch hardening P0-4 visibility) ────
  async function listRefundsNeedingAttention() {
    return prisma.foodOrder.findMany({
      where: {
        OR: [
          { refundStatus: 'failed' },
          // 'pending' that never resolved (crash mid-attempt) — sweep retries
          // these too; listed here so ops can see them.
          { refundStatus: 'pending', updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
      select: {
        id: true, customerId: true, totalPaise: true, refundStatus: true,
        razorpayPaymentId: true, cancelledAt: true, cancelReason: true,
        restaurant: { select: { name: true } },
      },
    });
  }

  // ── Rider food pickups (Food.md §12 Phase 6) ────────────────────────────────
  // PII window (RC1 P1): the UNCLAIMED list is visible to every online rider,
  // so it carries only what's needed to decide (restaurant, items, drop
  // locality, amount) — no street, no receiver name/phone, no payment ids.
  // The full drop address + receiver contact appear only on the rider's OWN
  // claimed orders (they need them to deliver and call).
  async function listRiderPickups(riderProfileId: string) {
    const restaurantSel = { select: { id: true, name: true, address: true, lat: true, lng: true } };
    const itemsSel      = { select: { name: true, quantity: true } };
    const [available, active] = await Promise.all([
      // Unclaimed, ready to collect — minimal payload.
      prisma.foodOrder.findMany({
        where:   { status: 'ready_for_pickup', riderId: null },
        orderBy: { readyAt: 'asc' },
        take:    20,
        select: {
          id: true, status: true, totalPaise: true, readyAt: true,
          deliveryLocality: true,
          restaurant: restaurantSel, items: itemsSel,
        },
      }),
      // Mine, still in flight — full delivery fields.
      prisma.foodOrder.findMany({
        where:   { riderId: riderProfileId, status: { in: ['ready_for_pickup', 'picked_up', 'out_for_delivery'] } },
        orderBy: { readyAt: 'asc' },
        select: {
          id: true, status: true, totalPaise: true, readyAt: true,
          deliveryStreet: true, deliveryLandmark: true, deliveryLocality: true,
          deliveryLat: true, deliveryLng: true,
          receiverName: true, receiverPhone: true,
          restaurant: restaurantSel, items: itemsSel,
        },
      }),
    ]);
    return { available, active };
  }

  // Atomic claim — updateMany CAS on (status, riderId IS NULL): exactly one
  // rider can win; everyone else sees count === 0.
  async function claimPickup(riderProfileId: string, foodOrderId: string) {
    const res = await prisma.foodOrder.updateMany({
      where: { id: foodOrderId, status: 'ready_for_pickup', riderId: null },
      data:  { riderId: riderProfileId },
    });
    if (res.count === 0) throw new BusinessRuleError('Yeh order kisi aur rider ne le liya');
    return { foodOrderId, claimed: true as const };
  }

  async function riderOrderAction(
    riderProfileId: string, foodOrderId: string, from: string, to: string,
  ) {
    const order = await prisma.foodOrder.findUnique({ where: { id: foodOrderId } });
    if (!order || order.riderId !== riderProfileId) throw new NotFoundError('Food order');
    if (order.status !== from) {
      throw new BusinessRuleError(`Order is ${order.status} — yeh action ab nahi ho sakta`);
    }
    const flipped = await prisma.$transaction((tx) =>
      transitionFoodOrderStatus(tx, foodOrderId, from, to, { role: 'rider', id: riderProfileId }),
    );
    if (!flipped) throw new BusinessRuleError('Order ka status badal gaya — refresh karein');
    // Milestone pushes (best-effort): only out_for_delivery/delivered have copy
    // — notifyCustomerFoodMilestone no-ops for the other rider hops.
    void notifyCustomerFoodMilestone(redis, order.customerId, foodOrderId, to);
    return { foodOrderId, status: to };
  }

  const markPickedUp       = (riderId: string, id: string) => riderOrderAction(riderId, id, 'ready_for_pickup', 'picked_up');
  const markOutForDelivery = (riderId: string, id: string) => riderOrderAction(riderId, id, 'picked_up', 'out_for_delivery');
  const markDelivered      = (riderId: string, id: string) => riderOrderAction(riderId, id, 'out_for_delivery', 'delivered');

  return {
    placeOrder, verifyPayment, getMyOrders, getOrder, cancelByCustomer,
    getMyRestaurant, listRestaurantOrders,
    acceptOrder, rejectOrder, markPreparing, markReady,
    setRestaurantOpen, getRestaurantMenu, setMenuItemAvailability,
    listRefundsNeedingAttention,
    listRiderPickups, claimPickup, markPickedUp, markOutForDelivery, markDelivered,
  };
}
