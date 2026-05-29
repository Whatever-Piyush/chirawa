import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../services/api.service';
import { useAuth } from './AuthContext';
import { navigationRef } from '../navigation/ref';

interface CartSummary {
  count:         number;   // total quantity across items
  subtotalPaise: number;
  refresh:       () => Promise<void>;
}

const CartContext = createContext<CartSummary | null>(null);

// Lightweight global cart summary. There's no central cart store in the app —
// each screen hits api.getCart() directly — so this provider keeps just the
// count + subtotal needed by the floating "View cart" pill. It refreshes:
//   1. on auth change (login/logout), and
//   2. on every navigation transition — which is how it picks up items added
//      on ShopDetail / Search once the user navigates back to a tab.
// Adds made *within* a screen that has its own cart UI (ShopDetail footer)
// don't need instant global sync; the pill is for the tab surfaces.
export function CartProvider({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const isAuthed = state.isAuthenticated;
  const [count, setCount] = useState(0);
  const [subtotalPaise, setSubtotalPaise] = useState(0);

  const refresh = useCallback(async () => {
    if (!isAuthed) {
      setCount(0);
      setSubtotalPaise(0);
      return;
    }
    try {
      const cart = await api.getCart();
      setCount(cart.items.reduce((sum, i) => sum + i.quantity, 0));
      setSubtotalPaise(cart.subtotal);
    } catch {
      // No cart yet / transient error → treat as empty (pill hides).
      setCount(0);
      setSubtotalPaise(0);
    }
  }, [isAuthed]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!navigationRef.isReady?.()) {
      // Container not mounted yet on very first render — the auth-change
      // effect above still covers the initial fetch.
      return;
    }
    const unsub = navigationRef.addListener('state', () => { void refresh(); });
    return unsub;
  }, [refresh]);

  return (
    <CartContext.Provider value={{ count, subtotalPaise, refresh }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartSummary {
  const ctx = useContext(CartContext);
  // Safe fallback if consumed outside the provider (e.g. isolated tests).
  return ctx ?? { count: 0, subtotalPaise: 0, refresh: async () => {} };
}
