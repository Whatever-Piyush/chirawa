import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { OrderStatus } from '@chirawa/types';
import { api } from '../services/api.service';
import { StorageService } from '../services/storage.service';
import { DEV_HOST } from '../config/devHost';

const SOCKET_URL = __DEV__ ? `http://${DEV_HOST}:3000` : 'https://api.chirawa.in';

// Terminal states — anything else counts as "active" (mirrors OrderHistory's
// FINAL_STATUSES, so the strip and the Track buttons in history always agree).
const FINAL_STATUSES = new Set<string>([OrderStatus.DELIVERED, OrderStatus.CANCELLED]);

// GET /orders returns raw Prisma order rows; narrow to what the strip reads.
interface OrderRow {
  id:          string;
  groupId?:    string | null;
  status:      string;
  totalAmount: number;
  items:       Array<{ quantity: number }>;
}

// One display entry per Home card: a plain order, or a whole multi-shop group
// collapsed into a single card (matching how OrderPlaced/GroupTracking present it).
export interface ActiveOrderEntry {
  key:        string;       // stable list key (orderId, or group:<groupId>)
  orderId:    string;       // representative child for groups — valid tracking target
  groupId?:   string;       // set only for multi-shop groups → opens the group overview
  status:     OrderStatus;
  itemCount:  number;
  totalPaise: number;
  orderCount: number;       // active child orders; >1 switches the card to "N shops" copy
}

// Least-advanced-active-child rule for a group's combined status — mirrors
// GROUP_STATUS_RANK in orders.service.getOrderGroup so this strip and the
// group tracking screen always report the same phase.
const STATUS_RANK: Record<string, number> = {
  pending_payment: 0, paid: 1, confirmed: 2, preparing: 3, ready_for_pickup: 4,
  picked_up: 5, out_for_delivery: 6, delivered: 7, cancelled: 8,
};

function toEntries(rows: OrderRow[]): ActiveOrderEntry[] {
  const entries = [] as ActiveOrderEntry[];
  const byGroup = new Map<string, ActiveOrderEntry>();

  for (const row of rows) { // rows arrive newest-first
    if (FINAL_STATUSES.has(row.status)) continue;
    const itemCount = row.items.reduce((s, i) => s + i.quantity, 0);

    if (!row.groupId) {
      entries.push({
        key: row.id, orderId: row.id, status: row.status as OrderStatus,
        itemCount, totalPaise: row.totalAmount, orderCount: 1,
      });
      continue;
    }

    const existing = byGroup.get(row.groupId);
    if (!existing) {
      const entry: ActiveOrderEntry = {
        key: `group:${row.groupId}`, orderId: row.id, groupId: row.groupId,
        status: row.status as OrderStatus, itemCount,
        totalPaise: row.totalAmount, orderCount: 1,
      };
      byGroup.set(row.groupId, entry);
      entries.push(entry);
    } else {
      existing.orderCount += 1;
      existing.itemCount  += itemCount;
      existing.totalPaise += row.totalAmount;
      if ((STATUS_RANK[row.status] ?? 0) < (STATUS_RANK[existing.status] ?? 9)) {
        existing.status = row.status as OrderStatus;
      }
    }
  }
  return entries;
}

// Live "orders in flight" for the Home strip. Server state is the single source
// of truth (survives restarts, force-closes, and multi-device use): fetched on
// mount and app-foreground, then kept fresh by the user-room socket — every
// authenticated socket auto-joins user:{id} server-side, and order:status for
// ALL the customer's orders is emitted there (realtime.plugin emitToOrderAndUser),
// so no per-order subscribe bookkeeping is needed.
export interface ActiveOrdersState {
  entries:       ActiveOrderEntry[];
  // Socket health — drives the bubble's offline affordance.
  connected:     boolean;
  // Set the instant a `delivered` socket event is seen (before the order drops
  // out of the refetched list) so the bubble can play its delivered celebration.
  justDelivered: { orderId: string; at: number } | null;
  refresh:       () => Promise<void>;
}

// `enabled` lets a single app-root provider mount this unconditionally while
// staying inert (no fetch, no socket) until the customer is authenticated.
export function useActiveOrders(enabled: boolean = true): ActiveOrdersState {
  const [entries, setEntries] = useState<ActiveOrderEntry[]>([]);
  // Optimistic on mount so a healthy launch never flashes "reconnecting" before
  // the first connect lands; flipped false only on a real disconnect/error.
  const [connected, setConnected] = useState(true);
  const [justDelivered, setJustDelivered] = useState<{ orderId: string; at: number } | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (!enabled) return Promise.resolve();
    // Burst coalescing: mount, the tab's initial focus event and the socket's
    // first connect all fire within ~a second of each other — join the request
    // already in flight instead of stacking identical GETs.
    if (inFlightRef.current) return inFlightRef.current;
    const p = (async () => {
      try {
        const rows = (await api.getMyOrders({ page: 1, limit: 30 })) as unknown as OrderRow[];
        setEntries(toEntries(rows));
      } catch {
        // Best-effort surface: keep the last-known strip on a failed fetch. The
        // focus / foreground / socket-reconnect triggers below retry naturally.
      } finally {
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = p;
    return p;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      // Signed out / gated: drop any prior state and stay inert (no socket).
      setEntries([]);
      setConnected(true);
      setJustDelivered(null);
      return;
    }

    void refresh();

    // Coalesce socket bursts (a group's children transition together, and
    // reconnect fires alongside queued events) into one refetch.
    const scheduleRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => { void refresh(); }, 400);
    };

    let socket: Socket | null = null;
    let cancelled = false;
    void (async () => {
      const token = await StorageService.getAccessToken();
      if (!token || cancelled) return;
      socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] });
      // A `delivered` event arrives just before the order leaves the list — flag
      // it for the bubble's celebration, then refetch like any other transition.
      socket.on('order:status', (evt: { orderId?: string; status?: string }) => {
        if (evt?.status === OrderStatus.DELIVERED && evt.orderId) {
          setJustDelivered({ orderId: evt.orderId, at: Date.now() });
        }
        scheduleRefresh();
      });
      // REconnect ⇒ reconcile whatever was missed while offline/backgrounded.
      // The first connect races the mount fetch and is deliberately skipped.
      let everConnected = false;
      socket.on('connect', () => {
        setConnected(true);
        if (everConnected) scheduleRefresh();
        everConnected = true;
      });
      socket.on('disconnect', () => setConnected(false));
      // This socket lives for the whole session (Home stays mounted in the tab
      // navigator), so its handshake token can expire between reconnects. On a
      // failed attempt, re-read the current token for the next retry; the HTTP
      // fallbacks (focus/foreground refresh) keep the strip usable meanwhile.
      socket.on('connect_error', () => {
        setConnected(false);
        void StorageService.getAccessToken().then((fresh) => {
          if (socket && fresh) socket.auth = { token: fresh };
        });
      });
    })();

    // Foreground return ⇒ statuses may be stale; refetch immediately.
    const appStateSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh();
    });

    return () => {
      cancelled = true;
      appStateSub.remove();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      socket?.disconnect();
    };
  }, [enabled, refresh]);

  return { entries, connected, justDelivered, refresh };
}
