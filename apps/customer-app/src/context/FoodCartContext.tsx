import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { FoodCartView } from '@chirawa/types';
import { FOOD_CART_DIFFERENT_RESTAURANT } from '@chirawa/types';
import { api } from '../services/api.service';
import { ApiError } from '@chirawa/api-client';
import { useAuth } from './AuthContext';
import { useCart } from './CartContext';
import { useToast } from '../components/ui';

// ─── Food cart state (Food.md §8.3) ───────────────────────────────────────────
// COMPLETELY SEPARATE from the marketplace CartContext — that file is untouched.
// Server-backed (/food/cart) with the same optimistic-write + reconcile pattern
// the marketplace cart proved out. Also owns the conflict UX state: a 409
// FOOD_CART_DIFFERENT_RESTAURANT from the API surfaces as `conflict`, which the
// premium bottom-sheet renders (never a raw toast — Food.md §4.5).
//
// The marketplace cart is READ (never written) for one purpose: the first food
// add of a session while grocery items exist shows the informational
// "delivered separately" sheet (Food.md §4.5, Grocery → Food direction).

export type FoodConflict =
  | {
      kind: 'different-restaurant';
      // Re-issued if the user picks [Start New Order].
      attempted: { menuItemId: string; quantity: number };
    }
  | { kind: 'cross-info'; attempted: { menuItemId: string; quantity: number } };

interface FoodCartContextValue {
  cart:          FoodCartView | null;
  count:         number;
  subtotalPaise: number;
  quantities:    Record<string, number>; // menuItemId → qty (drives steppers)
  conflict:      FoodConflict | null;
  // In-flight cart writes — checkout gates Place Order on this + flushes first,
  // so a just-tapped add can never be stranded by order placement (same race
  // the marketplace cart fixed with its YMAL guard).
  pendingMutations: number;
  flushPendingMutations: () => Promise<void>;
  addItem:       (menuItemId: string, quantity?: number) => Promise<void>;
  setQuantity:   (menuItemId: string, qty: number) => Promise<void>;
  // Conflict-sheet actions (Food.md §4.5) — explicit, never automatic:
  startNewOrder: () => Promise<void>; // clear food cart, then add the attempted item
  dismissConflict: () => void;        // [Continue Current Order] / [Got it]
  refresh:       () => Promise<void>;
}

const FoodCartContext = createContext<FoodCartContextValue | null>(null);

export function FoodCartProvider({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const toast = useToast();
  const marketplaceCart = useCart(); // read-only peek for the cross-cart info sheet
  const isAuthed = state.isAuthenticated;

  const [cart, setCart]         = useState<FoodCartView | null>(null);
  const [conflict, setConflict] = useState<FoodConflict | null>(null);
  // The Grocery→Food educational sheet shows at most once per session.
  const crossInfoShownRef = useRef(false);
  // In-flight cart writes (add/update). Mirrors the marketplace CartContext's
  // tracking so checkout can await quiescence before consuming the cart.
  const [pendingMutations, setPendingMutations] = useState(0);
  const pendingRef = useRef<Set<Promise<void>>>(new Set());

  const track = useCallback((work: Promise<void>): Promise<void> => {
    const tracked = work.finally(() => {
      pendingRef.current.delete(tracked);
      setPendingMutations(pendingRef.current.size);
    });
    pendingRef.current.add(tracked);
    setPendingMutations(pendingRef.current.size);
    return tracked;
  }, []);

  // Resolves once no cart write is in flight; loops so writes that begin
  // mid-flush are awaited too. allSettled never rejects.
  const flushPendingMutations = useCallback(async (): Promise<void> => {
    while (pendingRef.current.size > 0) {
      await Promise.allSettled([...pendingRef.current]);
    }
  }, []);

  const quantities = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const it of cart?.items ?? []) map[it.menuItemId] = it.quantity;
    return map;
  }, [cart]);

  const count         = cart?.count ?? 0;
  const subtotalPaise = cart?.itemsSubtotalPaise ?? 0;

  const refresh = useCallback(async () => {
    if (!isAuthed) { setCart(null); return; }
    try {
      setCart(await api.getFoodCart());
    } catch {
      /* keep the last known cart — transient network noise must not blank the bar */
    }
  }, [isAuthed]);

  useEffect(() => { void refresh(); }, [refresh]);

  // The actual server write, shared by addItem and startNewOrder's re-add.
  const performAdd = useCallback(async (menuItemId: string, quantity: number) => {
    await track((async () => {
      try {
        setCart(await api.addFoodCartItem({ menuItemId, quantity }));
      } catch (e: unknown) {
        if (e instanceof ApiError && e.code === FOOD_CART_DIFFERENT_RESTAURANT) {
          // Different restaurant → premium sheet, never a toast (Food.md §4.5).
          setConflict({ kind: 'different-restaurant', attempted: { menuItemId, quantity } });
          return;
        }
        const msg = e instanceof Error ? e.message : 'Could not add item';
        toast.show(msg, 'error');
        await refresh();
      }
    })());
  }, [refresh, toast, track]);

  const addItem = useCallback(async (menuItemId: string, quantity = 1) => {
    // Grocery → Food education (once per session): both carts legitimately
    // coexist as separate orders, so this is informational — the add proceeds
    // after [Got it]. Zero marketplace-cart code involved (read-only peek).
    if (!crossInfoShownRef.current && marketplaceCart.count > 0 && count === 0) {
      crossInfoShownRef.current = true;
      setConflict({ kind: 'cross-info', attempted: { menuItemId, quantity } });
      return;
    }
    await performAdd(menuItemId, quantity);
  }, [count, marketplaceCart.count, performAdd]);

  const setQuantity = useCallback(async (menuItemId: string, qty: number) => {
    const next = Math.max(0, qty);
    // Optimistic: mirror the marketplace cart's instant-stepper feel.
    setCart((prev) => {
      if (!prev) return prev;
      const items = next === 0
        ? prev.items.filter((i) => i.menuItemId !== menuItemId)
        : prev.items.map((i) => i.menuItemId === menuItemId
            ? { ...i, quantity: next, subtotalPaise: i.unitPricePaise * next }
            : i);
      return {
        ...prev,
        items,
        count: items.reduce((s, i) => s + i.quantity, 0),
        itemsSubtotalPaise: items.reduce((s, i) => s + i.subtotalPaise, 0),
      };
    });
    await track((async () => {
      try {
        setCart(await api.updateFoodCartItem(menuItemId, next));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Could not update cart';
        toast.show(msg, 'error');
        await refresh(); // revert optimistic change to server truth
      }
    })());
  }, [refresh, toast, track]);

  // [Start New Order] — the explicit, labelled clear (Food.md §4.5). Clears the
  // food cart, then re-adds the item the user originally wanted.
  const startNewOrder = useCallback(async () => {
    const attempted = conflict?.attempted;
    setConflict(null);
    try {
      await api.clearFoodCart();
      setCart(null);
      if (attempted) await performAdd(attempted.menuItemId, attempted.quantity);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not start a new order';
      toast.show(msg, 'error');
      await refresh();
    }
  }, [conflict, performAdd, refresh, toast]);

  const dismissConflict = useCallback(() => {
    const c = conflict;
    setConflict(null);
    // The cross-cart sheet is informational — [Got it] proceeds with the add.
    if (c?.kind === 'cross-info') void performAdd(c.attempted.menuItemId, c.attempted.quantity);
  }, [conflict, performAdd]);

  const value = useMemo<FoodCartContextValue>(() => ({
    cart, count, subtotalPaise, quantities, conflict,
    pendingMutations, flushPendingMutations,
    addItem, setQuantity, startNewOrder, dismissConflict, refresh,
  }), [cart, count, subtotalPaise, quantities, conflict, pendingMutations, flushPendingMutations, addItem, setQuantity, startNewOrder, dismissConflict, refresh]);

  return <FoodCartContext.Provider value={value}>{children}</FoodCartContext.Provider>;
}

export function useFoodCart(): FoodCartContextValue {
  const ctx = useContext(FoodCartContext);
  return ctx ?? {
    cart: null, count: 0, subtotalPaise: 0, quantities: {}, conflict: null,
    pendingMutations: 0, flushPendingMutations: async () => {},
    addItem: async () => {}, setQuantity: async () => {},
    startNewOrder: async () => {}, dismissConflict: () => {}, refresh: async () => {},
  };
}
