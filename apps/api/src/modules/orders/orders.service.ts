import type { Prisma, PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import type { PlaceOrderInput } from './orders.schema';
import { calculateDeliveryFee, getActiveFeeRuleVersion } from '../pricing/pricing.service';
import { validatePromo, resolveAutoPromo, type ValidatedPromo } from '../promotions/promotions.service';
import { createResolverService, type AggLine } from '../orders/resolver.service';
import { refundCapturedOrderPayment, refundOrderLine } from '../payments/payments.service';
import { createCatalogService } from '../catalog/catalog.service';
import { computeAndPersistEta, etaResponse } from './eta.service';
import { ORDER_TRANSITIONS, assertTransition, transitionOrderStatus } from './order-status';
import { serviceLogger } from '../../shared/observability/logger';
import {
  NotFoundError, ForbiddenError,
  ValidationError, BusinessRuleError, AppError,
} from '../../shared/errors/app-errors';
import { isWithinOperatingHours, OPERATING_HOURS_LABEL } from '../../shared/config/operating-hours';
import {
  emitOrderStatusChanged,
  emitNewOrderForSeller,
  emitOrderCancelledForSeller,
  emitOrderItemUnavailable,
} from '../../shared/events/event-bus';

const log = serviceLogger('orders');

interface CartData {
  cartId: string; shopId: string; shopName: string; subtotal: number;
  items: Array<{
    productId: string; productName: string;
    unitPrice: number; quantity: number; subtotal: number;
    shopId?: string; shopName?: string;   // per-item shop (multi-shop carts)
    masterId?: string; aggregated?: boolean; // Phase 5 — fungible line markers
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
  // Accepts the real transaction client OR the minimal test fake. The union +
  // internal cast is needed because Prisma's concrete method signatures aren't
  // structurally assignable to the `(args: unknown)` slices under strict
  // variance — behaviour is identical.
  txClient: StockTx | Prisma.TransactionClient,
  items: Array<{ productId: string; quantity: number }>,
): Promise<void> {
  const tx = txClient as StockTx;
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

// ── Order state machine (Phase 1.7) ──────────────────────────────────────────
// The state machine + the single transition enforcement point now live in
// ./order-status. Re-exported here for back-compat with existing importers.
export { ORDER_TRANSITIONS, assertTransition };

// P0-2: the full-refund amount for an order's captured prepaid payment (undefined
// for COD / unpaid). Lets a caller REVOKE FULFILLABILITY (cancel) BEFORE issuing the
// external refund while still telling the customer the exact amount up-front — for a
// full cancel the refund helper always moves order.totalAmount.
function expectedRefundPaise(order: {
  paymentMethod: string;
  totalAmount: number;
  payments: { status: string; razorpayPaymentId: string | null }[];
}): number | undefined {
  if (order.paymentMethod === 'cod') return undefined;
  const hasCaptured = order.payments.some((p) => p.status === 'captured' && p.razorpayPaymentId);
  return hasCaptured ? order.totalAmount : undefined;
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
  // Real client or minimal test fake — see decrementStockOrThrow for why the
  // union + cast is required under strict structural variance.
  client: ReleasePrisma | PrismaClient,
  orderId: string,
  batchId: string | null,
): Promise<void> {
  const prisma = client as ReleasePrisma;
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
  const resolver = createResolverService(prisma);

  async function placeOrder(userId: string, input: PlaceOrderInput) {
    // Operating-hours gate — Bringly delivers 9 AM – 8 PM IST.
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

    // ── Phase 5: resolve aggregated (fungible) lines → concrete shops ──────────
    // An "aggregated" line (its master is approved — the Phase 4 feed gate) may be
    // fulfilled by ANY shop carrying that master, so we re-route it now to the
    // fewest in-stock shops (then nearest), re-validating stock + price. Pinned
    // lines (Specials / passthrough / legacy carts) keep their shop untouched. A
    // line nobody has in stock anymore is dropped (surfaced as "just sold out").
    const deliveryPoint = { lat: Number(address.lat), lng: Number(address.lng) };
    const aggLines: AggLine[] = [];
    cart.items.forEach((i, idx) => {
      if (i.aggregated && i.masterId) {
        aggLines.push({ key: String(idx), masterId: i.masterId, quantity: i.quantity, displayedUnitPrice: i.unitPrice });
      }
    });
    const { assignments, dropped } = aggLines.length
      ? await resolver.resolveCart(aggLines, deliveryPoint)
      : { assignments: new Map<string, { shopId: string; productId: string; unitPrice: number }>(), dropped: [] as string[] };

    const droppedLines: Array<{ productId: string; productName: string }> = [];
    const lineItems: CartData['items'] = [];
    cart.items.forEach((i, idx) => {
      if (i.aggregated && i.masterId) {
        const a = assignments.get(String(idx));
        if (!a) { droppedLines.push({ productId: i.productId, productName: i.productName }); return; }
        lineItems.push({ ...i, shopId: a.shopId, productId: a.productId, unitPrice: a.unitPrice, subtotal: a.unitPrice * i.quantity });
      } else {
        lineItems.push(i);
      }
    });
    if (lineItems.length === 0) {
      throw new BusinessRuleError('Aapke cart ke saare items abhi stock mein nahi hain');
    }
    const orderSubtotal = lineItems.reduce((s, i) => s + i.subtotal, 0);

    // ── Group resolved items by shop — each shop becomes its own child order ───
    const shopIds = [...new Set(lineItems.map((i) => i.shopId ?? cart.shopId).filter(Boolean))];
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

      const shopItems = lineItems.filter((i) => (i.shopId ?? cart.shopId) === sid);
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
      cartSubtotalPaise: orderSubtotal,
      hasSpecialShop,
      ruleVersion,
    }).feePaise;
    const specialIdx     = plans.findIndex((p) => p.isFeatured);
    const feeCarrierIdx  = specialIdx >= 0 ? specialIdx : 0;

    // Promo (Phase 5): applied at the GROUP subtotal so a unified aggregated cart
    // gets one discount across all its child shops — not per shop. A code typed by
    // the customer is validated; if none is given, first-time customers get
    // FIRSTORDER (free delivery) auto-applied. Discount lands on the fee-carrier
    // order below (same order that carries the single delivery fee), so the group
    // total nets out correctly.
    let discountPaise = 0;
    let promoCodeId: string | null = null;
    {
      let applied: ValidatedPromo | null = null;
      if (input.promoCode) {
        applied = await validatePromo(prisma, {
          code:              input.promoCode,
          userId,
          cartSubtotalPaise: orderSubtotal,
          deliveryFeePaise:  combinedFee,
        });
      } else {
        applied = await resolveAutoPromo(prisma, {
          userId,
          cartSubtotalPaise: orderSubtotal,
          deliveryFeePaise:  combinedFee,
        });
      }
      if (applied) {
        discountPaise = applied.discountPaise;
        promoCodeId   = applied.promoId;
      }
    }

    const isCod      = input.paymentMethod === 'cod';
    const initStatus = isCod ? 'confirmed' : 'pending_payment';

    const { created, groupId } = await prisma.$transaction(async (tx) => {
      // Phase 5: a multi-shop cart becomes ONE customer-facing OrderGroup over N
      // per-shop child orders. Single-shop carts stay ungrouped (legacy behavior).
      const grp = plans.length > 1
        ? await tx.orderGroup.create({ data: { customerId: userId } })
        : null;
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
            ...(grp ? { groupId: grp.id } : {}),
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
      return { created: out, groupId: grp?.id ?? null };
    });

    await redis.del(`cart:${userId}`);
    await prisma.cart.deleteMany({ where: { userId } });

    for (const o of created) {
      const plan = plans.find((p) => p.shopId === o.shopId)!;
      if (o.sellerUserId) {
        emitNewOrderForSeller({
          orderId: o.orderId, shopId: o.shopId, sellerUserId: o.sellerUserId,
          items: plan.items.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice })),
          totalAmount: o.total, paymentMethod: input.paymentMethod, deliveryLocality: address.locality,
        });
      }
      emitOrderStatusChanged({
        orderId: o.orderId, status: initStatus, shopId: o.shopId, customerId: userId,
      });
      // Initial ETA at placement (ETA MVP Phase 1) — post-commit, best-effort.
      await computeAndPersistEta(prisma, o.orderId);
    }

    const grandTotal = created.reduce((s, o) => s + o.total, 0);
    const primary    = created[feeCarrierIdx] ?? created[0]!;
    return {
      orderId:     primary.orderId,
      orderIds:    created.map((o) => o.orderId),
      groupId,
      // Per-shop breakdown so the client can show "₹X from Shop A, ₹Y from Shop B"
      // on the order-placed + group-tracking screens (multi-shop UX). Order matches
      // `orderIds`; `total` is each child order's grand total (paise).
      shops:       created.map((o) => ({ orderId: o.orderId, shopId: o.shopId, shopName: o.shopName, total: o.total })),
      status:      initStatus,
      totalAmount: grandTotal,
      // Aggregated lines nobody had in stock at checkout — the client shows these
      // as "just sold out"; the rest of the order proceeded.
      ...(droppedLines.length ? { droppedLines } : {}),
      message: isCod
        ? (created.length > 1 ? `${created.length} orders place ho gaye!` : 'Order place ho gaya!')
        : 'Payment complete karein',
    };
  }

  async function getOrder(orderId: string, userId: string, role: string, riderProfileId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true, statusHistory: { orderBy: { changedAt: 'asc' } },
        payments: { select: { status: true, method: true, amountPaise: true, refundedPaise: true } },
      },
    });
    if (!order) throw new NotFoundError('Order');

    const sellerProfile = role === 'seller'
      ? await prisma.sellerProfile.findUnique({ where: { userId }, include: { shop: true } })
      : null;

    const allowed =
      role === 'admin' ||
      (role === 'customer' && order.customerId === userId) ||
      (role === 'rider'    && order.riderId === riderProfileId) ||
      (role === 'seller'   && sellerProfile?.shop?.id === order.shopId);

    if (!allowed) throw new ForbiddenError('Not your order');

    // BUG-2 + privacy hardening: surface the assigned rider's name + phone
    // (OrderDetailResponse.rider) ONLY during active delivery — picked_up /
    // out_for_delivery — and ONLY to the customer / rider / admin. Never to the
    // seller, never pre-pickup, never on a terminal order (delivered / cancelled).
    // This bounds the rider's personal-PII exposure to the operational window.
    // Order.riderId is the RiderProfile.id; the phone lives on the linked User
    // (Option A — no schema change). The lookup is best-effort: a failure must NOT
    // break order retrieval.
    const riderInActiveDelivery =
      order.status === 'picked_up' || order.status === 'out_for_delivery';
    const viewerMaySeeRider =
      role === 'customer' || role === 'rider' || role === 'admin';

    let rider: { name: string; phone: string } | undefined;
    if (order.riderId && riderInActiveDelivery && viewerMaySeeRider) {
      try {
        const profile = await prisma.riderProfile.findUnique({
          where:  { id: order.riderId },
          select: { fullName: true, user: { select: { phone: true } } },
        });
        if (profile?.user?.phone) {
          rider = { name: profile.fullName, phone: profile.user.phone };
        }
      } catch {
        /* best-effort: a rider-lookup failure must not fail order retrieval */
      }
    }

    // Server-computed delivery ETA as a duration + serverNow (ETA MVP Phase 1).
    // Omitted for terminal/unset orders. Poll fallback if a socket push is missed.
    const eta = etaResponse(order);

    // Refund visibility (Tracking V2 P0.2) — read-only, derived. Prepaid full/line refunds
    // land on Payment.refundedPaise; COD line adjustments only on the OrderItem. max() avoids
    // double-counting a prepaid line refund (which increments both).
    const paymentRefund = order.payments.reduce((s, p) => s + (p.refundedPaise ?? 0), 0);
    const lineRefund = order.items.reduce(
      (s, it) => s + (it.fulfillmentStatus === 'unavailable_refunded' ? it.refundedPaise : 0), 0,
    );
    const refundedPaise = Math.max(paymentRefund, lineRefund);
    const refund = refundedPaise > 0
      ? { amountPaise: refundedPaise, destination: (order.paymentMethod === 'cod' ? 'cash_adjustment' : 'original') as 'original' | 'cash_adjustment' }
      : undefined;

    return { ...order, rider, eta, refund };
  }

  async function getMyOrders(userId: string, role: string, riderProfileId: string) {
    let where: Record<string, unknown> = {};

    if (role === 'customer') {
      where = { customerId: userId };
    } else if (role === 'rider') {
      // Orders store the rider's RiderProfile.id (not User.id), so filter by the
      // caller's profile id — BUG-1 fix (was `riderId: userId`, matched nothing).
      where = { riderId: riderProfileId };
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

  // ── OrderGroup (Phase 5) — one customer-facing view over N child orders ────
  // Ranks the order lifecycle so a group can report the LEAST-advanced child
  // (the group is "preparing" until every child is at least preparing, etc.).
  const GROUP_STATUS_RANK: Record<string, number> = {
    pending_payment: 0, paid: 1, confirmed: 2, preparing: 3, ready_for_pickup: 4,
    picked_up: 5, out_for_delivery: 6, delivered: 7, cancelled: 8,
  };

  // Unified view of an aggregated order: combined money + a single status, with
  // the per-shop children kept (their shop identity stays internal at the UI).
  async function getOrderGroup(groupId: string, userId: string) {
    const orders = await prisma.order.findMany({
      where:   { groupId },
      orderBy: { createdAt: 'asc' },
      include: {
        items: { select: { productId: true, productName: true, quantity: true, unitPrice: true, subtotal: true } },
        shop:  { select: { name: true } },
      },
    });
    if (orders.length === 0) throw new NotFoundError('Order group');
    if (orders.some((o) => o.customerId !== userId)) throw new ForbiddenError('Not your order');

    const live = orders.filter((o) => o.status !== 'cancelled');
    const status = live.length === 0
      ? 'cancelled'
      : [...live].sort((a, b) => GROUP_STATUS_RANK[a.status]! - GROUP_STATUS_RANK[b.status]!)[0]!.status;

    return {
      groupId,
      status,
      subtotal:    orders.reduce((s, o) => s + o.cartSubtotalAtPricing, 0),
      deliveryFee: orders.reduce((s, o) => s + o.deliveryFee, 0),
      discount:    orders.reduce((s, o) => s + o.discount, 0),
      totalAmount: orders.reduce((s, o) => s + o.totalAmount, 0),
      orders: orders.map((o) => ({
        id: o.id, shopName: o.shop.name, status: o.status, totalAmount: o.totalAmount, items: o.items,
      })),
    };
  }

  async function updateOrderStatus(
    orderId: string, newStatus: string,
    changedByRole: string, changedById: string, reason?: string,
    refundedPaise?: number,
  ) {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    // Defect #1: route the status write through the same CAS primitive as every
    // other transition — assertTransition + atomic compare-and-set (WHERE status =
    // current) + history — so a concurrent transition can't be silently clobbered.
    const moved = await prisma.$transaction(async (tx) =>
      transitionOrderStatus(tx, orderId, order.status, newStatus, {
        role: changedByRole, id: changedById, ...(reason != null ? { reason } : {}),
      }),
    );
    if (!moved) throw new BusinessRuleError('Order status changed concurrently');

    // Persist + emit the milestone ETA BEFORE the status event, so ORDER_STATUS_CHANGED
    // consumers read the fresh, persisted ETA (P2 hardening, review #10). Best-effort.
    await computeAndPersistEta(prisma, orderId);

    emitOrderStatusChanged({
      orderId, status: newStatus, shopId: order.shopId, customerId: order.customerId,
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
      include: {
        shop:     { include: { seller: { select: { userId: true } } } },
        payments: { select: { status: true, razorpayPaymentId: true } },
      },
    });
    if (!order) throw new NotFoundError('Order');
    if (order.shop.seller.userId !== sellerUserId) throw new ForbiddenError('Not your order');
    if (!['paid', 'confirmed'].includes(order.status)) {
      throw new BusinessRuleError('Order reject nahi ho sakta');
    }
    // P0-2: cancel FIRST (revoke fulfillability + free the rider), then refund LAST,
    // so a successful refund can never leave a fulfillable order. A seller-rejected
    // prepaid order must be refunded too (Chunk 3.5).
    await updateOrderStatus(
      orderId, 'cancelled', 'seller', sellerUserId, reason,
      expectedRefundPaise(order),
    );
    // Free any assigned rider/batch on a seller rejection too (Phase 1.6).
    if (order.riderId) await releaseOrderAssignment(prisma, orderId, order.batchId);
    await refundCapturedOrderPayment(prisma, orderId, `Seller rejected: ${reason}`);
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
      include: {
        shop:     { include: { seller: { select: { userId: true } } } },
        payments: { select: { status: true, razorpayPaymentId: true } },
      },
    });
    if (!order) throw new NotFoundError('Order');
    if (order.customerId !== userId) throw new ForbiddenError('Not your order');
    if (!['pending_payment', 'paid', 'confirmed'].includes(order.status)) {
      throw new BusinessRuleError('ऑर्डर रद्द नहीं किया जा सकता — यह पहले से आगे बढ़ चुका है');
    }

    // P0-2: REVOKE FULFILLABILITY FIRST. Flip the order to cancelled (then notify the
    // seller and free the rider) BEFORE the external Razorpay refund, so a successful
    // refund can never leave the order in a fulfillable state. The cancelled
    // notification still quotes the exact amount (expectedRefundPaise = what the
    // refund will move). COD / unpaid orders refund nothing.
    await updateOrderStatus(
      orderId, 'cancelled', 'customer', userId, reason,
      expectedRefundPaise(order),
    );

    // Notify the seller in real time (service → event bus → socket plugin)
    emitOrderCancelledForSeller({
      orderId,
      sellerUserId: order.shop.seller.userId,
      reason:       reason ?? '',
    });

    // Free the rider/batch AFTER the cancel emit so the rider still gets the
    // cancellation push, then the order leaves their active list (Phase 1.6).
    if (order.riderId) await releaseOrderAssignment(prisma, orderId, order.batchId);

    // Order is already non-fulfillable; issue the refund LAST (retryable tail — a
    // gateway failure leaves a cancelled order with the refund owed, never a refunded
    // order that can still be fulfilled).
    await refundCapturedOrderPayment(prisma, orderId, reason ?? 'Customer cancelled');

    return { message: 'Order cancel ho gaya' };
  }

  // riderProfileId = the caller's RiderProfile.id (what Order.riderId stores);
  // riderUserId = the caller's User.id (for the status-history actor). BUG-1 fix:
  // previously both were the User.id, so the ownership guard always 403'd and the
  // COD ledger update (keyed by RiderProfile) silently no-op'd.
  async function codCollected(orderId: string, riderProfileId: string, amountPaise: number | undefined, riderUserId: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order');
    if (order.riderId !== riderProfileId) throw new ForbiddenError('Not your delivery');
    if (order.paymentMethod !== 'cod') throw new BusinessRuleError('Yeh COD order nahi hai');

    // BUG-001 (D3): idempotent terminal state — a retried collection succeeds WITHOUT
    // re-crediting. Must precede assertTransition (which no-ops a delivered→delivered call).
    if (order.status === 'delivered') return { message: 'Cash collection confirm ho gaya' };

    // BUG-001 (D1): the recorded cash is server-derived from the order total; the
    // client-supplied amountPaise is advisory only and is never written.
    const amountDue = order.totalAmount;
    if (amountPaise != null && amountPaise !== amountDue) {
      log.warn({ orderId, sentPaise: amountPaise, duePaise: amountDue }, 'COD amount mismatch (ignored)');
    }

    // Single enforcement point (transitionOrderStatus): assertTransition + atomic
    // compare-and-set + history. Only the call that actually flips out_for_delivery →
    // delivered credits the balance (race-safe; rejects illegal source states — D2).
    const credited = await prisma.$transaction(async (tx) => {
      const flipped = await transitionOrderStatus(
        tx, orderId, order.status, 'delivered',
        { role: 'rider', id: riderUserId }, { codCollectedPaise: amountDue },
      );
      if (!flipped) return false;
      await tx.riderProfile.update({
        where: { id: riderProfileId },
        data:  { codBalancePaise: { increment: amountDue } },
      });
      return true;
    });

    if (credited) {
      emitOrderStatusChanged({
        orderId, status: 'delivered',
        shopId: order.shopId, customerId: order.customerId,
      });
    }
    return { message: 'Cash collection confirm ho gaya' };
  }

  // Rider marks a non-COD (prepaid) order delivered. Mirrors codCollected — same
  // status + deliveredAt + history + ORDER_STATUS_CHANGED — but there is no cash
  // to record, so it never touches codCollectedPaise / the rider's COD balance.
  // COD orders MUST go through codCollected (which records the cash), so they are
  // rejected here; this is the symmetric counterpart of codCollected's non-COD guard.
  // riderProfileId = caller's RiderProfile.id (matches Order.riderId); riderUserId =
  // caller's User.id (status-history actor). BUG-1 fix — see codCollected.
  async function markDelivered(orderId: string, riderProfileId: string, riderUserId: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order');
    if (order.riderId !== riderProfileId) throw new ForbiddenError('Not your delivery');
    if (order.paymentMethod === 'cod') throw new BusinessRuleError('COD order: cash collection confirm karein');

    // Idempotent terminal state — a retried delivery succeeds without re-stamping (V5).
    if (order.status === 'delivered') return { message: 'Order delivered confirm ho gaya' };

    // Single enforcement point: assertTransition + atomic compare-and-set + history.
    // Rejects an illegal source state (e.g. picked_up → delivered) and never reverts.
    const delivered = await prisma.$transaction(async (tx) =>
      transitionOrderStatus(tx, orderId, order.status, 'delivered', { role: 'rider', id: riderUserId }),
    );

    if (delivered) {
      emitOrderStatusChanged({
        orderId, status: 'delivered',
        shopId: order.shopId, customerId: order.customerId,
      });
    }
    return { message: 'Order delivered confirm ho gaya' };
  }

  // ── Stale-stock safety net (Phase 5) ──────────────────────────────────────
  // The rider reaches the shop and an item isn't there. We (a) flip that shop's
  // Product to out_of_stock so it leaves the feed, (b) refund just that line
  // (prepaid) or deduct it from the cash due (COD) — cancelling the whole child
  // order when it was the only line, (c) suggest a substitute (another in-stock
  // shop carrying the same master) and push a live update to the customer.
  async function riderReportItemUnavailable(userId: string, orderId: string, orderItemId: string) {
    const rider = await prisma.riderProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!rider) throw new NotFoundError('Rider profile');
    const assignment = await prisma.deliveryAssignment.findFirst({
      where: { orderId, riderId: rider.id, isActive: true },
    });
    if (!assignment) throw new ForbiddenError('Not your delivery');

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, payments: { select: { status: true, razorpayPaymentId: true } } },
    });
    if (!order) throw new NotFoundError('Order');
    if (!['confirmed', 'preparing', 'ready_for_pickup'].includes(order.status)) {
      throw new BusinessRuleError('Item ab report nahi kar sakte — order aage badh chuka hai');
    }
    const line = order.items.find((i) => i.id === orderItemId);
    if (!line) throw new NotFoundError('Order item');
    // Atomic claim: flip this line fulfilled→unavailable_refunded exactly once. A
    // concurrent double-report (rider double-tap / retry) loses the compare-and-set
    // (count 0) and aborts here, so the line is refunded at most once.
    const lineClaim = await prisma.orderItem.updateMany({
      where: { id: orderItemId, fulfillmentStatus: 'fulfilled' },
      data:  { fulfillmentStatus: 'unavailable_refunded', refundedPaise: line.subtotal },
    });
    if (lineClaim.count === 0) {
      throw new BusinessRuleError('Yeh item pehle hi report ho chuka hai');
    }

    // (a) flip the shop's product out of stock + bust the feed/shop caches.
    await prisma.product.update({ where: { id: line.productId }, data: { stockStatus: 'out_of_stock' } });
    await createCatalogService(prisma, redis).invalidateShopCache(order.shopId);

    // (c) substitute: cheapest OTHER in-stock shop carrying the same master.
    let suggestion: { productId: string; name: string; pricePaise: number } | undefined;
    const prod = await prisma.product.findUnique({ where: { id: line.productId }, select: { masterId: true } });
    if (prod?.masterId) {
      const alt = await prisma.product.findFirst({
        where: {
          masterId: prod.masterId, isActive: true, stockStatus: 'available',
          shop: { isActive: true, isOpen: true }, id: { not: line.productId },
        },
        orderBy: { price: 'asc' },
        select: { id: true, name: true, price: true },
      });
      if (alt) suggestion = { productId: alt.id, name: alt.name, pricePaise: alt.price };
    }

    // (b) refund / cancel.
    if (order.items.length === 1) {
      // Only line → cancel the whole child order (full refund + free the rider).
      // P0-2: cancel FIRST (revoke fulfillability), then refund LAST — a successful
      // refund must never leave a fulfillable order.
      await updateOrderStatus(orderId, 'cancelled', 'rider', userId, `Item unavailable: ${line.productName}`, expectedRefundPaise(order));
      await prisma.orderItem.update({
        where: { id: line.id }, data: { fulfillmentStatus: 'unavailable_refunded', refundedPaise: line.subtotal },
      });
      if (order.riderId) await releaseOrderAssignment(prisma, orderId, order.batchId);
      const refundedPaise = await refundCapturedOrderPayment(prisma, orderId, `Item unavailable: ${line.productName}`);
      emitOrderItemUnavailable({
        customerId: order.customerId, orderId, productName: line.productName,
        refundedPaise: refundedPaise ?? line.subtotal, cancelled: true, ...(suggestion ? { suggestion } : {}),
      });
      return { cancelled: true, refundedPaise: refundedPaise ?? line.subtotal, suggestion: suggestion ?? null };
    }

    // Multi-line → refund just this line; the rest of the order proceeds. Prepaid
    // hits Razorpay; COD reduces the order total so the rider collects less cash.
    const refundedPaise = order.paymentMethod === 'cod'
      ? null
      : await refundOrderLine(prisma, orderId, line.subtotal, `Item unavailable: ${line.productName}`);
    await prisma.$transaction([
      prisma.orderItem.update({
        where: { id: line.id }, data: { fulfillmentStatus: 'unavailable_refunded', refundedPaise: line.subtotal },
      }),
      prisma.order.update({
        where: { id: orderId },
        data:  { cartSubtotalAtPricing: { decrement: line.subtotal }, totalAmount: { decrement: line.subtotal } },
      }),
    ]);
    emitOrderItemUnavailable({
      customerId: order.customerId, orderId, productName: line.productName,
      refundedPaise: refundedPaise ?? line.subtotal, cancelled: false, ...(suggestion ? { suggestion } : {}),
    });
    return { cancelled: false, refundedPaise: refundedPaise ?? line.subtotal, suggestion: suggestion ?? null };
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
    placeOrder, getOrder, getMyOrders, getOrderGroup, updateOrderStatus,
    sellerAcceptOrder, sellerRejectOrder, sellerMarkPreparing, sellerMarkReady,
    cancelOrder, codCollected, markDelivered, rateOrder, autoAcceptOrder,
    updateDeliveryAddress, updateReceiver, riderReportItemUnavailable,
  };
}

// Referral unlock scaffolding removed (P2-8 / Phase 3 7/7): v1 launches with
// growth loops HIDDEN (customer-app FEATURES.growthLoops=false — rewards are
// not funded). The old enqueueReferralUnlock was a stub that logged "Unlock
// queued" while queueing nothing, and no delivered-path ever called it.
// Signup still generates codes and records redemptions (data continuity), so
// rewards can be honored retroactively when the feature is funded — rebuild
// the unlock worker from git history (worker/jobs/referral.job.ts) and wire
// it on the 'delivered' transition, atomically and idempotently per side.
