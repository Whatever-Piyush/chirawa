import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate, requireRole } from '../../shared/middleware/auth.middleware';
import { perUserRateLimit } from '../../shared/middleware/rate-limit';
import { runIdempotent, readIdempotencyKey } from '../../shared/utils/idempotency';
import { ValidationError } from '../../shared/errors/app-errors';
import { computeIsOpen } from '../catalog/catalog.service';
import { loadFoodConfig } from './food-config';
import { applyMarkup, computeFoodBill } from './food-pricing';
import { createFoodCartService } from './food-cart.service';
import { createFoodOrdersService } from './food-orders.service';
import {
  addFoodCartItemSchema, updateFoodCartItemSchema,
  placeFoodOrderSchema, verifyFoodPaymentSchema,
  cancelFoodOrderSchema, rejectFoodOrderSchema,
  foodOrdersListQuerySchema, restaurantOrdersQuerySchema,
  setRestaurantOpenSchema, setItemAvailabilitySchema,
  type AddFoodCartItemInput, type UpdateFoodCartItemInput,
  type PlaceFoodOrderInput, type VerifyFoodPaymentInput,
  type CancelFoodOrderInput, type RejectFoodOrderInput,
  type SetRestaurantOpenInput, type SetItemAvailabilityInput,
} from './food.schema';

// ─── /api/v1/food/* — the Food module's ONLY HTTP surface (Food.md §7) ────────
// Everything food lives under this prefix; no existing route gains a food
// branch, query param, or filter. Registered as one additional line in app.ts.

export default async function foodRoutes(app: FastifyInstance): Promise<void> {
  const cartService   = createFoodCartService(app.prisma);
  const ordersService = createFoodOrdersService(app.prisma, app.redis);

  // Pre-declared guard consts — an inline { preHandler } object on a generically
  // typed route trips the repo's exactOptionalPropertyTypes baseline (same
  // pattern as orders.routes customerGuard).
  const customerGuard = { preHandler: [authenticate, requireRole('customer')] };
  const sellerGuard   = { preHandler: [authenticate, requireRole('seller')] };
  const riderGuard    = { preHandler: [authenticate, requireRole('rider')] };
  const authGuard     = { preHandler: [authenticate] };

  // ════ Public catalog ══════════════════════════════════════════════════════

  // GET /api/v1/food/restaurants — curated rail, manual displayOrder (Food.md §11.5).
  app.get('/restaurants', async (_request, reply) => {
    const [restaurants, cfg] = await Promise.all([
      app.prisma.restaurant.findMany({
        where:   { isActive: true },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true, name: true, description: true, cuisine: true,
          logoUrl: true, coverImageUrl: true,
          isOpen: true, openTime: true, closeTime: true,
          prepTimeMinutes: true, displayOrder: true,
          ratingAverage: true, ratingCount: true,
          _count: { select: { menuItems: { where: { isAvailable: true } } } },
        },
      }),
      loadFoodConfig(app.prisma),
    ]);

    return reply.send({
      restaurants: restaurants.map((r) => ({
        id: r.id, name: r.name, description: r.description, cuisine: r.cuisine,
        logoUrl: r.logoUrl, coverImageUrl: r.coverImageUrl,
        isCurrentlyOpen: computeIsOpen(r),
        openTime: r.openTime, closeTime: r.closeTime,
        prepTimeMinutes: r.prepTimeMinutes,
        rating: { average: r.ratingAverage ? Number(r.ratingAverage) : null, count: r.ratingCount },
        // Empty menus render as "menu coming soon" on the client (Food.md App. A).
        menuAvailable: r._count.menuItems > 0,
      })),
      eta: cfg.eta, // "30–50 mins" band — config-driven, not client-hardcoded
    });
  });

  // GET /api/v1/food/restaurants/:id — detail + menu (categories → items).
  app.get<{ Params: { id: string } }>('/restaurants/:id', async (request, reply) => {
    const [restaurant, cfg] = await Promise.all([
      app.prisma.restaurant.findUnique({
        where: { id: request.params.id },
        include: {
          menuCategories: {
            where:   { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select:  { id: true, name: true, sortOrder: true },
          },
          menuItems: {
            where:   { isAvailable: true },
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true, name: true, description: true, pricePaise: true,
              imageUrl: true, isVeg: true, menuCategoryId: true,
            },
          },
        },
      }),
      loadFoodConfig(app.prisma),
    ]);
    if (!restaurant || !restaurant.isActive) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Restaurant not found' } });
    }

    const priced = restaurant.menuItems.map((m) => ({
      id: m.id, name: m.name, description: m.description,
      imageUrl: m.imageUrl, isVeg: m.isVeg,
      pricePaise: applyMarkup(m.pricePaise, cfg, {
        restaurantId: restaurant.id, menuCategoryId: m.menuCategoryId,
      }),
      menuCategoryId: m.menuCategoryId,
    }));

    // Group items under their categories; uncategorized items land in a final
    // "Menu" pseudo-section so nothing curated ever disappears.
    const sections = restaurant.menuCategories
      .map((c) => ({ id: c.id, name: c.name, items: priced.filter((m) => m.menuCategoryId === c.id) }))
      .filter((c) => c.items.length > 0);
    const uncategorized = priced.filter((m) => !m.menuCategoryId);
    if (uncategorized.length > 0) sections.push({ id: 'uncategorized', name: 'Menu', items: uncategorized });

    return reply.send({
      id: restaurant.id, name: restaurant.name,
      description: restaurant.description, cuisine: restaurant.cuisine,
      logoUrl: restaurant.logoUrl, coverImageUrl: restaurant.coverImageUrl,
      address: restaurant.address,
      isCurrentlyOpen: computeIsOpen(restaurant),
      openTime: restaurant.openTime, closeTime: restaurant.closeTime,
      prepTimeMinutes: restaurant.prepTimeMinutes,
      rating: { average: restaurant.ratingAverage ? Number(restaurant.ratingAverage) : null, count: restaurant.ratingCount },
      menuSections: sections,
      menuAvailable: priced.length > 0,
      eta: cfg.eta,
    });
  });

  // ════ Customer: food cart (policy-enforced — Food.md §4) ═══════════════════

  app.get('/cart', customerGuard, async (request, reply) => {
    return reply.send(await cartService.getCart(request.auth!.userId));
  });

  app.post('/cart/items', customerGuard, async (request: FastifyRequest<{ Body: AddFoodCartItemInput }>, reply) => {
    const parsed = addFoodCartItemSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    return reply.send(await cartService.addItem(request.auth!.userId, parsed.data));
  });

  app.put('/cart/items/:menuItemId', customerGuard, async (
    request: FastifyRequest<{ Params: { menuItemId: string }; Body: UpdateFoodCartItemInput }>,
    reply,
  ) => {
    const parsed = updateFoodCartItemSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    return reply.send(
      await cartService.setItemQuantity(request.auth!.userId, request.params.menuItemId, parsed.data.quantity),
    );
  });

  // [Start New Order] (Food.md §4.5) — explicit, labelled clear. Never automatic.
  app.delete('/cart', customerGuard, async (request, reply) => {
    await cartService.clearCart(request.auth!.userId);
    return reply.status(204).send();
  });

  // ════ Customer: checkout preview + orders ═══════════════════════════════════

  // GET /api/v1/food/checkout/preview — the food bill (flat fee from config).
  app.get('/checkout/preview', customerGuard, async (request, reply) => {
    const cart = await cartService.getCart(request.auth!.userId);
    if (!cart.restaurantId || cart.items.length === 0) {
      throw new ValidationError('Food cart khaali hai');
    }
    const cfg  = await loadFoodConfig(app.prisma);
    const bill = computeFoodBill(
      cart.items.map((i) => ({ unitPricePaise: i.unitPricePaise, quantity: i.quantity })),
      cfg,
    );
    const restaurant = await app.prisma.restaurant.findUnique({
      where:  { id: cart.restaurantId },
      select: { id: true, name: true, isOpen: true, openTime: true, closeTime: true, isActive: true },
    });
    return reply.send({
      ...bill,
      eta: cfg.eta,
      payment: cfg.payment, // { onlineOnly: true, allowedMethods: ['upi'] }
      restaurant: restaurant && {
        id: restaurant.id, name: restaurant.name,
        isCurrentlyOpen: restaurant.isActive && computeIsOpen(restaurant),
      },
    });
  });

  // POST /api/v1/food/orders — UPI-only; same per-user cap + idempotency
  // discipline as marketplace checkout.
  app.post('/orders', {
    ...customerGuard, ...perUserRateLimit(20, '1 minute'),
  }, async (request: FastifyRequest<{ Body: PlaceFoodOrderInput }>, reply) => {
    const parsed = placeFoodOrderSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');

    const createOrder = async (): Promise<{ status: number; body: unknown }> => {
      const result = await ordersService.placeOrder(request.auth!.userId, parsed.data);
      return { status: 201, body: result };
    };

    // Idempotency key derives from the CART id (marketplace parity): stable
    // across a double-tap, unique per cart — a later, different cart to the
    // same address can never collide with a cached earlier response.
    const cartRow = await app.prisma.foodCart.findUnique({
      where: { userId: request.auth!.userId }, select: { id: true },
    });
    const idemKey = readIdempotencyKey(request.headers['idempotency-key'])
      ?? `auto:foodcart:${cartRow?.id ?? 'empty'}`;
    const result = await runIdempotent(app.redis, `foodorder:${request.auth!.userId}`, idemKey, createOrder);
    return reply.status(result.status).send(result.body);
  });

  app.post('/orders/:id/verify-payment', customerGuard, async (
    request: FastifyRequest<{ Params: { id: string }; Body: VerifyFoodPaymentInput }>,
    reply,
  ) => {
    const parsed = verifyFoodPaymentSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    return reply.send(await ordersService.verifyPayment(request.auth!.userId, request.params.id, parsed.data));
  });

  app.get('/orders', customerGuard, async (
    request: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>,
    reply,
  ) => {
    const parsed = foodOrdersListQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new ValidationError('Invalid pagination');
    return reply.send(await ordersService.getMyOrders(request.auth!.userId, parsed.data));
  });

  // Detail is shared by customer / restaurant / rider / admin — service checks access.
  app.get('/orders/:id', authGuard, async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply,
  ) => {
    return reply.send(await ordersService.getOrder(request.params.id, request.auth!));
  });

  app.delete('/orders/:id', customerGuard, async (
    request: FastifyRequest<{ Params: { id: string }; Body: CancelFoodOrderInput | undefined }>,
    reply,
  ) => {
    const parsed = cancelFoodOrderSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    return reply.send(
      await ordersService.cancelByCustomer(request.auth!.userId, request.params.id, parsed.data.reason),
    );
  });

  // ════ Restaurant Mode — inside the existing Seller App (Food.md §11.2) ═════

  // GET /api/v1/food/restaurant/me — null when this seller runs no restaurant;
  // the seller app uses that to show/hide the Restaurant tab.
  app.get('/restaurant/me', sellerGuard, async (request, reply) => {
    const restaurant = await ordersService.getMyRestaurant(request.auth!.userId);
    return reply.send({ restaurant });
  });

  app.get('/restaurant/orders', sellerGuard, async (
    request: FastifyRequest<{ Querystring: { scope?: string; page?: string; limit?: string } }>,
    reply,
  ) => {
    const parsed = restaurantOrdersQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new ValidationError('Invalid query');
    return reply.send(await ordersService.listRestaurantOrders(request.auth!.userId, parsed.data));
  });

  app.post('/restaurant/orders/:id/accept', sellerGuard, async (
    request: FastifyRequest<{ Params: { id: string } }>, reply,
  ) => reply.send(await ordersService.acceptOrder(request.auth!.userId, request.params.id)));

  app.post('/restaurant/orders/:id/reject', sellerGuard, async (
    request: FastifyRequest<{ Params: { id: string }; Body: RejectFoodOrderInput | undefined }>,
    reply,
  ) => {
    const parsed = rejectFoodOrderSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    return reply.send(await ordersService.rejectOrder(request.auth!.userId, request.params.id, parsed.data.reason));
  });

  app.post('/restaurant/orders/:id/preparing', sellerGuard, async (
    request: FastifyRequest<{ Params: { id: string } }>, reply,
  ) => reply.send(await ordersService.markPreparing(request.auth!.userId, request.params.id)));

  app.post('/restaurant/orders/:id/ready', sellerGuard, async (
    request: FastifyRequest<{ Params: { id: string } }>, reply,
  ) => reply.send(await ordersService.markReady(request.auth!.userId, request.params.id)));

  // ── Restaurant self-serve (launch hardening P1) ─────────────────────────────

  // PATCH /api/v1/food/restaurant/open — restaurant opens/closes itself.
  app.patch('/restaurant/open', sellerGuard, async (
    request: FastifyRequest<{ Body: SetRestaurantOpenInput }>, reply,
  ) => {
    const parsed = setRestaurantOpenSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    return reply.send(await ordersService.setRestaurantOpen(request.auth!.userId, parsed.data.isOpen));
  });

  // GET /api/v1/food/restaurant/menu — management view (includes sold-out items).
  app.get('/restaurant/menu', sellerGuard, async (request, reply) => {
    return reply.send(await ordersService.getRestaurantMenu(request.auth!.userId));
  });

  // PATCH /api/v1/food/restaurant/menu/:itemId — mark an item sold-out / back.
  app.patch('/restaurant/menu/:itemId', sellerGuard, async (
    request: FastifyRequest<{ Params: { itemId: string }; Body: SetItemAvailabilityInput }>, reply,
  ) => {
    const parsed = setItemAvailabilitySchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    return reply.send(
      await ordersService.setMenuItemAvailability(request.auth!.userId, request.params.itemId, parsed.data.isAvailable),
    );
  });

  // ── Admin: refunds needing attention (P0-4 visibility) ──────────────────────
  const adminGuard = { preHandler: [authenticate, requireRole('admin')] };
  app.get('/admin/refunds', adminGuard, async (_request, reply) => {
    return reply.send({ refunds: await ordersService.listRefundsNeedingAttention() });
  });

  // ════ Rider food pickups (Food.md §12 Phase 6) ══════════════════════════════

  app.get('/rider/pickups', riderGuard, async (request, reply) => {
    return reply.send(await ordersService.listRiderPickups(request.auth!.profileId));
  });

  app.post('/rider/orders/:id/claim', riderGuard, async (
    request: FastifyRequest<{ Params: { id: string } }>, reply,
  ) => reply.send(await ordersService.claimPickup(request.auth!.profileId, request.params.id)));

  app.post('/rider/orders/:id/picked-up', riderGuard, async (
    request: FastifyRequest<{ Params: { id: string } }>, reply,
  ) => reply.send(await ordersService.markPickedUp(request.auth!.profileId, request.params.id)));

  app.post('/rider/orders/:id/out-for-delivery', riderGuard, async (
    request: FastifyRequest<{ Params: { id: string } }>, reply,
  ) => reply.send(await ordersService.markOutForDelivery(request.auth!.profileId, request.params.id)));

  app.post('/rider/orders/:id/delivered', riderGuard, async (
    request: FastifyRequest<{ Params: { id: string } }>, reply,
  ) => reply.send(await ordersService.markDelivered(request.auth!.profileId, request.params.id)));
}
