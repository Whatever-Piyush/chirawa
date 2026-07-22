import { OrderStatus } from '@chirawa/types';

// ── Live Order state model (Track_Order.md · Dynamic Status / Progress) ───────
// Pure, framework-free mapping from an order's status to what the floating
// LiveOrderBubble shows. It intentionally imports nothing but the status enum so
// it stays unit-testable without React Native. Colours are expressed as abstract
// "tones" (resolved to theme colours by the component) so this file never hard-
// codes a hex value.

// Abstract colour intent — the bubble maps these to ThemeContext palette colours.
export type LiveTone = 'primary' | 'success' | 'warning';

// The exact Ionicons glyphs the bubble uses per phase (no emoji, ever).
export type LiveIcon =
  | 'card-outline'
  | 'receipt-outline'
  | 'checkmark-circle'
  | 'cube-outline'
  | 'bag-check-outline'
  | 'bicycle-outline'
  | 'navigate'
  | 'checkmark-done-circle';

// step drives the 5-tick progress dial; captionKey is an i18n key under liveOrder.*
export interface LiveOrderState {
  step:       0 | 1 | 2 | 3 | 4;
  captionKey: string;
  icon:       LiveIcon;
  tone:       LiveTone;
}

// 9 OrderStatus values → the same 5 display phases the tracking screen uses
// (STATUS_STEP5), plus the two non-progress states (payment-due, cancelled).
const STATE_BY_STATUS: Record<OrderStatus, LiveOrderState> = {
  [OrderStatus.PENDING_PAYMENT]:  { step: 0, captionKey: 'liveOrder.paymentDue', icon: 'card-outline',          tone: 'warning' },
  [OrderStatus.PAID]:             { step: 0, captionKey: 'liveOrder.placed',     icon: 'receipt-outline',       tone: 'primary' },
  [OrderStatus.CONFIRMED]:        { step: 0, captionKey: 'liveOrder.accepted',   icon: 'checkmark-circle',      tone: 'primary' },
  [OrderStatus.PREPARING]:        { step: 1, captionKey: 'liveOrder.preparing',  icon: 'cube-outline',          tone: 'primary' },
  [OrderStatus.READY_FOR_PICKUP]: { step: 1, captionKey: 'liveOrder.packed',     icon: 'bag-check-outline',     tone: 'primary' },
  [OrderStatus.PICKED_UP]:        { step: 2, captionKey: 'liveOrder.pickedUp',   icon: 'bicycle-outline',       tone: 'primary' },
  [OrderStatus.OUT_FOR_DELIVERY]: { step: 3, captionKey: 'liveOrder.onTheWay',   icon: 'navigate',              tone: 'primary' },
  [OrderStatus.DELIVERED]:        { step: 4, captionKey: 'liveOrder.delivered',  icon: 'checkmark-done-circle', tone: 'success' },
  [OrderStatus.CANCELLED]:        { step: 0, captionKey: 'liveOrder.cancelled',  icon: 'receipt-outline',       tone: 'warning' },
};

export const TOTAL_TICKS = 5;

// Resolve the bubble's visual state for a status. Unknown/garbage statuses fall
// back to the earliest in-progress phase so the bubble never renders blank.
export function resolveLiveOrderState(status: OrderStatus): LiveOrderState {
  return STATE_BY_STATUS[status] ?? STATE_BY_STATUS[OrderStatus.PAID];
}

// How many of the 5 dial ticks are filled for a phase: one tick per phase, so
// even the first phase shows a little progress. Clamped defensively.
export function filledTicks(step: number): number {
  return Math.min(Math.max(Math.floor(step) + 1, 1), TOTAL_TICKS);
}

// Which active order the bubble features. The feed is newest-first, so the newest
// active order leads — the one the customer most recently acted on and is most
// likely looking for. Kept as a named function so the strategy is easy to change.
export function selectFeatured<T>(entries: readonly T[]): T | null {
  return entries.length > 0 ? entries[0] : null;
}

export function activeCount(entries: readonly unknown[]): number {
  return entries.length;
}
