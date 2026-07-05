'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  addLine,
  cartCount,
  cartQuantities,
  cartSubtotalPaise,
  setLineQuantity,
  type AddGuestItemInput,
  type GuestCartItem,
} from '@/lib/cart';

// Guest cart in localStorage — usable while browsing, no auth needed. Task 11
// replays these lines into the server cart on login, then clears this store.

const STORAGE_KEY = 'bringly_guest_cart';

type GuestCartValue = {
  items: GuestCartItem[];
  ready: boolean; // hydrated from storage
  count: number;
  subtotalPaise: number;
  quantities: Record<string, number>; // cartKey → qty (for steppers)
  addItem: (input: AddGuestItemInput) => void;
  setQuantity: (productId: string, qty: number, variantId?: string) => void;
  removeItem: (productId: string, variantId?: string) => void;
  clear: () => void;
};

const GuestCartContext = createContext<GuestCartValue | undefined>(undefined);

function isValidLine(x: unknown): x is GuestCartItem {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.productId === 'string' &&
    typeof o.quantity === 'number' &&
    typeof o.pricePaise === 'number' &&
    typeof o.name === 'string'
  );
}

function readStored(): GuestCartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(isValidLine);
  } catch {
    /* corrupt value — start empty */
  }
  return [];
}

export function GuestCartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<GuestCartItem[]>([]);
  const [ready, setReady] = useState(false);

  // Hydrate once (SSR starts empty → capsule hidden → no hydration mismatch).
  useEffect(() => {
    setItems(readStored());
    setReady(true);
  }, []);

  // Persist on every change (after hydration, so we don't clobber storage with []).
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* ignore quota / private mode */
    }
  }, [items, ready]);

  const addItem = useCallback((input: AddGuestItemInput) => {
    setItems((cur) => addLine(cur, input));
  }, []);
  const setQuantity = useCallback((productId: string, qty: number, variantId?: string) => {
    setItems((cur) => setLineQuantity(cur, productId, qty, variantId));
  }, []);
  const removeItem = useCallback((productId: string, variantId?: string) => {
    setItems((cur) => setLineQuantity(cur, productId, 0, variantId));
  }, []);
  const clear = useCallback(() => setItems([]), []);

  const count = useMemo(() => cartCount(items), [items]);
  const subtotalPaise = useMemo(() => cartSubtotalPaise(items), [items]);
  const quantities = useMemo(() => cartQuantities(items), [items]);

  const value = useMemo<GuestCartValue>(
    () => ({ items, ready, count, subtotalPaise, quantities, addItem, setQuantity, removeItem, clear }),
    [items, ready, count, subtotalPaise, quantities, addItem, setQuantity, removeItem, clear],
  );

  return <GuestCartContext.Provider value={value}>{children}</GuestCartContext.Provider>;
}

export function useGuestCart(): GuestCartValue {
  const ctx = useContext(GuestCartContext);
  if (!ctx) throw new Error('useGuestCart must be used within a GuestCartProvider');
  return ctx;
}
