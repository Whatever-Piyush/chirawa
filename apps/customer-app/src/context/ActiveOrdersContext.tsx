import React, { createContext, useContext, type ReactNode } from 'react';
import { useActiveOrders, type ActiveOrdersState } from '../hooks/useActiveOrders';

// ── Shared active-orders feed (Track_Order.md · Integration / Performance) ────
// One instance of useActiveOrders for the whole app → a single socket and a
// single fetch loop, shared by the Home Active-Orders strip and the floating
// LiveOrderBubble so they can never disagree. Mounting is unconditional (stable
// tree); the `enabled` prop keeps it inert until the customer is authenticated.

const DEFAULT: ActiveOrdersState = {
  entries:       [],
  connected:     true,
  justDelivered: null,
  refresh:       async () => {},
};

const ActiveOrdersContext = createContext<ActiveOrdersState>(DEFAULT);

export function ActiveOrdersProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const value = useActiveOrders(enabled);
  return <ActiveOrdersContext.Provider value={value}>{children}</ActiveOrdersContext.Provider>;
}

export function useActiveOrdersContext(): ActiveOrdersState {
  return useContext(ActiveOrdersContext);
}
