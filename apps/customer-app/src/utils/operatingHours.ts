// Operating hours mirror the backend (apps/api/src/shared/config/operating-hours.ts).
// Bringly delivers 8 AM – 9 PM. Chirawa users' phones run on IST, so the device's
// local hour is the right basis for the UI. The backend is the authoritative gate —
// it rejects out-of-hours orders regardless of what the device clock says.

export const OPEN_HOUR = 8; // 08:00
export const CLOSE_HOUR = 21; // 21:00 (last order window 20:59)
export const OPERATING_HOURS_LABEL = '8 AM – 9 PM';

export function isOpenNow(date: Date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}
