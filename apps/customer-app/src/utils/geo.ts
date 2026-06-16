// Chirawa service-area geofence. Distances in the address UI are measured from
// the town centre; serviceability is decided by `isInsideServiceArea`.
//
// v3: a 3 km radius around the town core. Built to swap to an exact polygon the
// moment `CHIRAWA_POLYGON` is supplied — callers use `isInsideServiceArea()` and
// never need to change.
export const CHIRAWA_CENTER = { lat: 28.240303949239777, lng: 75.64655776908275 };
export const SERVICE_RADIUS_KM = 3;

// Exact serviceable boundary, as [lng, lat] pairs forming a closed ring. Leave
// null to use the radius; drop in the real coordinates later to switch to a
// precise point-in-polygon test — no other code changes needed.
export const CHIRAWA_POLYGON: ReadonlyArray<readonly [number, number]> | null = null;

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

// Ray-casting point-in-polygon. ring is [lng, lat] pairs (GeoJSON order).
function pointInPolygon(lat: number, lng: number, ring: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; // lng, lat
    const [xj, yj] = ring[j];
    const intersect =
      (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Is a point inside Chirawa's serviceable area? Uses the exact polygon when one
 * is configured, otherwise the radius. Single source of truth for the geofence.
 */
export function isInsideServiceArea(lat: number, lng: number): boolean {
  if (CHIRAWA_POLYGON && CHIRAWA_POLYGON.length >= 3) {
    return pointInPolygon(lat, lng, CHIRAWA_POLYGON);
  }
  return kmFromChirawa(lat, lng) <= SERVICE_RADIUS_KM;
}
