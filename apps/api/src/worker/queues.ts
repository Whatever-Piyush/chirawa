export const QueueNames = {
  SETTLEMENT:      'chirawa-settlement',
  RECONCILIATION:  'chirawa-reconciliation',
  CLEANUP:         'chirawa-cleanup',
  REFERRAL:        'chirawa-referral',
  NOTIFICATION:    'chirawa-notification',
  ORDER_ASSIGNMENT: 'chirawa-order-assignment',
} as const;

export const JobNames = {
  ASSIGN_BATCH:          'assign-batch',
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
