// ─── Operating hours — Chirawa launch ─────────────────────────────────────────
// Bringly delivers 8:00 AM – 9:00 PM IST. Orders outside this window are rejected
// at checkout. Browsing is unaffected (this is only enforced at order creation).
// Single source of truth for the backend; the customer app mirrors these values.

export const OPERATING_HOURS = {
  openHour: 8, // 08:00 IST — first deliverable hour
  closeHour: 21, // 21:00 IST — orders allowed strictly before this (last window 20:59)
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

/** True if the given moment is within delivery hours (08:00–20:59 IST). */
export function isWithinOperatingHours(date: Date = new Date()): boolean {
  const hour = currentISTHour(date);
  return hour >= OPERATING_HOURS.openHour && hour < OPERATING_HOURS.closeHour;
}

/** Human-friendly window, e.g. "8 AM – 9 PM" (used in error messages/UI). */
export const OPERATING_HOURS_LABEL = '8 AM – 9 PM';
