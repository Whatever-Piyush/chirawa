import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import type { PlaceOrderInput } from './orders.schema';
import { calculateDeliveryFee, getActiveFeeRuleVersion } from '../pricing/pricing.service';
import { getRoadDistance } from '../pricing/distance.service';
import {
  NotFoundError, ForbiddenError,
  ValidationError, BusinessRuleError,
} from '../../shared/errors/app-errors';
import {
  emitOrderStatusChanged,
  emitNewOrderForSeller,
  emitOrderCancelledForSeller,
} from '../../shared/events/event-bus';

interface CartData {
  cartId: string; shopId: string; shopName: string; subtotal: number;
  items: Array<{
    productId: string; productName: string;
    unitPrice: number; quantity: number; subtotal: number;
  }>;
}

export function createOrdersService(prisma: PrismaClient, redis: Redis) {

  async function placeOrder(userId: string, input: PlaceOrderInput) {
    const cartRaw = await redis.get(`cart:${userId}`);
    if (!cartRaw) throw new ValidationError('Cart khaali hai');
    const cart = JSON.parse(cartRaw) as CartData;
    if (!cart.items?.length) throw new ValidationError('Cart mein kuch nahi hai');

    const address = await prisma.address.findUnique({ where: { id: input.addressId } });
    if (!address || address.isDeleted) throw new NotFoundError('Address');
    if (address.userId !== userId) throw new ForbiddenError('Not your address');

    const shop = await prisma.shop.findUnique({
      where:  { id: cart.shopId },
      select: { lat: true, lng: true, isActive: true, name: true, address: true, sellerId: true },
    });
    if (!shop || !shop.isActive) throw new BusinessRuleError('Yeh dukaan abhi available nahi hai');

    const { metres, source } = await getRoadDistance(
      Number(shop.lat), Number(shop.lng),
      Number(address.lat), Number(address.lng),
      redis,
    );

    const ruleVersion = await getActiveFeeRuleVersion(prisma);
    const feeResult   = calculateDeliveryFee({
      cartSubtotalPaise: cart.subtotal,
      distanceMetres:    metres,
      ruleVersion,
    });

    let discountPaise = 0;
    let promoCodeId: string | null = null;

    if (input.promoCode) {
      const promo = await prisma.promoCode.findUnique({
        where: { code: input.promoCode.toUpperCase() },
      });
      if (!promo || !promo.isActive) throw new ValidationError('Yeh promo code valid nahi hai');
      if (promo.expiresAt && promo.expiresAt < new Date()) {
        throw new ValidationError('Promo code expire ho gaya');
      }
      if (cart.subtotal < promo.minCartPaise) {
        throw new ValidationError(`Is promo ke liye minimum cart ₹${Math.round(promo.minCartPaise / 100)} chahiye`);
      }
      const usedCount = await prisma.promoRedemption.count({
        where: { promoCodeId: promo.id, userId },
      });
      if (usedCount >= promo.maxUsesPerUser) throw new ValidationError('Is promo code ka use kar chuke hain');
      discountPaise = promo.type === 'flat'
        ? promo.valuePaise
        : Math.floor((cart.subtotal * promo.valuePaise) / 10000);
      promoCodeId = promo.id;
    }

    const totalAmount = cart.subtotal + feeResult.feePaise - discountPaise;
    const isCod       = input.paymentMethod === 'cod';
    const initStatus  = isCod ? 'confirmed' : 'pending_payment';

    // Get seller's userId for notifications
    const sellerProfile = await prisma.sellerProfile.findUnique({
      where:  { id: shop.sellerId },
      select: { userId: true },
    });

    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          customerId: userId, shopId: cart.shopId,
          deliveryStreet: address.street, deliveryLandmark: address.landmark,
          deliveryLocality: address.locality, deliveryCity: address.city,
          deliveryPincode: address.pincode, deliveryLat: address.lat, deliveryLng: address.lng,
          cartSubtotalAtPricing: cart.subtotal, deliveryFee: feeResult.feePaise,
          discount: discountPaise, totalAmount,
          feeRuleVersion: ruleVersion, distanceKm: feeResult.distanceKm, distanceSource: source,
          paymentMethod: input.paymentMethod, status: initStatus,
          addressId: address.id, promoCodeId,
          ...(isCod ? { confirmedAt: new Date() } : {}),
        },
      });
      await tx.orderItem.createMany({
        data: cart.items.map((item) => ({
          orderId: newOrder.id, productId: item.productId,
          productName: item.productName, unitPrice: item.unitPrice,
          quantity: item.quantity, subtotal: item.subtotal,
        })),
      });
      await tx.orderStatusHistory.create({
        data: { orderId: newOrder.id, status: initStatus, changedByRole: 'customer', changedById: userId },
      });
      if (promoCodeId) {
        await tx.promoRedemption.create({
          data: { promoCodeId, userId, orderId: newOrder.id, discount: discountPaise },
        });
        await tx.promoCode.update({ where: { id: promoCodeId }, data: { currentUses: { increment: 1 } } });
      }
      return newOrder;
    });

    await redis.del(`cart:${userId}`);
    await prisma.cart.deleteMany({ where: { userId } });

    if (sellerProfile) {
      emitNewOrderForSeller({
        orderId: order.id, shopId: cart.shopId, sellerId: sellerProfile.userId,
        items: cart.items.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice })),
        totalAmount, paymentMethod: input.paymentMethod, deliveryLocality: address.locality,
      });
    }

    emitOrderStatusChanged({
      orderId: order.id, status: initStatus, shopId: cart.shopId,
      sellerId: sellerProfile?.userId ?? '', riderId: null, customerId: userId,
    });

    return isCod
      ? { orderId: order.id, status: 'confirmed', totalAmount, message: 'Order place ho gaya!' }
      : { orderId: order.id, status: 'pending_payment', totalAmount, message: 'Payment complete karein' };
  }

  async function getOrder(orderId: string, userId: string, role: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true, statusHistory: { orderBy: { changedAt: 'asc' } },
        payments: { select: { status: true, method: true, amountPaise: true } },
      },
    });
    if (!order) throw new NotFoundError('Order');

    const sellerProfile = role === 'seller'
      ? await prisma.sellerProfile.findUnique({ where: { userId }, include: { shop: true } })
      : null;

    const allowed =
      role === 'admin' ||
      (role === 'customer' && order.customerId === userId) ||
      (role === 'rider'    && order.riderId === userId) ||
      (role === 'seller'   && sellerProfile?.shop?.id === order.shopId);

    if (!allowed) throw new ForbiddenError('Not your order');
    return order;
  }

  async function getMyOrders(userId: string, role: string) {
    let where: Record<string, unknown> = {};

    if (role === 'customer') {
      where = { customerId: userId };
    } else if (role === 'rider') {
      where = { riderId: userId };
    } else if (role === 'seller') {
      const sellerProfile = await prisma.sellerProfile.findUnique({
        where: { userId }, include: { shop: { select: { id: true } } },
      });
      if (!sellerProfile?.shop) return [];
      where = { shopId: sellerProfile.shop.id };
    }

    return prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    50,
      include: { items: { select: { productName: true, quantity: true, unitPrice: true } } },
    });
  }

  async function updateOrderStatus(
    orderId: string, newStatus: string,
    changedByRole: string, changedById: string, reason?: string,
  ) {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data: {
          status: newStatus as never,
          ...(newStatus === 'confirmed'        ? { confirmedAt: new Date() } : {}),
          ...(newStatus === 'picked_up'        ? { pickedUpAt:  new Date() } : {}),
          ...(newStatus === 'delivered'        ? { deliveredAt: new Date() } : {}),
          ...(newStatus === 'cancelled'        ? { cancelledAt: new Date(), cancelReason: reason } : {}),
        },
      }),
      prisma.orderStatusHistory.create({
        data: { orderId, status: newStatus as never, changedByRole: changedByRole as never, changedById, reason },
      }),
    ]);

    emitOrderStatusChanged({
      orderId, status: newStatus, shopId: order.shopId,
      sellerId: '', riderId: order.riderId, customerId: order.customerId,
    });
  }

  // ── Seller-specific actions ──────────────────────────────────────────────

  async function sellerAcceptOrder(orderId: string, sellerUserId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { shop: { include: { seller: { select: { userId: true } } } } },
    });
    if (!order) throw new NotFoundError('Order');
    if (order.shop.seller.userId !== sellerUserId) throw new ForbiddenError('Not your order');
    if (!['paid', 'confirmed'].includes(order.status)) {
      throw new BusinessRuleError('Order accept nahi ho sakta');
    }
    // Mark explicit seller acceptance so cold-start UI can tell "fresh order" from "seller already advanced past Accept".
    // updateOrderStatus follows so status reaches 'confirmed' for online (paid → confirmed) and stays 'confirmed' for COD.
    await prisma.order.update({
      where: { id: orderId },
      data:  { sellerAcceptedAt: new Date() },
    });
    await updateOrderStatus(orderId, 'confirmed', 'seller', sellerUserId);
    return { message: 'Order accept ho gaya' };
  }

  async function sellerRejectOrder(orderId: string, sellerUserId: string, reason: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { shop: { include: { seller: { select: { userId: true } } } } },
    });
    if (!order) throw new NotFoundError('Order');
    if (order.shop.seller.userId !== sellerUserId) throw new ForbiddenError('Not your order');
    if (!['paid', 'confirmed'].includes(order.status)) {
      throw new BusinessRuleError('Order reject nahi ho sakta');
    }
    await updateOrderStatus(orderId, 'cancelled', 'seller', sellerUserId, reason);
    return { message: 'Order reject ho gaya' };
  }

  async function sellerMarkPreparing(orderId: string, sellerUserId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { shop: { include: { seller: { select: { userId: true } } } } },
    });
    if (!order) throw new NotFoundError('Order');
    if (order.shop.seller.userId !== sellerUserId) throw new ForbiddenError('Not your order');
    await updateOrderStatus(orderId, 'preparing', 'seller', sellerUserId);
    return { message: 'Taiyari shuru ho gayi' };
  }

  async function sellerMarkReady(orderId: string, sellerUserId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { shop: { include: { seller: { select: { userId: true } } } } },
    });
    if (!order) throw new NotFoundError('Order');
    if (order.shop.seller.userId !== sellerUserId) throw new ForbiddenError('Not your order');
    await updateOrderStatus(orderId, 'ready_for_pickup', 'seller', sellerUserId);
    return { message: 'Order ready hai! Rider aa raha hai.' };
  }

  async function cancelOrder(orderId: string, userId: string, reason?: string) {
    const order = await prisma.order.findUnique({
      where:   { id: orderId },
      include: { shop: { include: { seller: { select: { userId: true } } } } },
    });
    if (!order) throw new NotFoundError('Order');
    if (order.customerId !== userId) throw new ForbiddenError('Not your order');
    if (!['pending_payment', 'paid', 'confirmed'].includes(order.status)) {
      throw new BusinessRuleError('ऑर्डर रद्द नहीं किया जा सकता — यह पहले से आगे बढ़ चुका है');
    }

    // Online order with money actually captured → log a refund for manual Razorpay processing
    const capturedPayment = order.paymentMethod !== 'cod'
      ? await prisma.payment.findFirst({ where: { orderId, status: 'captured' } })
      : null;

    await updateOrderStatus(orderId, 'cancelled', 'customer', userId, reason);

    if (capturedPayment) {
      await prisma.transaction.create({
        data: {
          type:          'refund',
          amountPaise:   order.totalAmount,
          referenceId:   order.id,
          referenceType: 'order',
          description:   'Auto-refund on cancellation — process via Razorpay dashboard',
        },
      });
    }

    // Notify the seller in real time (service → event bus → socket plugin)
    emitOrderCancelledForSeller({
      orderId,
      sellerId: order.shop.seller.userId,
      reason:   reason ?? '',
    });

    return { message: 'Order cancel ho gaya' };
  }

  async function codCollected(orderId: string, riderId: string, amountPaise: number) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order');
    if (order.riderId !== riderId) throw new ForbiddenError('Not your delivery');
    if (order.paymentMethod !== 'cod') throw new BusinessRuleError('Yeh COD order nahi hai');

    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data:  { status: 'delivered', deliveredAt: new Date(), codCollectedPaise: amountPaise },
      }),
      prisma.orderStatusHistory.create({
        data: { orderId, status: 'delivered', changedByRole: 'rider', changedById: riderId },
      }),
      prisma.riderProfile.update({
        where: { userId: riderId },
        data:  { codBalancePaise: { increment: amountPaise } },
      }),
    ]);

    emitOrderStatusChanged({
      orderId, status: 'delivered',
      shopId: order.shopId, sellerId: '', riderId, customerId: order.customerId,
    });
    return { message: 'Cash collection confirm ho gaya' };
  }

  return {
    placeOrder, getOrder, getMyOrders, updateOrderStatus,
    sellerAcceptOrder, sellerRejectOrder, sellerMarkPreparing, sellerMarkReady,
    cancelOrder, codCollected,
  };
}

export async function enqueueReferralUnlock(
  prisma: PrismaClient,
  redis: Redis,
  orderId: string,
  customerId: string,
): Promise<void> {
  const redemption = await prisma.referralRedemption.findUnique({
    where: { referredUserId: customerId },
  });
  if (!redemption || redemption.refereeCreditStatus === 'credited') return;
  console.log(`[Referral] Unlock queued for order ${orderId}`);
}
