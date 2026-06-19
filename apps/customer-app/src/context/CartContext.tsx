import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  recentlyAdded:  LastAddedItem[];         // last 3 distinct added (oldest→newest)
  pendingMutations: number;                // in-flight add/update/remove writes (YMAL race fix)
  addItem:        (item: AddItemInput) => Promise<void>;
  setQuantity:    (productId: string, qty: number, variantId?: string) => Promise<void>;
  flushPendingMutations: () => Promise<void>; // resolves once no cart write is in flight
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
  // Lightweight current cart contents (with images) for the capsule thumbnails,
  // plus recency tracking so the capsule shows the 3 most-recently-added items.
  const [cartItems, setCartItems] = useState<{ productId: string; name: string; imageUrl: string | null }[]>([]);
  const addOrderRef   = useRef<string[]>([]);              // productIds, most-recent last
  const colorByPidRef = useRef<Record<string, string>>({});
  // In-flight cart writes (add/update/remove). Drives Place Order gating +
  // flushPendingMutations so an outstanding YMAL add can't be lost when checkout fires.
  const [pendingMutations, setPendingMutations] = useState(0);
  const pendingRef = useRef<Set<Promise<void>>>(new Set());

  const count = useMemo(
    () => Object.values(quantities).reduce((s, q) => s + q, 0),
    [quantities],
  );

  // The 3 most-recently-added items STILL IN THE CART (oldest→newest). Derived
  // from live cart contents, so it stays at 3 while the cart has >3 items
  // (removing one backfills) and counts down 3→2→1 once ≤3 remain.
  const recentlyAdded = useMemo<LastAddedItem[]>(() => {
    const order = addOrderRef.current;
    const rank = (pid: string) => order.indexOf(pid); // -1 (unknown) → oldest
    return [...cartItems]
      .sort((a, b) => rank(a.productId) - rank(b.productId))
      .slice(-3)
      .map((it) => ({
        productId: it.productId, name: it.name, imageUrl: it.imageUrl,
        imageColor: colorByPidRef.current[it.productId] ?? DEFAULT_COLOR,
      }));
  }, [cartItems]);

  const refresh = useCallback(async () => {
    if (!isAuthed) {
      setQuantities({});
      setSubtotal(0);
      setCartItems([]);
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
      setCartItems(cart.items.map((it) => ({ productId: it.productId, name: it.productName, imageUrl: it.imageUrl })));
    } catch {
      setQuantities({});
      setSubtotal(0);
      setCartItems([]);
    }
  }, [isAuthed]);

  // ── Pending cart-mutation tracking (YMAL race fix, Phase 1) ────────────────
  // Register every in-flight add/update/remove (the network write + its refresh)
  // so Checkout can disable Place Order while writes are outstanding AND await
  // them before creating the order. Without this, a YMAL add still in flight when
  // Place Order fires is lost: placeOrder consumes + deletes the pre-add cart and
  // the late write resurrects a new (orphan) cart holding the item.
  const track = useCallback((work: Promise<void>): Promise<void> => {
    const tracked = work.finally(() => {
      pendingRef.current.delete(tracked);
      setPendingMutations(pendingRef.current.size);
    });
    pendingRef.current.add(tracked);
    setPendingMutations(pendingRef.current.size);
    return tracked;
  }, []);

  // Resolve once no cart mutation is in flight. Loops so writes that begin
  // mid-flush (e.g. another rapid YMAL tap) are awaited too. `allSettled` never
  // rejects, so a failed mutation can't make this throw.
  const flushPendingMutations = useCallback(async (): Promise<void> => {
    while (pendingRef.current.size > 0) {
      await Promise.allSettled([...pendingRef.current]);
    }
  }, []);

  const addItem = useCallback(async (item: AddItemInput) => {
    const key = cartKey(item.productId, item.variantId);
    const cur = quantities[key] ?? 0;
    // optimistic
    setQuantities((q) => ({ ...q, [key]: cur + 1 }));
    const added: LastAddedItem = {
      productId:  item.productId,
      name:       item.name,
      imageUrl:   item.imageUrl ?? null,
      imageColor: item.imageColor ?? DEFAULT_COLOR,
    };
    setLastAdded(added);
    // Track recency (re-adding bumps to newest) + remember the placeholder colour,
    // and optimistically reflect the item in cartItems for instant thumbnails.
    addOrderRef.current = [...addOrderRef.current.filter((p) => p !== item.productId), item.productId];
    colorByPidRef.current[item.productId] = added.imageColor;
    setCartItems((prev) => prev.some((p) => p.productId === item.productId)
      ? prev
      : [...prev, { productId: item.productId, name: item.name, imageUrl: item.imageUrl ?? null }]);
    await track((async () => {
      try {
        if (cur > 0) await api.updateCartItem(item.productId, cur + 1, item.variantId);
        else         await api.addToCart({ productId: item.productId, quantity: 1, ...(item.variantId ? { variantId: item.variantId } : {}) });
        await refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Could not add to cart';
        toast.show(msg, 'error');
        await refresh();   // revert optimistic change to server truth
      }
    })());
  }, [quantities, refresh, toast, track]);

  const setQuantity = useCallback(async (productId: string, qty: number, variantId?: string) => {
    const key = cartKey(productId, variantId);
    const next = Math.max(0, qty);
    setQuantities((q) => {
      const copy = { ...q };
      if (next === 0) delete copy[key];
      else copy[key] = next;
      return copy;
    });
    // Optimistically drop the thumbnail when a line is removed (slides out).
    if (next === 0) setCartItems((prev) => prev.filter((p) => p.productId !== productId));
    await track((async () => {
      try {
        await api.updateCartItem(productId, next, variantId);
        await refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Could not update cart';
        toast.show(msg, 'error');
        await refresh();
      }
    })());
  }, [refresh, toast, track]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!navigationRef.isReady?.()) return;
    const unsub = navigationRef.addListener('state', () => { void refresh(); });
    return unsub;
  }, [refresh]);

  return (
    <CartContext.Provider value={{ count, subtotalPaise, quantities, lastAddedItem, recentlyAdded, pendingMutations, addItem, setQuantity, flushPendingMutations, refresh }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  return ctx ?? {
    count: 0, subtotalPaise: 0, quantities: {}, lastAddedItem: null, recentlyAdded: [],
    pendingMutations: 0,
    addItem: async () => {}, setQuantity: async () => {},
    flushPendingMutations: async () => {}, refresh: async () => {},
  };
}
