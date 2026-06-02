import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { pricingPreviewSchema, type PricingPreviewInput } from './pricing.schema';
import { calculateDeliveryFee, getActiveFeeRuleVersion } from './pricing.service';
import { validatePromo, resolveAutoPromo } from '../promotions/promotions.service';
import { ValidationError, NotFoundError, ForbiddenError } from '../../shared/errors/app-errors';

export default async function pricingRoutes(app: FastifyInstance): Promise<void> {

  // POST /api/v1/pricing/preview
  // Called when customer selects/changes address at checkout
  app.post(
    '/preview',
    { preHandler: [authenticate] },
    async (request: FastifyRequest<{ Body: PricingPreviewInput }>, reply) => {
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

      // Promo preview — single-shop only (mirrors order creation). A typed code
      // soft-fails (promoError) so the bill still renders; otherwise first-time
      // customers see FIRSTORDER (free delivery) auto-applied.
      let discount        = 0;
      let appliedPromoCode: string | null = null;
      let promoError:       string | null = null;
      if (shopIds.length === 1) {
        const promoCtx = {
          userId:            request.auth!.userId,
          cartSubtotalPaise: cart.subtotal,
          deliveryFeePaise:  fee.feePaise,
        };
        if (parsed.data.promoCode) {
          try {
            const v = await validatePromo(app.prisma, { code: parsed.data.promoCode, ...promoCtx });
            discount = v.discountPaise;
            appliedPromoCode = v.code;
          } catch (e) {
            promoError = e instanceof Error ? e.message : 'Promo code valid nahi hai';
          }
        } else {
          const auto = await resolveAutoPromo(app.prisma, promoCtx);
          if (auto) { discount = auto.discountPaise; appliedPromoCode = auto.code; }
        }
      }

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
