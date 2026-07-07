import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { pricingPreviewSchema, type PricingPreviewInput } from './pricing.schema';
import { calculateDeliveryFee, getActiveFeeRuleVersion } from './pricing.service';
import { previewPromo } from '../promotions/promotions.service';
import { ValidationError, NotFoundError, ForbiddenError } from '../../shared/errors/app-errors';

export default async function pricingRoutes(app: FastifyInstance): Promise<void> {

  // POST /api/v1/pricing/preview
  // Called when customer selects/changes address at checkout
  // Route generics (<{ Body }>) instead of an annotated request param — an
  // annotated handler alongside an inline options object pins the route generic
  // and fails the exactOptionalPropertyTypes baseline (Fastify v4 TS docs).
  app.post<{ Body: PricingPreviewInput }>(
    '/preview',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const parsed = pricingPreviewSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const { cartId, addressId } = parsed.data;

      // Load cart from Redis
      const cartRaw = await app.redis.get(`cart:${request.auth!.userId}`);
      if (!cartRaw) throw new ValidationError('Cart khaali hai');

      const cart = JSON.parse(cartRaw) as {
        cartId: string; shopId?: string; subtotal: number;
        items: Array<{ shopId?: string; subtotal: number }>;
      };

      if (cart.items.length === 0) throw new ValidationError('Cart khaali hai');

      const address = await app.prisma.address.findUnique({
        where:  { id: addressId },
        select: { userId: true, isDeleted: true },
      });
      if (!address || address.isDeleted) throw new NotFoundError('Address');
      if (address.userId !== request.auth!.userId) throw new ForbiddenError('Not your address');

      // Flat pricing (Chirawa): one fee for the whole cart — no distance.
      // ₹25 if cart < ₹100, else ₹15 if any shop is Chirawa Special, else ₹10.
      // `?? cart.shopId` keeps legacy single-shop carts (no per-item shopId) working.
      const shopIds = [...new Set(cart.items.map((i) => i.shopId ?? cart.shopId).filter(Boolean))] as string[];
      if (shopIds.length === 0) throw new NotFoundError('Shop');
      const ruleVersion = await getActiveFeeRuleVersion(app.prisma);

      const specialCount = await app.prisma.shop.count({
        where: { id: { in: shopIds }, isFeatured: true },
      });
      const hasSpecialShop = specialCount > 0;

      const fee = calculateDeliveryFee({
        cartSubtotalPaise: cart.subtotal,
        hasSpecialShop,
        ruleVersion,
      });

      // Promo preview — mirrors order creation exactly (A3 parity fix): creation
      // applies the promo at the whole-cart subtotal for ANY shop count, so the
      // old single-shop gate here made multi-shop bills disagree with the charge.
      // A typed code soft-fails (promoError) so the bill still renders; otherwise
      // first-time customers see FIRSTORDER (free delivery) auto-applied.
      const promo = await previewPromo(app.prisma, {
        ...(parsed.data.promoCode ? { promoCode: parsed.data.promoCode } : {}),
        userId:            request.auth!.userId,
        cartSubtotalPaise: cart.subtotal,
        deliveryFeePaise:  fee.feePaise,
      });
      const { discount, appliedPromoCode, promoError } = promo;

      return reply.send({
        deliveryFee:    fee.feePaise,
        distanceKm:     0,
        feeRuleVersion: ruleVersion,
        cartSubtotal:   cart.subtotal,
        discount,
        appliedPromoCode,
        promoError,
        total:          cart.subtotal + fee.feePaise - discount,
        breakdownText:  shopIds.length > 1
          ? `${shopIds.length} dukaanon ka saman — ek hi delivery fee`
          : fee.breakdownHindi,
        distanceSource: 'flat',
        shopCount:      shopIds.length,
        hasSpecialShop,
      });
    },
  );
}
