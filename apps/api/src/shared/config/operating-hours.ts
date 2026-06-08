// ─── Operating hours — Chirawa launch ─────────────────────────────────────────
// Bringly services 9:00 AM – 8:00 PM IST (closed 8 PM – 9 AM). Orders outside this
// window are rejected at checkout. Browsing is unaffected (this is only enforced at
// order creation). Single source of truth for the backend; the customer app mirrors.

export const OPERATING_HOURS = {
  openHour: 9, // 09:00 IST — first deliverable hour
  closeHour: 20, // 20:00 IST / 8 PM — orders allowed strictly before this (last window 19:59)
  timezone: 'Asia/Kolkata',
} as const;

/** Current hour (0–23) in Asia/Kolkata, independent of server timezone. */
export function currentISTHour(date: Date = new Date()): number {
  const hourStr = date.toLocaleString('en-US', {
    timeZone: OPERATING_HOURS.timezone,
    hour: '2-digit',
    hour12: false,
  });
  // 'en-US' with hour12:false can return "24" at midnight — normalise to 0.
  const hour = parseInt(hourStr, 10) % 24;
  return Number.isFinite(hour) ? hour : 0;
}

/** True if the given moment is within delivery hours (09:00–19:59 IST). */
export function isWithinOperatingHours(date: Date = new Date()): boolean {
  const hour = currentISTHour(date);
  return hour >= OPERATING_HOURS.openHour && hour < OPERATING_HOURS.closeHour;
}

/** Human-friendly window, e.g. "9 AM – 8 PM" (used in error messages/UI). */
export const OPERATING_HOURS_LABEL = '9 AM – 8 PM';
