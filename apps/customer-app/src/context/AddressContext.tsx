import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AddressResponse } from '@chirawa/types';
import { api } from '../services/api.service';
import { useAuth } from './AuthContext';

const STORAGE_KEY = '@selected_address_id';

interface AddressContextValue {
  addresses: AddressResponse[];
  current:   AddressResponse | null;
  loading:   boolean;
  refresh:   () => Promise<void>;
  select:    (id: string) => Promise<void>;   // make this the active delivery address everywhere
}

const AddressContext = createContext<AddressContextValue | undefined>(undefined);

const byDefaultFirst = (a: AddressResponse, b: AddressResponse) => Number(b.isDefault) - Number(a.isDefault);

// Single source of truth for the active delivery address. Every surface (home
// header, categories, order history, checkout/cart) reads `current` from here, so
// switching/pinning an address in the sheet propagates app-wide instantly.
export function AddressProvider({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const [addresses, setAddresses] = useState<AddressResponse[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);

  // Re-fetch the list, keeping the chosen address selected if it still exists.
  const refresh = useCallback(async () => {
    try {
      const list = (await api.getAddresses()).sort(byDefaultFirst);
      setAddresses(list);
      setCurrentId((prev) =>
        (prev && list.some((a) => a.id === prev)) ? prev : (list.find((a) => a.isDefault) ?? list[0])?.id ?? null,
      );
    } catch {
      /* tolerate — keep what we have */
    } finally {
      setLoading(false);
    }
  }, []);

  // Hydrate on login: persisted id → default → first.
  useEffect(() => {
    if (!state.isAuthenticated) { setAddresses([]); setCurrentId(null); setLoading(false); return; }
    let active = true;
    setLoading(true);
    (async () => {
      const [savedId, list] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY).catch(() => null),
        api.getAddresses().then((l) => l.sort(byDefaultFirst)).catch(() => [] as AddressResponse[]),
      ]);
      if (!active) return;
      setAddresses(list);
      const pick =
        (savedId && list.find((a) => a.id === savedId)) ||
        list.find((a) => a.isDefault) ||
        list[0] ||
        null;
      setCurrentId(pick?.id ?? null);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [state.isAuthenticated]);

  // Switch the active address — optimistic locally, persisted, and made the
  // server-side default so it survives reloads + other devices.
  const select = useCallback(async (id: string) => {
    setCurrentId(id);
    void AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});
    try { await api.setDefaultAddress(id); } catch { /* tolerate */ }
    void refresh();
  }, [refresh]);

  const current = useMemo(
    () => addresses.find((a) => a.id === currentId) ?? null,
    [addresses, currentId],
  );

  const value = useMemo<AddressContextValue>(
    () => ({ addresses, current, loading, refresh, select }),
    [addresses, current, loading, refresh, select],
  );

  return <AddressContext.Provider value={value}>{children}</AddressContext.Provider>;
}

export function useAddresses(): AddressContextValue {
  const ctx = useContext(AddressContext);
  if (!ctx) throw new Error('useAddresses must be used within an AddressProvider');
  return ctx;
}
