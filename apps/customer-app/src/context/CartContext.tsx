import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.service';
import { useAuth } from './AuthContext';
import { useToast } from '../components/ui';
import { navigationRef } from '../navigation/ref';

export interface LastAddedItem {
  productId:  string;
  name:       string;
  imageUrl?:  string | null;
  imageColor: string;   // placeholder colour for thumbnails / fly square
}

export interface AddItemInput {
  productId:  string;
  variantId?: string;          // optional pack-size variant
  name:       string;
  imageUrl?:  string | null;
  imageColor?: string;
}

interface CartContextValue {
  count:          number;                  // total quantity across items
  subtotalPaise:  number;
  quantities:     Record<string, number>;  // cartKey → qty (for steppers)
  lastAddedItem:  LastAddedItem | null;
  addItem:        (item: AddItemInput) => Promise<void>;
  setQuantity:    (productId: string, qty: number, variantId?: string) => Promise<void>;
  refresh:        () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

// A cart line's key: variant-less items use the bare productId (so existing
// ProductCard steppers keyed by productId keep working); variant lines append
// the variantId so two sizes of the same product are tracked separately.
export function cartKey(productId: string, variantId?: string | null): string {
  return variantId ? `${productId}::${variantId}` : productId;
}

const DEFAULT_COLOR = '#FFE0CC';

// Server-backed cart summary (the app's real cart lives on the backend and
// feeds CartScreen → Checkout → Razorpay). This provider mirrors just enough
// of it for the home/category surfaces: per-product quantities, totals, and
// the last-added item for the floating capsule + fly-to-cart animation.
//
// Writes are OPTIMISTIC: the quantities map updates instantly (so steppers
// feel native), the API call fires, then refresh() reconciles against the
// server. On failure we surface a toast and re-sync.
export function CartProvider({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const toast = useToast();
  const isAuthed = state.isAuthenticated;

  const [quantities, setQuantities]     = useState<Record<string, number>>({});
  const [subtotalPaise, setSubtotal]    = useState(0);
  const [lastAddedItem, setLastAdded]   = useState<LastAddedItem | null>(null);

  const count = useMemo(
    () => Object.values(quantities).reduce((s, q) => s + q, 0),
    [quantities],
  );

  const refresh = useCallback(async () => {
    if (!isAuthed) {
      setQuantities({});
      setSubtotal(0);
      return;
    }
    try {
      const cart = await api.getCart();
      const map: Record<string, number> = {};
      for (const it of cart.items) {
        map[cartKey(it.productId, (it as { variantId?: string }).variantId)] = it.quantity;
      }
      setQuantities(map);
      setSubtotal(cart.subtotal);
    } catch {
      setQuantities({});
      setSubtotal(0);
    }
  }, [isAuthed]);

  const addItem = useCallback(async (item: AddItemInput) => {
    const key = cartKey(item.productId, item.variantId);
    const cur = quantities[key] ?? 0;
    // optimistic
    setQuantities((q) => ({ ...q, [key]: cur + 1 }));
    setLastAdded({
      productId:  item.productId,
      name:       item.name,
      imageUrl:   item.imageUrl ?? null,
      imageColor: item.imageColor ?? DEFAULT_COLOR,
    });
    try {
      if (cur > 0) await api.updateCartItem(item.productId, cur + 1, item.variantId);
      else         await api.addToCart({ productId: item.productId, quantity: 1, ...(item.variantId ? { variantId: item.variantId } : {}) });
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not add to cart';
      toast.show(msg, 'error');
      await refresh();   // revert optimistic change to server truth
    }
  }, [quantities, refresh, toast]);

  const setQuantity = useCallback(async (productId: string, qty: number, variantId?: string) => {
    const key = cartKey(productId, variantId);
    const next = Math.max(0, qty);
    setQuantities((q) => {
      const copy = { ...q };
      if (next === 0) delete copy[key];
      else copy[key] = next;
      return copy;
    });
    try {
      await api.updateCartItem(productId, next, variantId);
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not update cart';
      toast.show(msg, 'error');
      await refresh();
    }
  }, [refresh, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!navigationRef.isReady?.()) return;
    const unsub = navigationRef.addListener('state', () => { void refresh(); });
    return unsub;
  }, [refresh]);

  return (
    <CartContext.Provider value={{ count, subtotalPaise, quantities, lastAddedItem, addItem, setQuantity, refresh }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  return ctx ?? {
    count: 0, subtotalPaise: 0, quantities: {}, lastAddedItem: null,
    addItem: async () => {}, setQuantity: async () => {}, refresh: async () => {},
  };
}
