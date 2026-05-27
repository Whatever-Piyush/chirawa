import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { RiderApi } from '../services/api.service';
import {
  registerForPushNotifications,
  setupNotificationListeners,
} from '../services/notifications';
import { navigationRef } from '../navigation/ref';

export default function NotificationsBootstrap() {
  const { state } = useAuth();

  useEffect(() => {
    if (!state.isAuthenticated || !state.token || state.requiresPin) return;
    const jwt = state.token;
    let cancelled = false;

    void (async () => {
      const fcmToken = await registerForPushNotifications();
      if (cancelled || !fcmToken) return;
      try {
        await RiderApi.registerDeviceToken(fcmToken, jwt);
      } catch {
        // Best-effort — never block usage
      }
    })();

    return () => { cancelled = true; };
  }, [state.isAuthenticated, state.token, state.requiresPin]);

  useEffect(() => {
    return setupNotificationListeners(
      undefined,
      (response) => {
        const data = response.notification.request.content.data as
          | { orderId?: string; screen?: string; type?: string }
          | undefined;
        if (!data || !navigationRef.isReady()) return;
        // Bring rider into the main tabs (Delivery tab) on any tap
        navigationRef.navigate('MainTabs');
      },
    );
  }, []);

  return null;
}
