import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import type { AddToCartInput, UpdateCartItemInput } from './cart.schema';
import {
  NotFoundError, ValidationError, BusinessRuleError,
} from '../../shared/errors/app-errors';

// Fee band thresholds in paise — when cart crosses these, delivery fee changes
// ₹100 = 10000 paise, ₹300 = 30000 paise
const FEE_BAND_THRESHOLDS = [10000, 30000];

interface CartItem {
  productId:   string;
  productName: string;
  imageUrl:    string | null;
  unitPrice:   number; // paise — current price
  quantity:    number;
  subtotal:    number; // paise = unitPrice × quantity
  shopId:      string; // multi-shop carts: which shop this item is from
  shopName:    string;
  variantId?:  string; // optional pack-size variant (undefined = base product)
  variantName?: string;
}

// A cart line is identified by product + variant. Variant-less items
// (variantId undefined) match purely on productId — unchanged legacy behavior.
function sameLine(item: CartItem, productId: string, variantId?: string): boolean {
  return item.productId === productId && (item.variantId ?? null) === (variantId ?? null);
}

// Cart-level "primary" shop = the first item's shop. Kept only for the legacy
// cart.shopId/shopName fields & the DB Cart row; cart logic is now per-item.
function primaryShop(items: CartItem[]): { shopId: string; shopName: string } {
  return items[0]
    ? { shopId: items[0].shopId, shopName: items[0].shopName }
    : { shopId: '', shopName: '' };
}

interface CartData {
  cartId:    string;
  userId:    string;
  shopId:    string;
  shopName:  string;
  items:     CartItem[];
  subtotal:  number; // paise
  updatedAt: string;
}

interface CartResponse extends CartData {
  requiresPricingRefresh: boolean;
}

function cartKey(userId: string): string {
  return `cart:${userId}`;
}

const CART_TTL = 86400; // 24 hours

function crossedFeeBand(oldSubtotal: number, newSubtotal: number): boolean {
  return FEE_BAND_THRESHOLDS.some(
    (band) =>
      (oldSubtotal < band && newSubtotal >= band) ||
      (oldSubtotal >= band && newSubtotal < band),
  );
}

function computeSubtotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.subtotal, 0);
}

export function createCartService(prisma: PrismaClient, redis: Redis) {

  // ── Load cart from Redis (or return empty) ────────────────────────────────
  async function loadCart(userId: string): Promise<CartData | null> {
    const raw = await redis.get(cartKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as CartData;
  }

  // ── Save cart to Redis + sync to DB ───────────────────────────────────────
  async function saveCart(cart: CartData): Promise<void> {
    // Write to Redis (primary)
    await redis.setex(cartKey(cart.userId), CART_TTL, JSON.stringify(cart));

    // Sync to DB (recovery fallback) — upsert cart record
    await prisma.cart.upsert({
      where:  { userId: cart.userId },
      update: {
        shopId:    cart.shopId,
        expiresAt: new Date(Date.now() + CART_TTL * 1000),
        updatedAt: new Date(),
      },
      create: {
        id:        cart.cartId,
        userId:    cart.userId,
        shopId:    cart.shopId,
        expiresAt: new Date(Date.now() + CART_TTL * 1000),
      },
    });
  }

  // ── Get cart ──────────────────────────────────────────────────────────────
  async function getCart(userId: string): Promise<CartResponse> {
    const cart = await loadCart(userId);

    if (!cart || cart.items.length === 0) {
      return {
        cartId:    '',
        userId,
        shopId:    '',
        shopName:  '',
        items:     [],
        subtotal:  0,
        updatedAt: new Date().toISOString(),
        requiresPricingRefresh: false,
      };
    }

    return { ...cart, requiresPricingRefresh: false };
  }

  // ── Add item to cart ──────────────────────────────────────────────────────
  async function addItem(
    userId: string,
    input: AddToCartInput,
  ): Promise<CartResponse> {
    // Validate product exists and is available
    const product = await prisma.product.findUnique({
      where: { id: input.productId },
      include: {
        shop:   { select: { id: true, name: true, isActive: true } },
        images: { orderBy: { sortOrder: 'asc' }, take: 1 },
      },
    });

    if (!product || !product.isActive) throw new NotFoundError('Product');
    if (!product.shop.isActive) throw new BusinessRuleError('Yeh dukaan abhi available nahi hai');
    if (product.stockStatus === 'out_of_stock') {
      throw new BusinessRuleError(`${product.name} abhi stock mein nahi hai`);
    }
    if (product.stockStatus === 'hidden') throw new NotFoundError('Product');

    // Resolve an optional pack-size variant — its price + name override the base.
    let unitPrice = product.price;
    let lineName  = product.name;
    let variantId: string | undefined;
    let variantName: string | undefined;
    if (input.variantId) {
      const variant = await prisma.productVariant.findUnique({
        where:  { id: input.variantId },
        select: { id: true, productId: true, name: true, price: true, stockQty: true, isActive: true },
      });
      if (!variant || !variant.isActive || variant.productId !== product.id) {
        throw new NotFoundError('Variant');
      }
      if (variant.stockQty <= 0) {
        throw new BusinessRuleError(`${product.name} (${variant.name}) abhi stock mein nahi hai`);
      }
      unitPrice   = variant.price;
      lineName    = `${product.name} (${variant.name})`;
      variantId   = variant.id;
      variantName = variant.name;
    }

    const existingCart = await loadCart(userId);

    // Multi-shop carts are allowed — items from different shops coexist and are
    // split into one order per shop at checkout.

    const oldSubtotal = existingCart?.subtotal ?? 0;

    // Build updated items list
    const items: CartItem[] = existingCart?.items ?? [];
    const existingIndex = items.findIndex((i) => sameLine(i, product.id, variantId));

    const newItem: CartItem = {
      productId:   product.id,
      productName: lineName,
      imageUrl:    product.images[0]?.url ?? null,
      unitPrice,
      quantity:    input.quantity,
      subtotal:    unitPrice * input.quantity,
      shopId:      product.shopId,
      shopName:    product.shop.name,
      ...(variantId ? { variantId, variantName } : {}),
    };

    if (existingIndex >= 0) {
      // Update existing — add to quantity
      const existing = items[existingIndex]!;
      const newQty   = existing.quantity + input.quantity;
      items[existingIndex] = {
        ...existing,
        unitPrice, // Refresh price
        quantity:  newQty,
        subtotal:  unitPrice * newQty,
      };
    } else {
      items.push(newItem);
    }

    const newSubtotal = computeSubtotal(items);

    // Generate cartId if new cart
    const cartId = existingCart?.cartId ?? crypto.randomUUID();

    const cart: CartData = {
      cartId,
      userId,
      ...primaryShop(items),
      items,
      subtotal:  newSubtotal,
      updatedAt: new Date().toISOString(),
    };

    await saveCart(cart);

    return {
      ...cart,
      requiresPricingRefresh: crossedFeeBand(oldSubtotal, newSubtotal),
    };
  }

  // ── Update item quantity ───────────────────────────────────────────────────
  async function updateItem(
    userId: string,
    productId: string,
    input: UpdateCartItemInput,
  ): Promise<CartResponse> {
    const existingCart = await loadCart(userId);
    if (!existingCart) throw new NotFoundError('Cart');

    const variantId = input.variantId;
    const target = existingCart.items.find((i) => sameLine(i, productId, variantId));
    if (!target) throw new NotFoundError('Cart item');

    const oldSubtotal = existingCart.subtotal;
    let items: CartItem[];

    if (input.quantity === 0) {
      // Remove the matching line
      items = existingCart.items.filter((i) => !sameLine(i, productId, variantId));
    } else {
      // Get fresh price from the variant (if any) or the base product
      let unitPrice: number;
      if (target.variantId) {
        const variant = await prisma.productVariant.findUnique({
          where:  { id: target.variantId },
          select: { price: true, stockQty: true, isActive: true },
        });
        if (!variant || !variant.isActive || variant.stockQty <= 0) {
          throw new BusinessRuleError('Yeh item abhi available nahi hai');
        }
        unitPrice = variant.price;
      } else {
        const product = await prisma.product.findUnique({
          where:  { id: productId },
          select: { price: true, stockStatus: true },
        });
        if (!product || product.stockStatus === 'out_of_stock') {
          throw new BusinessRuleError('Yeh item abhi available nahi hai');
        }
        unitPrice = product.price;
      }

      items = existingCart.items.map((item) =>
        sameLine(item, productId, variantId)
          ? { ...item, unitPrice, quantity: input.quantity, subtotal: unitPrice * input.quantity }
          : item,
      );
    }

    const newSubtotal = computeSubtotal(items);

    // If cart is now empty, clear it
    if (items.length === 0) {
      await clearCart(userId);
      return {
        cartId: '', userId, shopId: '', shopName: '',
        items: [], subtotal: 0,
        updatedAt: new Date().toISOString(),
        requiresPricingRefresh: false,
      };
    }

    const cart: CartData = {
      ...existingCart,
      ...primaryShop(items),
      items,
      subtotal:  newSubtotal,
      updatedAt: new Date().toISOString(),
    };

    await saveCart(cart);

    return {
      ...cart,
      requiresPricingRefresh: crossedFeeBand(oldSubtotal, newSubtotal),
    };
  }

  // ── Clear cart ─────────────────────────────────────────────────────────────
  async function clearCart(userId: string): Promise<void> {
    await redis.del(cartKey(userId));
    await prisma.cart.deleteMany({ where: { userId } });
  }

  return { getCart, addItem, updateItem, clearCart };
}
