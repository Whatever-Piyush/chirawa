import { env } from '../../config/env';

// Lazy-initialize Firebase Admin SDK
// If FCM_SERVICE_ACCOUNT_JSON is empty/invalid → dev mode (console.log only)
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
    console.warn('⚠️  FCM not configured — notifications will be logged only (dev mode)');
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
    console.error('Failed to initialize Firebase Admin:', err);
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
    // Dev mode — print what would be sent
    console.log(`\n📱 [DEV FCM] → ${payload.token.slice(0, 20)}...`);
    console.log(`   Title: ${payload.title}`);
    console.log(`   Body:  ${payload.body}`);
    if (payload.data) console.log(`   Data:  ${JSON.stringify(payload.data)}`);
    return;
  }

  try {
    const admin = await import('firebase-admin');
    const msg   = (admin.messaging as () => { send: (m: object) => Promise<string> })();

    await msg.send({
      token:        payload.token,
      notification: { title: payload.title, body: payload.body },
      data:         payload.data ?? {},
      android: {
        priority: 'high',
        notification: {
          sound:     'default',
          channelId: payload.channel ?? 'chirawa_orders',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
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
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };
    // Token invalid/expired — log but don't crash
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      console.warn(`FCM token invalid for payload: ${payload.title}`);
      return;
    }
    console.error('FCM send failed:', error.message);
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
      sendPush({ token, title, body, data, channel }),
    ),
  );
}
