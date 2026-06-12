// Operating hours mirror the backend (apps/api/src/shared/config/operating-hours.ts).
// Bringly services 9 AM – 8 PM (closed 8 PM – 9 AM). Chirawa users' phones run on
// IST, so the device's local hour is the right basis for the UI. The backend is the
// authoritative gate — it rejects out-of-hours orders regardless of the device clock.

export const OPEN_HOUR = 9; // 09:00
export const CLOSE_HOUR = 20; // 20:00 / 8 PM (last order window 19:59)
export const OPERATING_HOURS_LABEL = '9 AM – 8 PM';

export function isOpenNow(date: Date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}
