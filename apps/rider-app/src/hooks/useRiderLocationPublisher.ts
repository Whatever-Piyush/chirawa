// Rider location publishing (Milestone R1) — while this rider carries at least
// one live order, watch the device position and emit `rider:location` on the
// EXISTING DeliveryScreen socket, once per active order per fix. The backend
// (realtime.plugin.ts) authorizes each emit against the rider's active
// DeliveryAssignment and rebroadcasts as `order:location` to the order room.
// Cadence ~8s / 25m at balanced accuracy; Redis presence TTL is 30s, so a
// dropped fix is tolerated — never queue stale ones (volatile emits).
//
// Android keeps publishing while the rider navigates in Google Maps via a
// location foreground service (while-in-use permission only — we never ask
// for ACCESS_BACKGROUND_LOCATION). Other platforms use a foreground watcher.
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { Socket } from 'socket.io-client';
import { Colors } from '../theme';

const LOCATION_TASK = 'rider-location-publish';

// Orders in a terminal state must never receive emits. The server keeps a
// delivered order's assignment active (only cancellation deactivates it), so
// this client-side filter is what actually stops post-delivery pings.
const TERMINAL_STATUSES = ['delivered', 'cancelled'];

// ~8s / 25m — the cadence the backend expects (see realtime.plugin.ts).
const WATCH_OPTIONS: Location.LocationOptions = {
  accuracy:         Location.Accuracy.Balanced,
  timeInterval:     8000,
  distanceInterval: 25,
};

interface Fix { lat: number; lng: number; timestamp: number }

// ── Module-level wiring ──────────────────────────────────────────────────────
// The TaskManager executor runs outside React, so the active hook instance
// registers a sink here — same module-callback pattern as api.service's
// setAuthFailureHandler.
let deliverFix: ((fix: Fix) => void) | null = null;

// Mirror of the HomeScreen online/offline toggle. HomeScreen writes it (initial
// load + toggle); the publisher subscribes so going offline mid-batch stops
// emits without the two sibling tab screens sharing React state.
let riderOnline = false;
const onlineListeners = new Set<() => void>();

export function setRiderOnline(online: boolean): void {
  if (riderOnline === online) return;
  riderOnline = online;
  onlineListeners.forEach((notify) => notify());
}

function subscribeOnline(notify: () => void): () => void {
  onlineListeners.add(notify);
  return () => { onlineListeners.delete(notify); };
}

// Must be defined in module scope (expo-task-manager rule) — this file is
// statically imported by DeliveryScreen, so it evaluates at app start.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error) return;
    const last = data?.locations?.[data.locations.length - 1];
    if (last) {
      deliverFix?.({ lat: last.coords.latitude, lng: last.coords.longitude, timestamp: last.timestamp });
    }
  },
);

// ── Hook ─────────────────────────────────────────────────────────────────────

interface PublishableOrder { id: string; status: string }

export function useRiderLocationPublisher(
  socketRef: RefObject<Socket | null>,
  orders: readonly PublishableOrder[],
): { locationBlocked: boolean } {
  const online    = useSyncExternalStore(subscribeOnline, () => riderOnline);
  const activeIds = orders.filter((o) => !TERMINAL_STATUSES.includes(o.status)).map((o) => o.id);

  // Emits read the CURRENT ids from a ref so a status change mid-batch doesn't
  // restart the location stream (and its foreground service) on every render.
  const idsRef   = useRef(activeIds);
  idsRef.current = activeIds;

  const shouldPublish = online && activeIds.length > 0;
  const [blocked,    setBlocked]    = useState(false);
  // Bumped when the app foregrounds while blocked — re-checks permission after
  // the rider returns from Settings. (An Android revoke kills the process
  // instead, so that path re-enters through a cold start.)
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!shouldPublish) { setBlocked(false); return; }

    let cancelled = false;
    let watcher: Location.LocationSubscription | null = null;

    const publish = (fix: Fix): void => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) return; // drop, never queue a stale fix
      for (const orderId of idsRef.current) {
        socket.volatile.emit('rider:location', {
          orderId, lat: fix.lat, lng: fix.lng, timestamp: fix.timestamp,
        });
      }
    };

    const stopBackgroundTask = (): void => {
      void Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)
        .then((started) => (started ? Location.stopLocationUpdatesAsync(LOCATION_TASK) : undefined))
        .catch(() => {});
    };

    void (async () => {
      try {
        // While-in-use only — deliberately NOT requestBackgroundPermissionsAsync.
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') { setBlocked(true); return; }

        deliverFix = publish;
        if (Platform.OS === 'android') {
          // Foreground service keeps fixes flowing while the rider navigates in
          // Google Maps. Needs a binary built with expo-task-manager and
          // isAndroidForegroundServiceEnabled (app.json).
          await Location.startLocationUpdatesAsync(LOCATION_TASK, {
            ...WATCH_OPTIONS,
            foregroundService: {
              notificationTitle:    'Bringly delivery chalu hai',
              notificationBody:     'Customer aapko map pe live dekh sakta hai',
              notificationColor:    Colors.primary,
              killServiceOnDestroy: true, // app swiped away → service dies with it
            },
          });
          if (cancelled) { stopBackgroundTask(); return; }
        } else {
          watcher = await Location.watchPositionAsync(
            WATCH_OPTIONS,
            (loc) => publish({ lat: loc.coords.latitude, lng: loc.coords.longitude, timestamp: loc.timestamp }),
            () => { if (!cancelled) setBlocked(true); },
          );
          if (cancelled) { watcher.remove(); watcher = null; return; }
        }
        setBlocked(false);
      } catch {
        // Location services off, or Android refused the foreground service
        // (start attempted while backgrounded) — show the banner, retry on focus.
        if (!cancelled) setBlocked(true);
      }
    })();

    return () => {
      cancelled = true;
      if (deliverFix === publish) deliverFix = null;
      watcher?.remove();
      watcher = null;
      stopBackgroundTask();
    };
  }, [shouldPublish, retryNonce, socketRef]);

  useEffect(() => {
    if (!blocked || !shouldPublish) return;
    const sub = AppState.addEventListener('change', (appState) => {
      if (appState === 'active') setRetryNonce((n) => n + 1);
    });
    return () => sub.remove();
  }, [blocked, shouldPublish]);

  return { locationBlocked: blocked && shouldPublish };
}
