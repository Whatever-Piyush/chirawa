import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import type { PlaceOrderInput } from './orders.schema';
import { calculateDeliveryFee, getActiveFeeRuleVersion } from '../pricing/pricing.service';
import { getRoadDistance } from '../pricing/distance.service';
import {
  NotFoundError, ForbiddenError,
  ValidationError, BusinessRuleError,
} from '../../shared/errors/app-errors';

interface CartData {
  cartId: string; shopId: string; shopName: string; subtotal: number;
  items: Array<{
    productId: string; productName: string;
    unitPrice: number; quantity: number; subtotal: number;
  }>;
}

export function createOrdersService(prisma: PrismaClient, redis: Redis) {

  // ── Place Order ─────────────────────────────────────────────────────────────
  async function placeOrder(userId: string, input: PlaceOrderInput) {
    // 1. Load cart from Redis
    const cartRaw = await redis.get(`cart:${userId}`);
    if (!cartRaw) throw new ValidationError('Cart khaali hai');
    const cart = JSON.parse(cartRaw) as CartData;
    if (!cart.items || cart.items.length === 0) {
      throw new ValidationError('Cart mein kuch nahi hai');
    }

    // 2. Validate address ownership
    const address = await prisma.address.findUnique({ where: { id: input.addressId } });
    if (!address || address.isDeleted) throw new NotFoundError('Address');
    if (address.userId !== userId) throw new ForbiddenError('Not your address');

    // 3. Load shop for distance calculation
    const shop = await prisma.shop.findUnique({
      where:  { id: cart.shopId },
      select: { lat: true, lng: true, isActive: true, isOpen: true },
    });
    if (!shop || !shop.isActive) {
      throw new BusinessRuleError('Yeh dukaan abhi available nahi hai');
    }

    // 4. Calculate road distance
    const { metres, source } = await getRoadDistance(
      Number(shop.lat), Number(shop.lng),
      Number(address.lat), Number(address.lng),
      redis,
    );

    // 5. Get active fee rule + calculate delivery fee
    const ruleVersion = await getActiveFeeRuleVersion(prisma);
    const feeResult   = calculateDeliveryFee({
      cartSubtotalPaise: cart.subtotal,
      distanceMetres:    metres,
      ruleVersion,
    });

    // 6. Validate promo code (if provided)
    let discountPaise = 0;
    let promoCodeId: string | null = null;

    if (input.promoCode) {
      const promo = await prisma.promoCode.findUnique({
        where: { code: input.promoCode.toUpperCase() },
      });

      if (!promo || !promo.isActive) {
        throw new ValidationError('Yeh promo code valid nahi hai');
      }
      if (promo.expiresAt && promo.expiresAt < new Date()) {
        throw new ValidationError('Promo code expire ho gaya');
      }
      if (cart.subtotal < promo.minCartPaise) {
        throw new ValidationError(
          `Is promo ke liye minimum cart ₹${Math.round(promo.minCartPaise / 100)} chahiye`,
        );
      }
      // Check user hasn't exceeded max uses
      const usedCount = await prisma.promoRedemption.count({
        where: { promoCodeId: promo.id, userId },
      });
      if (usedCount >= promo.maxUsesPerUser) {
        throw new ValidationError('Is promo code ka use kar chuke hain');
      }

      discountPaise =
        promo.type === 'flat'
          ? promo.valuePaise
          : Math.floor((cart.subtotal * promo.valuePaise) / 10000); // percent

      promoCodeId = promo.id;
    }

    // 7. Wallet credit (future — stub for now)
    const walletDiscount = 0;
    const totalDiscount  = discountPaise + walletDiscount;
    const totalAmount    = cart.subtotal + feeResult.feePaise - totalDiscount;

    // 8. Initial status
    const isCod       = input.paymentMethod === 'cod';
    const initStatus  = isCod ? 'confirmed' : 'pending_payment';

    // 9. Create order atomically
    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          customerId: userId,
          shopId:     cart.shopId,

          // Address SNAPSHOT — copied fields, not FK
          deliveryStreet:   address.street,
          deliveryLandmark: address.landmark,
          deliveryLocality: address.locality,
          deliveryCity:     address.city,
          deliveryPincode:  address.pincode,
          deliveryLat:      address.lat,
          deliveryLng:      address.lng,

          // Pricing SNAPSHOT
          cartSubtotalAtPricing: cart.subtotal,
          deliveryFee:           feeResult.feePaise,
          discount:              totalDiscount,
          totalAmount,
          feeRuleVersion:        ruleVersion,
          distanceKm:            feeResult.distanceKm,
          distanceSource:        source,

          paymentMethod: input.paymentMethod,
          status:        initStatus,
          addressId:     address.id,
          promoCodeId,
          ...(isCod ? { confirmedAt: new Date() } : {}),
        },
      });

      // Order items — SNAPSHOT of product name + price at order time
      await tx.orderItem.createMany({
        data: cart.items.map((item) => ({
          orderId:     newOrder.id,
          productId:   item.productId,
          productName: item.productName, // snapshot
          unitPrice:   item.unitPrice,   // snapshot
          quantity:    item.quantity,
          subtotal:    item.subtotal,
        })),
      });

      // Status history — first entry
      await tx.orderStatusHistory.create({
        data: {
          orderId:      newOrder.id,
          status:       initStatus,
          changedByRole: 'customer',
          changedById:   userId,
        },
      });

      // Promo redemption record
      if (promoCodeId) {
        await tx.promoRedemption.create({
          data: {
            promoCodeId,
            userId,
            orderId:  newOrder.id,
            discount: discountPaise,
          },
        });
        await tx.promoCode.update({
          where: { id: promoCodeId },
          data:  { currentUses: { increment: 1 } },
        });
      }

      return newOrder;
    });

    // 10. Clear cart
    await redis.del(`cart:${userId}`);
    await prisma.cart.deleteMany({ where: { userId } });

    // 11. Return response
    if (isCod) {
      return {
        orderId: order.id,
        status:  'confirmed',
        totalAmount,
        message: 'Order place ho gaya! Rider jaldi pahunchega.',
      };
    }

    // Online payment — razorpay integration in Step 7
    return {
      orderId:         order.id,
      status:          'pending_payment',
      totalAmount,
      razorpayOrderId: null, // Filled in Step 7
      message:         'Payment complete karein',
    };
  }

  // ── Get single order (ownership enforced) ──────────────────────────────────
  async function getOrder(orderId: string, userId: string, role: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items:         true,
        statusHistory: { orderBy: { changedAt: 'asc' } },
        payments:      { select: { status: true, method: true, amountPaise: true } },
      },
    });

    if (!order) throw new NotFoundError('Order');

    // Ownership: customer sees their own, seller sees their shop's, rider/admin sees all
    const allowed =
      role === 'admin' ||
      (role === 'customer' && order.customerId === userId) ||
      (role === 'rider'    && order.riderId === userId);

    if (!allowed) throw new ForbiddenError('Not your order');

    return order;
  }

  // ── List my orders ──────────────────────────────────────────────────────────
  async function getMyOrders(userId: string, role: string) {
    const where =
      role === 'customer'
        ? { customerId: userId }
        : role === 'rider'
          ? { riderId: userId }
          : {};

    return prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    50,
      include: {
        items: { select: { productName: true, quantity: true, unitPrice: true } },
      },
    });
  }

  // ── Cancel order ───────────────────────────────────────────────────────────
  async function cancelOrder(
    orderId: string, userId: string, reason?: string,
  ) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order');
    if (order.customerId !== userId) throw new ForbiddenError('Not your order');

    // Can only cancel pending_payment or paid orders
    if (!['pending_payment', 'paid'].includes(order.status)) {
      throw new BusinessRuleError(
        'Order cancel nahi ho sakta — pehle se processing mein hai',
      );
    }

    // 2-minute cancel window for confirmed orders
    const ageSeconds = (Date.now() - order.createdAt.getTime()) / 1000;
    if (order.status === 'paid' && ageSeconds > 120) {
      throw new BusinessRuleError(
        'Cancel window khatam ho gayi (2 minute). Support se baat karein.',
      );
    }

    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data:  { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId,
          status:        'cancelled',
          changedByRole: 'customer',
          changedById:   userId,
          reason,
        },
      }),
    ]);

    return { message: 'Order cancel ho gaya' };
  }

  // ── COD collected by rider ─────────────────────────────────────────────────
  async function codCollected(
    orderId: string, riderId: string, amountPaise: number,
  ) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order');
    if (order.riderId !== riderId) throw new ForbiddenError('Not your delivery');
    if (order.paymentMethod !== 'cod') {
      throw new BusinessRuleError('Yeh COD order nahi hai');
    }

    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data:  {
          status:           'delivered',
          deliveredAt:      new Date(),
          codCollectedPaise: amountPaise,
        },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId,
          status:        'delivered',
          changedByRole: 'rider',
          changedById:   riderId,
        },
      }),
      // Track COD balance on rider
      prisma.riderProfile.update({
        where: { userId: riderId },
        data:  { codBalancePaise: { increment: amountPaise } },
      }),
    ]);

    return { message: 'Cash collection confirm ho gaya' };
  }

  return { placeOrder, getOrder, getMyOrders, cancelOrder, codCollected };
}
