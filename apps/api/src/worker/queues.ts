import type { JobsOptions } from 'bullmq';

// ── Standard job policy (P1-8) ────────────────────────────────────────────────
// Applied as defaultJobOptions on EVERY queue (worker/index.ts +
// shared/plugins/queue.plugin.ts). Before this, jobs ran with attempts: 1 and
// several producers set removeOnFail: true — a transient Redis/DB blip turned
// into a lost auto-accept or an unassigned batch with no trace to debug.
//
//   attempts 5 × exponential from 5s → 5s, 10s, 20s, 40s, 80s (~2.5 min total):
//     rides out restarts/blips; every processor here is idempotent (CAS
//     transitions, SET NX claims), so re-runs are safe.
//   removeOnComplete: bounded history for inspection, then gone.
//   removeOnFail: KEEP failures 7 days — failed jobs are evidence, not litter.
//
// Per-add overrides still apply for special cases (e.g. auto-accept's
// removeOnComplete: true, which frees its deterministic jobId for re-arming).
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff:  { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 500 },
  removeOnFail:     { age: 7 * 24 * 3600, count: 1000 },
} as const satisfies JobsOptions;

export const QueueNames = {
  SETTLEMENT:      'chirawa-settlement',
  RECONCILIATION:  'chirawa-reconciliation',
  CLEANUP:         'chirawa-cleanup',
  NOTIFICATION:    'chirawa-notification',
  ORDER_ASSIGNMENT: 'chirawa-order-assignment',
  SELLER_ACCEPT:    'chirawa-seller-accept',
  ENRICHMENT:       'chirawa-enrichment',
} as const;

export const JobNames = {
  ASSIGN_BATCH:          'assign-batch',
  AUTO_ACCEPT:           'auto-accept',
  DAILY_SETTLEMENT:      'daily-settlement',
  SINGLE_SELLER_SETTLE:  'single-seller-settle',
  PAYOUT_RECONCILE:      'payout-reconcile',
  PAYMENT_RECONCILE:     'payment-reconcile',
  LOCATION_CLEANUP:      'location-cleanup',
  OTP_CLEANUP:           'otp-cleanup',
  CART_CLEANUP:          'cart-cleanup',
  TOKEN_CLEANUP:         'token-cleanup',
  SEND_PUSH:             'send-push',
  SEND_SMS:              'send-sms',
  CATALOG_ENRICH:        'catalog-enrich',
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
