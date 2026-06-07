export const QueueNames = {
  SETTLEMENT:      'chirawa-settlement',
  RECONCILIATION:  'chirawa-reconciliation',
  CLEANUP:         'chirawa-cleanup',
  REFERRAL:        'chirawa-referral',
  NOTIFICATION:    'chirawa-notification',
  ORDER_ASSIGNMENT: 'chirawa-order-assignment',
  SELLER_ACCEPT:    'chirawa-seller-accept',
} as const;

export const JobNames = {
  ASSIGN_BATCH:          'assign-batch',
  AUTO_ACCEPT:           'auto-accept',
  DAILY_SETTLEMENT:      'daily-settlement',
  SINGLE_SELLER_SETTLE:  'single-seller-settle',
  PAYMENT_RECONCILE:     'payment-reconcile',
  LOCATION_CLEANUP:      'location-cleanup',
  OTP_CLEANUP:           'otp-cleanup',
  CART_CLEANUP:          'cart-cleanup',
  TOKEN_CLEANUP:         'token-cleanup',
  UNLOCK_REFERRAL:       'unlock-referral',
  SEND_PUSH:             'send-push',
  SEND_SMS:              'send-sms',
} as const;

export interface AssignBatchPayload {
  batchId: string;
  attempt: number;   // 1-based retry counter
}

export interface AutoAcceptPayload {
  orderId: string;
}

// Seller acceptance window (Chunk 8.2). Shared so the API-tier timer
// (seller-timeout.plugin) and the worker (reconciliation.job) always agree.
export const SELLER_ACCEPT_MS = Number(process.env.SELLER_ACCEPT_MS ?? 180_000); // 3 min

// Deterministic auto-accept job id. Both the API timer and the worker may try to
// schedule auto-accept for the same order; a stable jobId makes BullMQ dedupe so
// only one job is ever created per order.
export const autoAcceptJobId = (orderId: string): string => `auto-accept:${orderId}`;

export interface SingleSellerSettlePayload {
  sellerProfileId: string;
  shopId:          string;
  periodDate:      string;
}

export interface UnlockReferralPayload {
  orderId:        string;
  referredUserId: string;
}

export interface SendPushPayload {
  userId:   string;
  title:    string;
  body:     string;
  data?:    Record<string, string>;
  channel?: string;
}

export interface SendSmsPayload {
  phone:   string;
  message: string;
}
