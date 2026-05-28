import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api.service';
import {
  registerForPushNotifications,
  setupNotificationListeners,
} from '../services/notifications';
import { navigationRef } from '../navigation/ref';

type NotificationData = { orderId?: string; screen?: string } | undefined;

function handleNotificationTap(data: NotificationData): void {
  if (!data || !navigationRef.isReady()) return;

  // Delivered / cancelled notifications point at the order-history tab.
  if (data.screen === 'OrderHistory') {
    navigationRef.navigate('MainTabs', { screen: 'OrderHistory' });
    return;
  }
  // Anything order-related with an orderId opens the live tracking screen.
  if (data.orderId) {
    navigationRef.navigate('OrderTracking', { orderId: data.orderId });
    return;
  }
  // Fallback — drop the user on the orders tab.
  navigationRef.navigate('MainTabs', { screen: 'OrderHistory' });
}

// On cold-start `navigationRef.isReady()` is false until NavigationContainer
// mounts. Poll briefly so the deep-link survives the boot race.
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

  // Register FCM token whenever the user becomes authenticated
  useEffect(() => {
    if (!state.isAuthenticated) return;
    let cancelled = false;

    void (async () => {
      const token = await registerForPushNotifications();
      if (cancelled || !token) return;
      try {
        await api.registerDeviceToken({ token, platform: 'android' });
      } catch {
        // Token registration is best-effort — never block app usage
      }
    })();

    return () => { cancelled = true; };
  }, [state.isAuthenticated]);

  // Foreground / background tap → navigate based on the notification's data
  useEffect(() => {
    return setupNotificationListeners(
      undefined,
      (response) => {
        const data = response.notification.request.content.data as NotificationData;
        handleNotificationTap(data);
      },
    );
  }, []);

  // Cold-start tap (app was killed when the user tapped the notification).
  // Wait until the user is authenticated so OrderTracking is in the stack.
  useEffect(() => {
    if (!state.isAuthenticated || coldStartConsumedRef.current) return;
    let cancelled = false;

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (cancelled || !response) return;
      coldStartConsumedRef.current = true;
      const data = response.notification.request.content.data as NotificationData;
      dispatchWhenReady(data, () => cancelled);
    });

    return () => { cancelled = true; };
  }, [state.isAuthenticated]);

  return null;
}
