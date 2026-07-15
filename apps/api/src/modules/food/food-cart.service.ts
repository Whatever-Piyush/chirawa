import { Prisma, type PrismaClient } from '@prisma/client';
import {
  AppError, NotFoundError, BusinessRuleError,
} from '../../shared/errors/app-errors';
import { loadFoodConfig } from './food-config';
import { applyMarkup } from './food-pricing';
import {
  evaluateFoodCartAddition, FOOD_CART_DIFFERENT_RESTAURANT,
} from './food-cart-policy';
import type { AddFoodCartItemInput } from './food.schema';

// ─── Food cart service (Food.md §4) ───────────────────────────────────────────
// DB-backed only (deliberately simpler than the marketplace's Redis+DB cart):
// the FoodCart row is the single source of truth the one-restaurant policy is
// enforced against. The marketplace cart service is never called or touched.

/** 409 carrying the typed reason the client's conflict bottom-sheet keys on. */
export class FoodCartConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, message, FOOD_CART_DIFFERENT_RESTAURANT, details);
    this.name = 'FoodCartConflictError';
  }
}

export interface FoodCartItemView {
  menuItemId:     string;
  name:           string;
  imageUrl:       string | null;
  isVeg:          boolean | null;
  unitPricePaise: number; // current sell price (markup applied)
  quantity:       number;
  subtotalPaise:  number;
  isAvailable:    boolean;
}

export interface FoodCartView {
  cartId:             string;      // '' when empty
  restaurantId:       string | null;
  restaurantName:     string | null;
  items:              FoodCartItemView[];
  itemsSubtotalPaise: number;
  count:              number;      // total quantity across lines
}

const EMPTY_CART: FoodCartView = {
  cartId: '', restaurantId: null, restaurantName: null,
  items: [], itemsSubtotalPaise: 0, count: 0,
};

// A cart write racing order placement (which consumes/deletes the cart) hits
// Prisma P2025 (row vanished) or P2003 (FK to the vanished cart) — that's a
// stale-cart situation, not a server fault. Map it to a clean 4xx instead of a
// raw 500 (RC1 P2: correctness of error semantics + Sentry noise).
function isStaleCartRace(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError
    && (err.code === 'P2025' || err.code === 'P2003');
}

export function createFoodCartService(prisma: PrismaClient) {

  // ── Read the cart, re-pricing every line at the CURRENT menu price (with
  // markup) — mirrors the marketplace's "price refresh on read" behaviour so a
  // stale unitPriceAtAdd can never undercharge at checkout. ──────────────────
  async function getCart(userId: string): Promise<FoodCartView> {
    const cart = await prisma.foodCart.findUnique({
      where: { userId },
      include: {
        restaurant: { select: { id: true, name: true } },
        items: {
          orderBy: { createdAt: 'asc' },
          include: {
            menuItem: {
              select: {
                id: true, name: true, imageUrl: true, isVeg: true,
                pricePaise: true, isAvailable: true,
                restaurantId: true, menuCategoryId: true,
              },
            },
          },
        },
      },
    });
    if (!cart || cart.items.length === 0) return EMPTY_CART;

    const cfg = await loadFoodConfig(prisma);
    const items: FoodCartItemView[] = cart.items.map((line) => {
      const unitPricePaise = applyMarkup(line.menuItem.pricePaise, cfg, {
        restaurantId:   line.menuItem.restaurantId,
        menuCategoryId: line.menuItem.menuCategoryId,
      });
      return {
        menuItemId:     line.menuItemId,
        name:           line.menuItem.name,
        imageUrl:       line.menuItem.imageUrl,
        isVeg:          line.menuItem.isVeg,
        unitPricePaise,
        quantity:       line.quantity,
        subtotalPaise:  unitPricePaise * line.quantity,
        isAvailable:    line.menuItem.isAvailable,
      };
    });

    return {
      cartId:             cart.id,
      restaurantId:       cart.restaurantId,
      restaurantName:     cart.restaurant?.name ?? null,
      items,
      itemsSubtotalPaise: items.reduce((s, i) => s + i.subtotalPaise, 0),
      count:              items.reduce((s, i) => s + i.quantity, 0),
    };
  }

  // ── Add an item — THE policy enforcement point (Food.md §4.4). ─────────────
  async function addItem(userId: string, input: AddFoodCartItemInput): Promise<FoodCartView> {
    const menuItem = await prisma.menuItem.findUnique({
      where:   { id: input.menuItemId },
      include: { restaurant: { select: { id: true, name: true, isActive: true } } },
    });
    if (!menuItem) throw new NotFoundError('Menu item');
    if (!menuItem.restaurant.isActive) throw new BusinessRuleError('Yeh restaurant abhi available nahi hai');
    if (!menuItem.isAvailable) throw new BusinessRuleError(`${menuItem.name} abhi available nahi hai`);

    const cfg = await loadFoodConfig(prisma);
    const unitPriceAtAdd = applyMarkup(menuItem.pricePaise, cfg, {
      restaurantId:   menuItem.restaurantId,
      menuCategoryId: menuItem.menuCategoryId,
    });

    try {
    await prisma.$transaction(async (tx) => {
      // Upsert-then-check inside one tx: the unique userId row serializes
      // concurrent adds, so two different-restaurant adds can never both stamp
      // the cart — the loser sees the winner's binding and the policy denies it.
      const cart = await tx.foodCart.upsert({
        where:  { userId },
        create: { userId, restaurantId: menuItem.restaurantId },
        update: {},
      });

      const bound = cart.restaurantId ? [cart.restaurantId] : [];
      const verdict = evaluateFoodCartAddition(
        { restaurantIds: bound },
        menuItem.restaurantId,
        cfg.cartPolicy,
      );
      if (!verdict.ok) {
        // The client's premium bottom-sheet (Food.md §4.5) keys on this code;
        // details carry both restaurants for analytics/debugging.
        const current = cart.restaurantId
          ? await tx.restaurant.findUnique({ where: { id: cart.restaurantId }, select: { id: true, name: true } })
          : null;
        throw new FoodCartConflictError(
          'Aapke food cart mein doosre restaurant ka khana hai — ek order, ek restaurant',
          {
            currentRestaurantId:   current?.id ?? null,
            currentRestaurantName: current?.name ?? null,
            attemptedRestaurantId:   menuItem.restaurant.id,
            attemptedRestaurantName: menuItem.restaurant.name,
          },
        );
      }

      if (!cart.restaurantId) {
        await tx.foodCart.update({ where: { id: cart.id }, data: { restaurantId: menuItem.restaurantId } });
      }

      await tx.foodCartItem.upsert({
        where:  { foodCartId_menuItemId: { foodCartId: cart.id, menuItemId: menuItem.id } },
        create: { foodCartId: cart.id, menuItemId: menuItem.id, quantity: input.quantity, unitPriceAtAdd },
        update: { quantity: { increment: input.quantity }, unitPriceAtAdd },
      });
    });
    } catch (err) {
      if (isStaleCartRace(err)) throw new BusinessRuleError('Cart abhi update hua tha — dobara try karein');
      throw err;
    }

    return getCart(userId);
  }

  // ── Set a line's quantity (0 removes it; an emptied cart unbinds fully). ───
  async function setItemQuantity(userId: string, menuItemId: string, quantity: number): Promise<FoodCartView> {
    const cart = await prisma.foodCart.findUnique({
      where: { userId }, include: { items: { select: { id: true, menuItemId: true } } },
    });
    if (!cart) throw new NotFoundError('Food cart');
    const line = cart.items.find((i) => i.menuItemId === menuItemId);
    if (!line) throw new NotFoundError('Food cart item');

    if (quantity === 0) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.foodCartItem.delete({ where: { id: line.id } });
          const remaining = await tx.foodCartItem.count({ where: { foodCartId: cart.id } });
          // Last line gone → drop the cart row so the restaurant binding clears
          // and the next add can bind any restaurant afresh.
          if (remaining === 0) await tx.foodCart.delete({ where: { id: cart.id } });
        });
      } catch (err) {
        // Row already gone (order placement consumed the cart) — the desired
        // end state ("line not in cart") is already true; return the fresh cart.
        if (!isStaleCartRace(err)) throw err;
      }
      return getCart(userId);
    }

    const menuItem = await prisma.menuItem.findUnique({
      where:  { id: menuItemId },
      select: { pricePaise: true, isAvailable: true, restaurantId: true, menuCategoryId: true },
    });
    if (!menuItem || !menuItem.isAvailable) {
      throw new BusinessRuleError('Yeh item abhi available nahi hai');
    }
    const cfg = await loadFoodConfig(prisma);
    const unitPriceAtAdd = applyMarkup(menuItem.pricePaise, cfg, {
      restaurantId:   menuItem.restaurantId,
      menuCategoryId: menuItem.menuCategoryId,
    });

    try {
      await prisma.foodCartItem.update({
        where: { id: line.id },
        data:  { quantity, unitPriceAtAdd },
      });
    } catch (err) {
      if (isStaleCartRace(err)) throw new NotFoundError('Food cart item');
      throw err;
    }
    return getCart(userId);
  }

  // ── Clear — used by [Start New Order] (Food.md §4.5) and by order placement.
  async function clearCart(userId: string): Promise<void> {
    await prisma.foodCart.deleteMany({ where: { userId } });
  }

  return { getCart, addItem, setItemQuantity, clearCart };
}
