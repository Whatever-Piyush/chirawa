import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { pricingPreviewSchema, type PricingPreviewInput } from './pricing.schema';
import { calculateDeliveryFee, getActiveFeeRuleVersion } from './pricing.service';
import { getRoadDistance } from './distance.service';
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
        select: { userId: true, lat: true, lng: true, isDeleted: true },
      });
      if (!address || address.isDeleted) throw new NotFoundError('Address');
      if (address.userId !== request.auth!.userId) throw new ForbiddenError('Not your address');

      // Multi-shop: price each shop's delivery separately, then charge a SINGLE
      // combined fee = the farthest shop's fee (per product decision).
      // `?? cart.shopId` keeps legacy single-shop carts (no per-item shopId) working.
      const shopIds = [...new Set(cart.items.map((i) => i.shopId ?? cart.shopId).filter(Boolean))] as string[];
      if (shopIds.length === 0) throw new NotFoundError('Shop');
      const ruleVersion = await getActiveFeeRuleVersion(app.prisma);

      let combinedFee = 0;
      let farthestKm  = 0;
      let source      = 'google_maps';
      let breakdown   = '';

      for (const shopId of shopIds) {
        const shop = await app.prisma.shop.findUnique({
          where: { id: shopId }, select: { lat: true, lng: true },
        });
        if (!shop) continue;
        const shopSubtotal = cart.items
          .filter((i) => (i.shopId ?? cart.shopId) === shopId)
          .reduce((s, i) => s + i.subtotal, 0);
        const dist = await getRoadDistance(
          Number(shop.lat), Number(shop.lng),
          Number(address.lat), Number(address.lng),
          app.redis,
        );
        const fee = calculateDeliveryFee({
          cartSubtotalPaise: shopSubtotal,
          distanceMetres:    dist.metres,
          ruleVersion,
        });
        if (fee.feePaise > combinedFee) {
          combinedFee = fee.feePaise;
          farthestKm  = fee.distanceKm;
          source      = dist.source;
          breakdown   = fee.breakdownHindi;
        }
      }

      return reply.send({
        deliveryFee:    combinedFee,
        distanceKm:     farthestKm,
        feeRuleVersion: ruleVersion,
        cartSubtotal:   cart.subtotal,
        total:          cart.subtotal + combinedFee,
        breakdownText:  shopIds.length > 1
          ? `${shopIds.length} dukaanon ka saman — ek hi delivery fee`
          : breakdown,
        distanceSource: source,
        shopCount:      shopIds.length,
      });
    },
  );
}
