import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList:   true,
    shouldPlaySound:  true,
    shouldSetBadge:   true,
  }),
});

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('chirawa_orders', {
    name:             'Delivery Updates',
    importance:       Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor:       '#27AE60',
    sound:            'default',
  });

  await Notifications.setNotificationChannelAsync('chirawa_alerts', {
    name:             'New Delivery Alerts',
    importance:       Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 500, 200, 500],
    lightColor:       '#27AE60',
    sound:            'default',
    bypassDnd:        true,
  });

  await Notifications.setNotificationChannelAsync('chirawa_general', {
    name:       'General',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: '#27AE60',
    sound:      'default',
  });
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('[FCM] Push notifications require a physical device');
    return null;
  }

  const existing = await Notifications.getPermissionsAsync();
  let status     = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') {
    console.warn('[FCM] Notification permission not granted');
    return null;
  }

  await ensureAndroidChannels();

  try {
    const tokenData = await Notifications.getDevicePushTokenAsync();
    return tokenData.data as string;
  } catch (err) {
    console.error('[FCM] Failed to fetch device token:', err);
    return null;
  }
}

export function setupNotificationListeners(
  onReceived?: (notification: Notifications.Notification) => void,
  onTapped?:   (response: Notifications.NotificationResponse) => void,
): () => void {
  const receivedSub = Notifications.addNotificationReceivedListener((n) => {
    onReceived?.(n);
  });
  const responseSub = Notifications.addNotificationResponseReceivedListener((r) => {
    onTapped?.(r);
  });
  return () => {
    receivedSub.remove();
    responseSub.remove();
  };
}
