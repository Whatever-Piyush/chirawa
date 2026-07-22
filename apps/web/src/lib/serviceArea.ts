// Chirawa service-area geofence — ported from apps/customer-app/src/utils/geo.ts.
// Keep the centre/radius in sync with that file. Serviceability is decided by
// `isInsideServiceArea` (coords) or `isServiceablePincode` (manual entry).

export const CHIRAWA_CENTER = { lat: 28.240303949239777, lng: 75.64655776908275 };
export const SERVICE_RADIUS_KM = 3;

// Serviceable pincodes for manual entry. Chirawa town is 333026; the 3 km radius
// means only the town core is in-area today. Add neighbour pincodes here as the
// delivery zone expands (see plan §8 — neighbour list still to be confirmed).
export const SERVICEABLE_PINCODES: ReadonlySet<string> = new Set(['333026']);

/** A syntactically valid Indian pincode (6 digits, no leading zero). */
export function isValidPincode(pincode: string): boolean {
  return /^[1-9][0-9]{5}$/.test(pincode.trim());
}

export function isServiceablePincode(pincode: string): boolean {
  return SERVICEABLE_PINCODES.has(pincode.trim());
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in kilometres between two lat/lng points (haversine). */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // earth radius (km)
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Distance from the Chirawa service centre to a point, in km. */
export function kmFromChirawa(lat: number, lng: number): number {
  return distanceKm(CHIRAWA_CENTER.lat, CHIRAWA_CENTER.lng, lat, lng);
}

/** Is a lat/lng inside Chirawa's serviceable radius? */
export function isInsideServiceArea(lat: number, lng: number): boolean {
  return kmFromChirawa(lat, lng) <= SERVICE_RADIUS_KM;
}
