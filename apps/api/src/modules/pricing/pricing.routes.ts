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
        cartId: string; shopId: string; subtotal: number; items: unknown[];
      };

      if (cart.items.length === 0) throw new ValidationError('Cart khaali hai');

      // Load address + shop (need lat/lng for both)
      const [address, shop] = await Promise.all([
        app.prisma.address.findUnique({
          where:  { id: addressId },
          select: { userId: true, lat: true, lng: true, isDeleted: true },
        }),
        app.prisma.shop.findUnique({
          where:  { id: cart.shopId },
          select: { lat: true, lng: true },
        }),
      ]);

      if (!address || address.isDeleted) throw new NotFoundError('Address');
      if (address.userId !== request.auth!.userId) throw new ForbiddenError('Not your address');
      if (!shop) throw new NotFoundError('Shop');

      // Calculate road distance
      const { metres, source } = await getRoadDistance(
        Number(shop.lat), Number(shop.lng),
        Number(address.lat), Number(address.lng),
        app.redis,
      );

      // Get active fee rule version
      const ruleVersion = await getActiveFeeRuleVersion(app.prisma);

      // Calculate fee — pure function, no I/O
      const result = calculateDeliveryFee({
        cartSubtotalPaise: cart.subtotal,
        distanceMetres:    metres,
        ruleVersion,
      });

      return reply.send({
        deliveryFee:       result.feePaise,
        distanceKm:        result.distanceKm,
        feeRuleVersion:    result.ruleVersion,
        cartSubtotal:      cart.subtotal,
        total:             cart.subtotal + result.feePaise,
        breakdownText:     result.breakdownHindi,
        distanceSource:    source,
      });
    },
  );
}
