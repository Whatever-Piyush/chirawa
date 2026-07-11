import type { RecoveryNeedState, RecoveryOfferOutcome } from '@prisma/client';

// ─── Seller Sprint 5 Phase A — recovery domain constants ──────────────────────
// Single source of truth for the recovery state machine (Architecture §12), the
// audit event vocabulary (§17), and the recovery-aware per-line fulfillment
// statuses (§11). Pure data — no I/O — so it is unit-testable in isolation.

// Allowed Recovery Need transitions (Architecture §12). A need may additionally
// move to `cancelled` from any non-terminal state (the parent order is cancelled
// mid-recovery — §22). Terminal states have no outgoing transitions.
export const NEED_TRANSITIONS: Record<RecoveryNeedState, readonly RecoveryNeedState[]> = {
  open:      ['searching', 'cancelled'],
  searching: ['offered', 'exhausted', 'cancelled'],
  offered:   ['accepted', 'searching', 'exhausted', 'cancelled'],
  accepted:  ['ready', 'cancelled'],
  ready:     ['picked_up', 'cancelled'],
  picked_up: ['fulfilled', 'cancelled'],
  fulfilled: [],
  exhausted: ['refunded'],
  refunded:  [],
  cancelled: [],
};

// States from which no transition is possible (Architecture §12).
export const TERMINAL_NEED_STATES: readonly RecoveryNeedState[] = ['fulfilled', 'refunded', 'cancelled'];

export function canTransitionNeed(from: RecoveryNeedState, to: RecoveryNeedState): boolean {
  return NEED_TRANSITIONS[from].includes(to);
}

// The Need transition an offer outcome drives (Architecture §12): acceptance
// commits the need; a rejection or timeout returns it to searching to advance.
export const OFFER_OUTCOME_TO_NEED_STATE: Record<Exclude<RecoveryOfferOutcome, 'pending'>, RecoveryNeedState> = {
  accepted:  'accepted',
  rejected:  'searching',
  timed_out: 'searching',
};

// Immutable recovery event record types emitted in Phase A (Architecture §17).
// Later phases add hold_*, materialization, route_insertion, attribution,
// reconciliation, and refund events — deliberately NOT defined here.
export const RecoveryEventType = {
  LineClaimed:   'line_claimed',
  NeedOpened:    'need_opened',
  StateChanged:  'state_changed',
  OfferSent:     'offer_sent',
  OfferAccepted: 'offer_accepted',
  OfferRejected: 'offer_rejected',
  OfferTimedOut: 'offer_timed_out',
} as const;

export const OFFER_OUTCOME_EVENT: Record<Exclude<RecoveryOfferOutcome, 'pending'>, string> = {
  accepted:  RecoveryEventType.OfferAccepted,
  rejected:  RecoveryEventType.OfferRejected,
  timed_out: RecoveryEventType.OfferTimedOut,
};

// Recovery-aware per-line fulfillment statuses (Architecture §11). Extends the
// existing OrderItem.fulfillmentStatus vocabulary ('fulfilled',
// 'unavailable_refunded') with the two recovery values. Defined here so the domain
// vocabulary exists in Phase A; the seller intake that SETS these on order items
// is a later phase (S5.6) and is NOT wired here.
export const FulfillmentStatus = {
  Fulfilled:           'fulfilled',
  Recovering:          'recovering',
  RecoveredElsewhere:  'recovered_elsewhere',
  UnavailableRefunded: 'unavailable_refunded',
} as const;
