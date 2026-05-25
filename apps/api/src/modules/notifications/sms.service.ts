import { env } from '../../config/env';

function isSmsConfigured(): boolean {
  return env.FAST2SMS_API_KEY !== 'placeholder';
}

// ── Send transactional SMS ────────────────────────────────────────────────────
// Used ONLY for critical events: delivery confirmed, refund issued
// Routine notifications use FCM (free) — SMS costs ₹0.20 each

export async function sendSms(phone: string, message: string): Promise<void> {
  if (!isSmsConfigured()) {
    console.log(`\n📨 [DEV SMS] → ${phone}`);
    console.log(`   Message: ${message}`);
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
      console.error('Fast2SMS error:', await response.text());
    }
  } catch (err) {
    // SMS failure is NEVER fatal — FCM is the primary channel
    console.error('SMS send failed (non-fatal):', err);
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
