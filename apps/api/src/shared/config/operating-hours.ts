// ─── Operating hours — Chirawa ────────────────────────────────────────────────
// Bringly delivers 9:00 AM – 8:00 PM IST at launch; orders outside the window are
// rejected at checkout. Browsing is unaffected (this is only enforced at order
// creation). Single source of truth for the backend gate; the customer app
// mirrors it (apps/customer-app/src/utils/operatingHours.ts).
//
// The window is ENV-OVERRIDABLE so the building phase can run 24/7 without a code
// change — but the DEFAULT is the real launch hours, so a production deploy with
// NO override is correct automatically (the fail-safe direction):
//   • 24/7 (building phase):  OPERATING_HOURS_OPEN=0  OPERATING_HOURS_CLOSE=24
//   • launch (default):       leave both unset  → 9 AM – 8 PM IST
// To go live: remove the two env lines (or set them to 9 / 20) and restart.

// Parse an hour-of-day env override (0–24). Anything missing/invalid falls back
// to the launch default, so a typo can never silently open or close the store.
export function hourFromEnv(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 24 ? n : fallback;
}

export const OPERATING_HOURS = {
  openHour:  hourFromEnv(process.env.OPERATING_HOURS_OPEN, 9),   // 09:00 IST — first deliverable hour
  closeHour: hourFromEnv(process.env.OPERATING_HOURS_CLOSE, 20), // 20:00 IST / 8 PM — orders allowed strictly before this
  timezone:  'Asia/Kolkata',
};

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

/** True if the given moment is within delivery hours (default 09:00–19:59 IST). */
export function isWithinOperatingHours(date: Date = new Date()): boolean {
  // Load-test harness override (scripts/loadtest, scripts/smoke) so checkout
  // scenarios can run at any wall-clock hour — IMPOSSIBLE in production, like the
  // OTP dev bypass. (The building-phase 24/7 knob is OPERATING_HOURS_OPEN/CLOSE
  // above, which by design DOES work in production — it is business config, not a
  // test bypass.)
  if (process.env.NODE_ENV !== 'production' && process.env.OPERATING_HOURS_DISABLED === 'true') {
    return true;
  }
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

// 12-hour label for a 0–24 hour, e.g. 9 → "9 AM", 20 → "8 PM", 0/24 → "12 AM".
function fmtHour(h: number): string {
  const hr = ((h % 24) + 24) % 24;
  const period = hr < 12 ? 'AM' : 'PM';
  const h12 = hr % 12 === 0 ? 12 : hr % 12;
  return `${h12} ${period}`;
}

/** Human-friendly window for error messages/UI — tracks the configured hours. */
export const OPERATING_HOURS_LABEL =
  OPERATING_HOURS.openHour <= 0 && OPERATING_HOURS.closeHour >= 24
    ? '24/7'
    : `${fmtHour(OPERATING_HOURS.openHour)} – ${fmtHour(OPERATING_HOURS.closeHour)}`;
