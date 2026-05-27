import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api.service';
import {
  registerForPushNotifications,
  setupNotificationListeners,
} from '../services/notifications';
import { navigationRef } from '../navigation/ref';

export default function NotificationsBootstrap() {
  const { state } = useAuth();

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

  // Notification tap → navigate to the relevant screen
  useEffect(() => {
    return setupNotificationListeners(
      undefined,
      (response) => {
        const data = response.notification.request.content.data as
          | { orderId?: string; screen?: string }
          | undefined;
        if (!data || !navigationRef.isReady()) return;

        if (data.orderId && (data.screen === 'OrderTracking' || !data.screen)) {
          navigationRef.navigate('OrderTracking', { orderId: data.orderId });
        }
      },
    );
  }, []);

  return null;
}
