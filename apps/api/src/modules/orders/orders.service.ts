import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import type { PlaceOrderInput } from './orders.schema';
import { calculateDeliveryFee, getActiveFeeRuleVersion } from '../pricing/pricing.service';
import {
  NotFoundError, ForbiddenError,
  ValidationError, BusinessRuleError, AppError,
} from '../../shared/errors/app-errors';
import { isWithinOperatingHours, OPERATING_HOURS_LABEL } from '../../shared/config/operating-hours';
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
    shopId?: string; shopName?: string;   // per-item shop (multi-shop carts)
  }>;
}

export function createOrdersService(prisma: PrismaClient, redis: Redis) {

  async function placeOrder(userId: string, input: PlaceOrderInput) {
    // Operating-hours gate — Bringly delivers 8 AM – 9 PM IST.
    if (!isWithinOperatingHours()) {
      throw new AppError(
        422,
        `We deliver ${OPERATING_HOURS_LABEL}. Place your order tomorrow!`,
        'SHOP_CLOSED',
      );
    }

    const cartRaw = await redis.get(`cart:${userId}`);
    if (!cartRaw) throw new ValidationError('Cart khaali hai');
    const cart = JSON.parse(cartRaw) as CartData;
    if (!cart.items?.length) throw new ValidationError('Cart mein kuch nahi hai');

    const address = await prisma.address.findUnique({ where: { id: input.addressId } });
    if (!address || address.isDeleted) throw new NotFoundError('Address');
    if (address.userId !== userId) throw new ForbiddenError('Not your address');

    // ── Group cart items by shop — each shop becomes its own order ────────────
    const shopIds = [...new Set(cart.items.map((i) => i.shopId ?? cart.shopId).filter(Boolean))];
    if (shopIds.length === 0) throw new BusinessRuleError('Cart mein dukaan nahi mili');

    const ruleVersion = await getActiveFeeRuleVersion(prisma);

    interface ShopPlan {
      shopId: string; shopName: string; sellerUserId: string | null;
      items: CartData['items']; subtotal: number; isFeatured: boolean;
    }
    const plans: ShopPlan[] = [];
    for (const sid of shopIds) {
      const shop = await prisma.shop.findUnique({
        where:  { id: sid },
        select: { isActive: true, name: true, sellerId: true, isFeatured: true },
      });
      if (!shop || !shop.isActive) throw new BusinessRuleError('Yeh dukaan abhi available nahi hai');

      const shopItems = cart.items.filter((i) => (i.shopId ?? cart.shopId) === sid);
      const subtotal  = shopItems.reduce((s, i) => s + i.subtotal, 0);
      const seller = await prisma.sellerProfile.findUnique({ where: { id: shop.sellerId }, select: { userId: true } });

      plans.push({
        shopId: sid, shopName: shop.name, sellerUserId: seller?.userId ?? null,
        items: shopItems, subtotal, isFeatured: shop.isFeatured,
      });
    }

    // Flat pricing (Chirawa): one combined fee for the whole cart — no distance.
    // ₹25 if cart < ₹100, else ₹15 if any shop is Chirawa Special, else ₹10.
    // The single fee is carried by one order (a Special shop if present, else the
    // first); the other shops' orders pay 0.
    const hasSpecialShop = plans.some((p) => p.isFeatured);
    const combinedFee    = calculateDeliveryFee({
      cartSubtotalPaise: cart.subtotal,
      hasSpecialShop,
      ruleVersion,
    }).feePaise;
    const specialIdx     = plans.findIndex((p) => p.isFeatured);
    const feeCarrierIdx  = specialIdx >= 0 ? specialIdx : 0;

    // Promo: only supported on single-shop checkouts for now.
    let discountPaise = 0;
    let promoCodeId: string | null = null;
    if (input.promoCode) {
      if (plans.length > 1) throw new ValidationError('Promo code abhi sirf ek dukaan ke order par lagta hai');
      const promo = await prisma.promoCode.findUnique({ where: { code: input.promoCode.toUpperCase() } });
      if (!promo || !promo.isActive) throw new ValidationError('Yeh promo code valid nahi hai');
      if (promo.expiresAt && promo.expiresAt < new Date()) throw new ValidationError('Promo code expire ho gaya');
      if (cart.subtotal < promo.minCartPaise) {
        throw new ValidationError(`Is promo ke liye minimum cart ₹${Math.round(promo.minCartPaise / 100)} chahiye`);
      }
      const usedCount = await prisma.promoRedemption.count({ where: { promoCodeId: promo.id, userId } });
      if (usedCount >= promo.maxUsesPerUser) throw new ValidationError('Is promo code ka use kar chuke hain');
      discountPaise = promo.type === 'flat' ? promo.valuePaise : Math.floor((cart.subtotal * promo.valuePaise) / 10000);
      promoCodeId = promo.id;
    }

    const isCod      = input.paymentMethod === 'cod';
    const initStatus = isCod ? 'confirmed' : 'pending_payment';

    const created = await prisma.$transaction(async (tx) => {
      const out: Array<{ orderId: string; shopId: string; shopName: string; total: number; sellerUserId: string | null }> = [];
      for (let idx = 0; idx < plans.length; idx++) {
        const p        = plans[idx]!;
        const fee      = idx === feeCarrierIdx ? combinedFee : 0;
        const discount = idx === feeCarrierIdx ? discountPaise : 0;
        const total    = p.subtotal + fee - discount;

        const newOrder = await tx.order.create({
          data: {
            customerId: userId, shopId: p.shopId,
            deliveryStreet: address.street, deliveryLandmark: address.landmark,
            deliveryLocality: address.locality, deliveryCity: address.city,
            deliveryPincode: address.pincode, deliveryLat: address.lat, deliveryLng: address.lng,
            cartSubtotalAtPricing: p.subtotal, deliveryFee: fee,
            discount, totalAmount: total,
            feeRuleVersion: ruleVersion, distanceKm: 0, distanceSource: 'flat',
            paymentMethod: input.paymentMethod, status: initStatus,
            addressId: address.id, promoCodeId: idx === feeCarrierIdx ? promoCodeId : null,
            ...(isCod ? { confirmedAt: new Date() } : {}),
          },
        });
        await tx.orderItem.createMany({
          data: p.items.map((item) => ({
            orderId: newOrder.id, productId: item.productId,
            productName: item.productName, unitPrice: item.unitPrice,
            quantity: item.quantity, subtotal: item.subtotal,
          })),
        });
        await tx.orderStatusHistory.create({
          data: { orderId: newOrder.id, status: initStatus, changedByRole: 'customer', changedById: userId },
        });
        out.push({ orderId: newOrder.id, shopId: p.shopId, shopName: p.shopName, total, sellerUserId: p.sellerUserId });
      }
      if (promoCodeId) {
        await tx.promoRedemption.create({ data: { promoCodeId, userId, orderId: out[feeCarrierIdx]!.orderId, discount: discountPaise } });
        await tx.promoCode.update({ where: { id: promoCodeId }, data: { currentUses: { increment: 1 } } });
      }
      return out;
    });

    await redis.del(`cart:${userId}`);
    await prisma.cart.deleteMany({ where: { userId } });

    for (const o of created) {
      const plan = plans.find((p) => p.shopId === o.shopId)!;
      if (o.sellerUserId) {
        emitNewOrderForSeller({
          orderId: o.orderId, shopId: o.shopId, sellerId: o.sellerUserId,
          items: plan.items.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice })),
          totalAmount: o.total, paymentMethod: input.paymentMethod, deliveryLocality: address.locality,
        });
      }
      emitOrderStatusChanged({
        orderId: o.orderId, status: initStatus, shopId: o.shopId,
        sellerId: o.sellerUserId ?? '', riderId: null, customerId: userId,
      });
    }

    const grandTotal = created.reduce((s, o) => s + o.total, 0);
    const primary    = created[feeCarrierIdx] ?? created[0]!;
    return {
      orderId:     primary.orderId,
      orderIds:    created.map((o) => o.orderId),
      status:      initStatus,
      totalAmount: grandTotal,
      message: isCod
        ? (created.length > 1 ? `${created.length} orders place ho gaye!` : 'Order place ho gaya!')
        : 'Payment complete karein',
    };
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
      include: { items: { select: { productId: true, productName: true, quantity: true, unitPrice: true } } },
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

  // ── Customer rating ──────────────────────────────────────────────────────

  async function rateOrder(
    orderId: string,
    customerUserId: string,
    rating: number,
    comment?: string,
  ) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order');
    if (order.customerId !== customerUserId) throw new ForbiddenError('Not your order');
    if (order.status !== 'delivered') {
      throw new BusinessRuleError('Order delivered hone ke baad hi rate kar sakte hain');
    }
    if (order.ratedAt) {
      throw new BusinessRuleError('Order pehle hi rate kiya ja chuka hai');
    }
    return prisma.order.update({
      where: { id: orderId },
      data:  {
        rating,
        ratingComment: comment && comment.length > 0 ? comment : null,
        ratedAt:       new Date(),
      },
    });
  }

  return {
    placeOrder, getOrder, getMyOrders, updateOrderStatus,
    sellerAcceptOrder, sellerRejectOrder, sellerMarkPreparing, sellerMarkReady,
    cancelOrder, codCollected, rateOrder,
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
