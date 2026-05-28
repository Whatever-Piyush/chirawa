#!/usr/bin/env node
// Standalone FCM diagnostic — bypasses the api / order flow entirely.
// Reads the FCM service account from .env, pulls the seller's token from
// Redis, and tries to push a single test notification. Prints the Firebase
// error code verbatim on failure so we know exactly what's wrong.
//
// Usage:
//   node scripts/test-fcm-send.mjs              # pushes to seller (Sharma General Store)
//   node scripts/test-fcm-send.mjs <userId>     # pushes to any user

import 'dotenv/config';
import Redis from 'ioredis';
import admin from 'firebase-admin';

const SELLER_USER_ID = 'ef4b8ac7-0175-4ef5-849b-29f1ade23f7b'; // Sharma General Store / 9111111111

async function main() {
  const userId = process.argv[2] || SELLER_USER_ID;

  // 1. Verify FCM env
  const saRaw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!saRaw) {
    console.error('❌ FCM_SERVICE_ACCOUNT_JSON missing from .env');
    process.exit(1);
  }
  let sa;
  try {
    sa = JSON.parse(saRaw);
  } catch (e) {
    console.error('❌ FCM_SERVICE_ACCOUNT_JSON is not valid JSON:', e.message);
    process.exit(1);
  }
  console.log(`✓ Service account project: ${sa.project_id}`);
  console.log(`✓ Service account email  : ${sa.client_email}`);

  // 2. Pull the user's token from Redis
  const redis = new Redis(process.env.REDIS_URL || 'redis://:chirawa_redis_dev_password@localhost:6379');
  const token = await redis.get(`fcm:token:${userId}`);
  await redis.quit();

  if (!token) {
    console.error(`❌ No FCM token in Redis for user ${userId}.`);
    console.error('   The mobile app probably never reached registerForPushNotifications,');
    console.error('   or registration failed silently. Try logging out + back in.');
    process.exit(1);
  }
  console.log(`✓ Token in Redis  : ${token.slice(0, 24)}…  (${token.length} chars)`);

  // 3. Initialize firebase-admin
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  console.log(`✓ Firebase Admin initialized for project ${admin.app().options.projectId || sa.project_id}`);

  // 4. Send a single notification
  console.log('\nSending test notification...');
  try {
    const messageId = await admin.messaging().send({
      token,
      notification: {
        title: '🧪 Test from api',
        body:  'If you see this, FCM dispatch is working end-to-end.',
      },
      data: { type: 'TEST', orderId: 'test-order-id' },
      android: {
        priority: 'high',
        notification: {
          sound:     'default',
          channelId: 'chirawa_orders',
        },
      },
    });
    console.log('\n✅ FCM ACCEPTED THE MESSAGE');
    console.log(`   messageId: ${messageId}`);
    console.log('\nIf the notification did NOT appear on the phone:');
    console.log('  • Check Settings → Apps → (app name) → Notifications: enabled?');
    console.log('  • Make sure DND / focus mode is off');
    console.log('  • Channel "Order Updates" enabled inside the app\'s notification settings?');
    console.log('  • Try with the app in the background (not foreground)');
  } catch (err) {
    console.error('\n❌ FIREBASE REJECTED THE SEND');
    console.error(`   error.code   : ${err.code ?? '(none)'}`);
    console.error(`   error.message: ${err.message ?? '(none)'}`);
    if (err.errorInfo) console.error(`   errorInfo    :`, err.errorInfo);
    console.error('\nMost likely fixes by code:');
    console.error('  • messaging/invalid-registration-token → token is malformed; log out + back in');
    console.error('  • messaging/registration-token-not-registered → token expired or app uninstalled');
    console.error('  • messaging/sender-id-mismatch → google-services.json is for a different Firebase project than the service account');
    console.error('  • messaging/third-party-auth-error → service account lacks Firebase Messaging API permission');
    console.error('  • app/invalid-credential → service account key is revoked / wrong project');
    process.exit(2);
  }
}

main().catch((e) => { console.error('Unhandled:', e); process.exit(99); });
