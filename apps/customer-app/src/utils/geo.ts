// Chirawa town centre — our service area origin. Distances in the address UI are
// measured from here (matches the "X km away" chips users see).
export const CHIRAWA_CENTER = { lat: 28.2330, lng: 75.6307 };

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in kilometres between two lat/lng points (haversine). */
export function distanceKm(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
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
