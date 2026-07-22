// Pure guest-cart model + math (no React) so it's testable and reusable by the
// GuestCart context (Task 5), the cart page (Task 10) and the login sync (Task 11,
// which replays each line to the server via addToCart({productId,quantity,variantId})).

export interface GuestCartItem {
  productId: string;
  variantId?: string; // optional pack-size variant
  quantity: number;
  name: string;
  imageUrl: string | null;
  shopId?: string;
  pricePaise: number;
}

export interface AddGuestItemInput {
  productId: string;
  variantId?: string;
  name: string;
  imageUrl?: string | null;
  shopId?: string;
  pricePaise: number;
}

// A cart line's key: variant-less items use the bare productId (so steppers keyed
// by productId keep working); variant lines append the variantId.
export function cartKey(productId: string, variantId?: string | null): string {
  return variantId ? `${productId}::${variantId}` : productId;
}

export function itemKey(item: { productId: string; variantId?: string }): string {
  return cartKey(item.productId, item.variantId);
}

export function cartCount(items: GuestCartItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}

export function cartSubtotalPaise(items: GuestCartItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity * i.pricePaise, 0);
}

export function cartQuantities(items: GuestCartItem[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const i of items) map[itemKey(i)] = i.quantity;
  return map;
}

// Add +1 of an item (or create the line). Returns a NEW array (immutable).
export function addLine(items: GuestCartItem[], input: AddGuestItemInput): GuestCartItem[] {
  const key = cartKey(input.productId, input.variantId);
  if (items.some((i) => itemKey(i) === key)) {
    return items.map((i) => (itemKey(i) === key ? { ...i, quantity: i.quantity + 1 } : i));
  }
  const line: GuestCartItem = {
    productId: input.productId,
    quantity: 1,
    name: input.name,
    imageUrl: input.imageUrl ?? null,
    pricePaise: input.pricePaise,
    ...(input.variantId ? { variantId: input.variantId } : {}),
    ...(input.shopId ? { shopId: input.shopId } : {}),
  };
  return [...items, line];
}

// Set an exact quantity (0 removes the line). Returns a NEW array.
export function setLineQuantity(
  items: GuestCartItem[],
  productId: string,
  qty: number,
  variantId?: string,
): GuestCartItem[] {
  const key = cartKey(productId, variantId);
  const next = Math.max(0, Math.floor(qty));
  if (next === 0) return items.filter((i) => itemKey(i) !== key);
  if (!items.some((i) => itemKey(i) === key)) return items;
  return items.map((i) => (itemKey(i) === key ? { ...i, quantity: next } : i));
}
