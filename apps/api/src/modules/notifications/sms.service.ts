import { env } from '../../config/env';
import { serviceLogger } from '../../shared/observability/logger';

const log = serviceLogger('sms');

function isSmsConfigured(): boolean {
  return env.FAST2SMS_API_KEY !== 'placeholder';
}

// ── Send transactional SMS ────────────────────────────────────────────────────
// Used ONLY for critical events: delivery confirmed, refund issued
// Routine notifications use FCM (free) — SMS costs ₹0.20 each
//
// DLT readiness (Phase 5): route 'q' (quick) below is the PRE-DLT route — fine
// for testing, not TRAI-compliant for production transactional traffic. Once
// DLT registration completes (entity → sender-ID header → content templates,
// then upload to Fast2SMS "DLT Manager" for message IDs — see
// docs/PRODUCTION_READINESS_CHECKLIST.md §5), swap this call per the verified
// Fast2SMS bulkV2 contract (docs.fast2sms.com/reference/dlt-sms):
//   route: 'dlt', sender_id: '<approved 3-6 letter header>',
//   message: '<approved Message ID>', variables_values: 'a|b|c' (pipe-sep)
// The SmsTemplates below must be registered VERBATIM (variables as {#var#});
// each then sends its template ID + variables instead of rendered text.
// OTP login is unaffected: otp.service uses route 'otp', which rides
// Fast2SMS's own DLT-approved template — no customer registration needed.

export async function sendSms(phone: string, message: string): Promise<void> {
  if (!isSmsConfigured()) {
    log.info({ phone, message }, '[DEV SMS] not sent — Fast2SMS unconfigured');
    return;
  }

  try {
    const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method:  'POST',
      headers: {
        authorization:  env.FAST2SMS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        route:    'q',        // Quick route — no DLT needed in test mode
        message,
        language: 'english',
        flash:    0,
        numbers:  phone,
      }),
    });

    if (!response.ok) {
      log.error({ status: response.status, body: await response.text() }, 'Fast2SMS error');
    }
  } catch (err) {
    // SMS failure is NEVER fatal — FCM is the primary channel
    log.error({ err }, 'SMS send failed (non-fatal)');
  }
}

// ── Message templates ─────────────────────────────────────────────────────────

export const SmsTemplates = {
  orderDelivered: (orderTotal: number) =>
    `Chirawa Delivery: Aapka order pahunch gaya! ₹${Math.round(orderTotal / 100)} ka order deliver ho gaya. Thank you!`,

  orderCancelled: () =>
    `Chirawa Delivery: Aapka order cancel ho gaya. Koi problem hai toh support se baat karein.`,

  refundIssued: (amount: number) =>
    `Chirawa Delivery: Aapko ₹${Math.round(amount / 100)} ka refund issue ho gaya. 1-3 din mein wapas aa jayega.`,

  settlementPaid: (amount: number) =>
    `Chirawa Delivery: Aaj ka payment ₹${Math.round(amount / 100)} aapke account mein transfer ho gaya!`,
};
