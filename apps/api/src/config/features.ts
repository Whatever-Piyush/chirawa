import { env } from './env';

// COD-only launch (Phase 5, founder decision): online payment stays fully wired
// (Razorpay service, webhook, verify, refunds) but is NOT offered to customers
// until this flag flips. Enforcement lives server-side — placeOrder rejects
// non-COD methods and payment-order creation refuses — because the app's
// "coming soon" UI (customer-app FEATURES.onlinePayments) is cosmetic, not a
// security boundary.
//
// To launch online payments later:
//   1. Real RAZORPAY_* creds in the server .env (env:check hard-fails
//      placeholders once this flag is 'true').
//   2. PAYMENTS_ONLINE_ENABLED=true + restart api & worker.
//   3. Ship a customer-app build with FEATURES.onlinePayments = true.
export function onlinePaymentsEnabled(): boolean {
  return env.PAYMENTS_ONLINE_ENABLED === 'true';
}
