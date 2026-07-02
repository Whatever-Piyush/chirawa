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

/**
 * Current wall-clock time in Asia/Kolkata as "HH:MM" (00–23), independent of
 * server timezone. Shop open/close times ("09:00") are IST wall-clock strings,
 * so anything comparing against them must use THIS — never Date#getHours(),
 * which on the UTC production host shifts every comparison by +5:30 (P1-4).
 */
export function currentISTTimeHHMM(date: Date = new Date()): string {
  // en-GB keeps hour12:false in the 00–23 range (en-US can yield "24:xx").
  return date.toLocaleTimeString('en-GB', {
    timeZone: OPERATING_HOURS.timezone,
    hour:     '2-digit',
    minute:   '2-digit',
  });
}

/** Human-friendly window, e.g. "9 AM – 8 PM" (used in error messages/UI). */
export const OPERATING_HOURS_LABEL = '9 AM – 8 PM';
