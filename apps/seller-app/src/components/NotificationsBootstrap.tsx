import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../context/AuthContext';
import { SellerApi } from '../services/api.service';
import {
  registerForPushNotifications,
  setupNotificationListeners,
} from '../services/notifications';
import { navigationRef } from '../navigation/ref';

type NotificationData = { orderId?: string; screen?: string; type?: string } | undefined;

function handleNotificationTap(data: NotificationData): void {
  if (!data || !navigationRef.isReady()) return;

  // Delivered → seller's earnings/settlement view.
  if (data.screen === 'Settlement') {
    navigationRef.navigate('MainTabs', { screen: 'Settlement' });
    return;
  }
  // New order, paid, cancelled, etc. → orders queue. If the notification carries
  // an orderId (it always does for order-related pushes), pass it through so the
  // queue can pop the Accept/Reject modal for that specific order on arrival.
  navigationRef.navigate('MainTabs', {
    screen: 'Orders',
    params: data.orderId ? { orderId: data.orderId } : undefined,
  });
}

function dispatchWhenReady(data: NotificationData, isCancelled: () => boolean): void {
  if (navigationRef.isReady()) {
    handleNotificationTap(data);
    return;
  }
  const intervalId = setInterval(() => {
    if (isCancelled()) { clearInterval(intervalId); return; }
    if (navigationRef.isReady()) {
      clearInterval(intervalId);
      handleNotificationTap(data);
    }
  }, 50);
  setTimeout(() => clearInterval(intervalId), 8000);
}

export default function NotificationsBootstrap() {
  const { state }              = useAuth();
  const coldStartConsumedRef   = useRef(false);

  useEffect(() => {
    if (!state.isAuthenticated || !state.token || state.requiresPin) return;
    const jwt = state.token;
    let cancelled = false;

    void (async () => {
      const fcmToken = await registerForPushNotifications();
      if (cancelled || !fcmToken) return;
      try {
        await SellerApi.registerDeviceToken(fcmToken, jwt);
      } catch {
        // Best-effort — never block usage
      }
    })();

    return () => { cancelled = true; };
  }, [state.isAuthenticated, state.token, state.requiresPin]);

  // Foreground / background tap
  useEffect(() => {
    return setupNotificationListeners(
      undefined,
      (response) => {
        const data = response.notification.request.content.data as NotificationData;
        handleNotificationTap(data);
      },
    );
  }, []);

  // Cold-start tap — flush once the seller is past the auth+PIN gate.
  useEffect(() => {
    if (!state.isAuthenticated || state.requiresPin || coldStartConsumedRef.current) return;
    let cancelled = false;

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (cancelled || !response) return;
      coldStartConsumedRef.current = true;
      const data = response.notification.request.content.data as NotificationData;
      dispatchWhenReady(data, () => cancelled);
    });

    return () => { cancelled = true; };
  }, [state.isAuthenticated, state.requiresPin]);

  return null;
}
