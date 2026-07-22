'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

// Live order tracking socket (mirrors OrderTrackingScreen): connect to the
// backend origin with the short-lived access token from /api/auth/socket-token
// (fetched per (re)connect via the auth callback, so reconnects after token
// expiry self-heal), subscribe to the order room, forward events. The caller
// keeps a 15s poll as fallback — realtime needs the backend socket CORS
// allowlist (plan Task 16).

const SOCKET_URL = (process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export interface OrderEtaEvent {
  orderId: string;
  secondsRemaining: number;
  spreadSeconds: number;
  serverNow: string;
  source: string;
}

export interface OrderSocketHandlers {
  onStatus?: (p: { orderId: string; status: string }) => void;
  onLocation?: (p: { orderId: string; lat: number; lng: number }) => void;
  onEta?: (p: OrderEtaEvent) => void;
  onItemUnavailable?: (p: {
    orderId: string;
    productName: string;
    refundedPaise: number;
    cancelled: boolean;
    suggestion?: string;
  }) => void;
  onConnected?: (connected: boolean) => void;
}

export function useOrderSocket(orderId: string | null, handlers: OrderSocketHandlers): void {
  // Handlers live in a ref so socket bindings always call the latest render's
  // closures without tearing the connection down.
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    if (!orderId) return;

    const socket: Socket = io(SOCKET_URL, {
      transports: ['websocket'],
      auth: (cb) => {
        fetch('/api/auth/socket-token', { cache: 'no-store' })
          .then((r) => (r.ok ? (r.json() as Promise<{ token: string }>) : Promise.reject(new Error())))
          .then((d) => cb({ token: d.token }))
          .catch(() => cb({}));
      },
    });

    socket.on('connect', () => {
      h.current.onConnected?.(true);
      socket.emit('order:subscribe', orderId);
    });
    socket.on('disconnect', () => h.current.onConnected?.(false));
    socket.on('connect_error', () => h.current.onConnected?.(false));

    socket.on('order:status', (p: { orderId: string; status: string }) => {
      if (p.orderId === orderId) h.current.onStatus?.(p);
    });
    socket.on('order:location', (p: { orderId: string; lat: number; lng: number }) => {
      if (p.orderId === orderId) h.current.onLocation?.(p);
    });
    socket.on('order:eta', (p: OrderEtaEvent) => {
      if (p.orderId === orderId) h.current.onEta?.(p);
    });
    socket.on(
      'order:item-unavailable',
      (p: { orderId: string; productName: string; refundedPaise: number; cancelled: boolean; suggestion?: string }) => {
        if (p.orderId === orderId) h.current.onItemUnavailable?.(p);
      },
    );

    return () => {
      socket.emit('order:unsubscribe', orderId);
      socket.disconnect();
    };
  }, [orderId]);
}
