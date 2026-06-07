import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import type { PlaceOrderInput } from './orders.schema';
import { calculateDeliveryFee, getActiveFeeRuleVersion } from '../pricing/pricing.service';
import { validatePromo, resolveAutoPromo, type ValidatedPromo } from '../promotions/promotions.service';
import { refundCapturedOrderPayment } from '../payments/payments.service';
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

// Minimal slice of the Prisma (transaction) client this helper needs — lets it
// be unit-tested with a fake tx.
interface StockTx {
  product: {
    updateMany: (args: unknown) => Promise<{ count: number }>;
    findUnique: (args: unknown) => Promise<{ stockQty: number | null; name: string } | null>;
  };
}

/**
 * Oversell protection (Phase 1.5). For each line, atomically decrement the
 * product's numeric stock IF it opted in (stockQty != null). The conditional
 * `gte` never matches a null (untracked) row, so `count === 0` means either the
 * product is untracked (allowed — skip) or there isn't enough stock (reject the
 * whole order via BusinessRuleError). On hitting zero, flip to out_of_stock.
 * Must be called inside the checkout $transaction so a reject rolls everything back.
 */
export async function decrementStockOrThrow(
  tx: StockTx,
  items: Array<{ productId: string; quantity: number }>,
): Promise<void> {
  for (const item of items) {
    const dec = await tx.product.updateMany({
      where: { id: item.productId, stockQty: { gte: item.quantity } },
      data:  { stockQty: { decrement: item.quantity } },
    });
    if (dec.count === 0) {
      const prod = await tx.product.findUnique({
        where: { id: item.productId }, select: { stockQty: true, name: true },
      });
      if (prod?.stockQty != null) {
        throw new BusinessRuleError(`${prod.name}: sirf ${prod.stockQty} stock bacha hai`);
      }
      // untracked product → nothing to decrement, continue
    } else {
      await tx.product.updateMany({
        where: { id: item.productId, stockQty: 0 },
        data:  { stockStatus: 'out_of_stock' },
      });
    }
  }
}

// Minimal Prisma slice for releaseOrderAssignment — testable with a fake client.
interface ReleaseTx {
  deliveryAssignment: { updateMany: (args: unknown) => Promise<{ count: number }> };
  order:  { update: (args: unknown) => Promise<unknown>; count: (args: unknown) => Promise<number> };
  batch:  { update: (args: unknown) => Promise<unknown> };
}
interface ReleasePrisma {
  $transaction: <T>(fn: (tx: ReleaseTx) => Promise<T>) => Promise<T>;
}

/**
 * Release a cancelled order's rider + batch (Phase 1.6). Runs in its own
 * transaction (order status is owned by updateOrderStatus): deactivates the
 * active assignment, detaches the order from rider + batch, and cancels the
 * batch when it has no live orders left. Deactivating the assignment is what
 * makes the order disappear from the rider's /delivery/active.
 */
export async function releaseOrderAssignment(
  prisma: ReleasePrisma,
  orderId: string,
  batchId: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.deliveryAssignment.updateMany({
      where: { orderId, isActive: true },
      data:  { isActive: false, completedAt: new Date(), rejectReason: 'Order cancelled' },
    });
    await tx.order.update({ where: { id: orderId }, data: { riderId: null, batchId: null } });
    if (batchId) {
      const liveInBatch = await tx.order.count({
        where: { batchId, status: { notIn: ['cancelled', 'delivered'] } },
      });
      if (liveInBatch === 0) {
        await tx.batch.update({ where: { id: batchId }, data: { status: 'cancelled' } });
      }
    }
  });
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

    // Promo: only supported on single-shop checkouts for now. A code typed by the
    // customer is validated; if none is given, first-time customers get FIRSTORDER
    // (free delivery) auto-applied. Discount lands on the fee-carrier order below.
    let discountPaise = 0;
    let promoCodeId: string | null = null;
    if (plans.length === 1) {
      let applied: ValidatedPromo | null = null;
      if (input.promoCode) {
        applied = await validatePromo(prisma, {
          code:              input.promoCode,
          userId,
          cartSubtotalPaise: cart.subtotal,
          deliveryFeePaise:  combinedFee,
        });
      } else {
        applied = await resolveAutoPromo(prisma, {
          userId,
          cartSubtotalPaise: cart.subtotal,
          deliveryFeePaise:  combinedFee,
        });
      }
      if (applied) {
        discountPaise = applied.discountPaise;
        promoCodeId   = applied.promoId;
      }
    } else if (input.promoCode) {
      throw new ValidationError('Promo code abhi sirf ek dukaan ke order par lagta hai');
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

        // Oversell protection (Phase 1.5) for products that opted into numeric stock.
        await decrementStockOrThrow(tx, p.items);

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
    refundedPaise?: number,
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
      ...(refundedPaise != null ? { refundedPaise } : {}),
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

  // Auto-accept on seller timeout (Chunk 8.2). No seller is acting, so ownership
  // isn't checked — only fires for an order still awaiting acceptance. Runs
  // in-process (API) so the paid→confirmed transition emits the usual events
  // (dispatch + customer notification). Tracks the miss on the seller profile.
  async function autoAcceptOrder(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { shop: { include: { seller: { select: { id: true, userId: true } } } } },
    });
    if (!order) return { autoAccepted: false, reason: 'not_found' };
    if (order.sellerAcceptedAt) return { autoAccepted: false, reason: 'already_accepted' };
    if (!['paid', 'confirmed'].includes(order.status)) return { autoAccepted: false, reason: 'not_pending' };

    await prisma.order.update({ where: { id: orderId }, data: { sellerAcceptedAt: new Date() } });
    await prisma.sellerProfile.update({
      where: { id: order.shop.sellerId },
      data:  { missedAcceptances: { increment: 1 } },
    });
    // Online orders still need paid → confirmed (COD is already confirmed).
    if (order.status === 'paid') {
      await updateOrderStatus(orderId, 'confirmed', 'seller', order.shop.seller.userId, 'Auto-accepted (no seller response)');
    }
    return { autoAccepted: true, status: 'confirmed' };
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
    // A seller-rejected prepaid order must be refunded too (Chunk 3.5).
    const refundedPaise = await refundCapturedOrderPayment(
      prisma, orderId, `Seller rejected: ${reason}`,
    );
    await updateOrderStatus(
      orderId, 'cancelled', 'seller', sellerUserId, reason,
      refundedPaise ?? undefined,
    );
    // Free any assigned rider/batch on a seller rejection too (Phase 1.6).
    if (order.riderId) await releaseOrderAssignment(prisma, orderId, order.batchId);
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

    // Prepaid order → auto-refund via Razorpay before flipping to cancelled, so
    // the cancelled notification can tell the customer the exact refund amount.
    // COD / unpaid orders refund nothing (helper returns null).
    const refundedPaise = await refundCapturedOrderPayment(
      prisma, orderId, reason ?? 'Customer cancelled',
    );

    await updateOrderStatus(
      orderId, 'cancelled', 'customer', userId, reason,
      refundedPaise ?? undefined,
    );

    // Notify the seller in real time (service → event bus → socket plugin)
    emitOrderCancelledForSeller({
      orderId,
      sellerId: order.shop.seller.userId,
      reason:   reason ?? '',
    });

    // Free the rider/batch AFTER the cancel emit so the rider still gets the
    // cancellation push, then the order leaves their active list (Phase 1.6).
    if (order.riderId) await releaseOrderAssignment(prisma, orderId, order.batchId);

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

  // Rider marks a non-COD (prepaid) order delivered. Mirrors codCollected — same
  // status + deliveredAt + history + ORDER_STATUS_CHANGED — but there is no cash
  // to record, so it never touches codCollectedPaise / the rider's COD balance.
  // COD orders MUST go through codCollected (which records the cash), so they are
  // rejected here; this is the symmetric counterpart of codCollected's non-COD guard.
  async function markDelivered(orderId: string, riderId: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order');
    if (order.riderId !== riderId) throw new ForbiddenError('Not your delivery');
    if (order.paymentMethod === 'cod') throw new BusinessRuleError('COD order: cash collection confirm karein');

    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data:  { status: 'delivered', deliveredAt: new Date() },
      }),
      prisma.orderStatusHistory.create({
        data: { orderId, status: 'delivered', changedByRole: 'rider', changedById: riderId },
      }),
    ]);

    emitOrderStatusChanged({
      orderId, status: 'delivered',
      shopId: order.shopId, sellerId: '', riderId, customerId: order.customerId,
    });
    return { message: 'Order delivered confirm ho gaya' };
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

  // Statuses where the customer can still edit the delivery address / receiver —
  // only before the rider picks the order up.
  const EDITABLE_STATUSES = new Set(['pending_payment', 'paid', 'confirmed', 'preparing']);

  async function updateDeliveryAddress(orderId: string, userId: string, addressId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId }, select: { id: true, customerId: true, status: true },
    });
    if (!order) throw new NotFoundError('Order');
    if (order.customerId !== userId) throw new ForbiddenError('Not your order');
    if (!EDITABLE_STATUSES.has(order.status)) {
      throw new BusinessRuleError('Address can no longer be changed for this order');
    }

    const address = await prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.userId !== userId) throw new NotFoundError('Address');

    await prisma.order.update({
      where: { id: orderId },
      data: {
        addressId:        address.id,
        deliveryStreet:   address.street,
        deliveryLandmark: address.landmark,
        deliveryLocality: address.locality,
        deliveryCity:     address.city,
        deliveryPincode:  address.pincode,
        deliveryLat:      address.lat,
        deliveryLng:      address.lng,
      },
    });
    return { message: 'Delivery address updated' };
  }

  async function updateReceiver(orderId: string, userId: string, name: string, phone: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId }, select: { id: true, customerId: true, status: true },
    });
    if (!order) throw new NotFoundError('Order');
    if (order.customerId !== userId) throw new ForbiddenError('Not your order');
    if (!EDITABLE_STATUSES.has(order.status)) {
      throw new BusinessRuleError('Receiver can no longer be changed for this order');
    }

    const cleanName  = name.trim().slice(0, 100);
    const cleanPhone = phone.replace(/[^0-9]/g, '').slice(0, 15);
    if (!cleanName) throw new ValidationError('Receiver name is required');
    if (cleanPhone.length < 10) throw new ValidationError('A valid phone number is required');

    await prisma.order.update({
      where: { id: orderId },
      data:  { receiverName: cleanName, receiverPhone: cleanPhone },
    });
    return { message: 'Receiver contact updated', receiverName: cleanName, receiverPhone: cleanPhone };
  }

  return {
    placeOrder, getOrder, getMyOrders, updateOrderStatus,
    sellerAcceptOrder, sellerRejectOrder, sellerMarkPreparing, sellerMarkReady,
    cancelOrder, codCollected, markDelivered, rateOrder, autoAcceptOrder,
    updateDeliveryAddress, updateReceiver,
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
