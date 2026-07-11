// Operating hours mirror the backend (apps/api/src/shared/config/operating-hours.ts).
// Bringly services 9 AM – 8 PM (closed 8 PM – 9 AM). Chirawa users' phones run on
// IST, so the device's local hour is the right basis for the UI. The backend is the
// authoritative gate — it rejects out-of-hours orders regardless of the device clock.
//
// BUILDING PHASE: set EXPO_PUBLIC_ALWAYS_OPEN=true in apps/customer-app/.env and
// rebuild — the app then treats the store as always open (24/7). The default
// (flag unset) is the real launch hours, and the value is baked at BUILD time, so
// a production build without the flag is correct automatically. To go live: remove
// the env line and rebuild. Keep this in step with the backend's OPERATING_HOURS_*.

export const OPEN_HOUR = 9; // 09:00
export const CLOSE_HOUR = 20; // 20:00 / 8 PM (last order window 19:59)
export const OPERATING_HOURS_LABEL = '9 AM – 8 PM';

// EXPO_PUBLIC_* env vars are inlined by Expo/Metro at build time (SDK 54).
const ALWAYS_OPEN = process.env.EXPO_PUBLIC_ALWAYS_OPEN === 'true';

export function isOpenNow(date: Date = new Date()): boolean {
  if (ALWAYS_OPEN) return true;
  const hour = date.getHours();
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}
