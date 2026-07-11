import { env } from '../../config/env';
import { serviceLogger } from '../../shared/observability/logger';

const log = serviceLogger('fcm');

// Lazy-initialize Firebase Admin SDK
// If FCM_SERVICE_ACCOUNT_JSON is empty/invalid → dev mode (logged only)
let _messaging: unknown = null;
let _initialized       = false;

function isFcmConfigured(): boolean {
  try {
    const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON) as Record<string, unknown>;
    return typeof sa['project_id'] === 'string' && sa['project_id'].length > 0;
  } catch {
    return false;
  }
}

async function getMessaging(): Promise<unknown> {
  if (_initialized) return _messaging;
  _initialized = true;

  if (!isFcmConfigured()) {
    log.warn('FCM not configured — notifications will be logged only (dev mode)');
    return null;
  }

  try {
    const admin = await import('firebase-admin');
    const sa    = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);

    if (!admin.apps?.length) {
      admin.initializeApp({ credential: admin.credential.cert(sa as object) });
    }

    _messaging = admin.messaging();
  } catch (err) {
    log.error({ err }, 'Failed to initialize Firebase Admin');
  }

  return _messaging;
}

// ── Notification payload ───────────────────────────────────────────────────────

export interface FcmPayload {
  token:   string;
  title:   string;
  body:    string;
  data?:   Record<string, string>;
  // Android channel for sound/vibration control
  channel?: 'chirawa_orders' | 'chirawa_alerts' | 'chirawa_general';
}

// ── Send single notification ──────────────────────────────────────────────────

export async function sendPush(payload: FcmPayload): Promise<void> {
  const messaging = await getMessaging();

  if (!messaging) {
    // Dev mode — log what would be sent
    log.info(
      { token: `${payload.token.slice(0, 20)}...`, title: payload.title, body: payload.body, data: payload.data },
      '[DEV FCM] push (not sent — FCM unconfigured)',
    );
    return;
  }

  try {
    const admin = await import('firebase-admin');
    const msg   = (admin.messaging as () => { send: (m: object) => Promise<string> })();

    const messageId = await msg.send({
      token:        payload.token,
      notification: { title: payload.title, body: payload.body },
      data:         payload.data ?? {},
      android: {
        priority: 'high',
        notification: {
          sound:     'default',
          channelId: payload.channel ?? 'chirawa_orders',
          // No clickAction — letting Android use the default launcher Intent
          // is what expo-notifications' native module is registered to handle,
          // so the tap launches the app and the JS response listener fires.
          // FLUTTER_NOTIFICATION_CLICK (the old value here) is Flutter-only and
          // matches no intent-filter in our Expo Manifest, so Android was just
          // dismissing the notification on tap with no app launch.
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    });
    log.info(
      { title: payload.title, token: `${payload.token.slice(0, 16)}…`, messageId: messageId.split('/').pop() },
      'FCM sent',
    );
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };
    // Token invalid/expired — log but don't crash
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      log.warn({ code: error.code, title: payload.title }, 'FCM token invalid — token will need re-registration');
      return;
    }
    log.error({ code: error.code ?? 'unknown', err, title: payload.title }, 'FCM send failed');
  }
}

// ── Send to multiple tokens (multicast) ──────────────────────────────────────

export async function sendPushMulti(
  tokens:  string[],
  title:   string,
  body:    string,
  data?:   Record<string, string>,
  channel?: FcmPayload['channel'],
): Promise<void> {
  if (!tokens.length) return;

  await Promise.allSettled(
    tokens.map((token) =>
      // Spread optional fields conditionally — exactOptionalPropertyTypes rejects
      // an explicit `undefined` for FcmPayload's optional properties.
      sendPush({
        token, title, body,
        ...(data ? { data } : {}),
        ...(channel ? { channel } : {}),
      }),
    ),
  );
}
