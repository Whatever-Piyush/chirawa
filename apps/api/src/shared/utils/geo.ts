// Geospatial helpers for rider dispatch (Chunk 5). Chirawa is a ~3 km town, so
// flat-earth math is plenty accurate — no need for a GIS library.

export interface LatLng { lat: number; lng: number }

// Ray-casting point-in-polygon. `polygon` is an ordered ring of vertices
// (first/last need not repeat). Returns true if the point is inside.
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.lng, yi = polygon[i]!.lat;
    const xj = polygon[j]!.lng, yj = polygon[j]!.lat;
    const intersect =
      (yi > point.lat) !== (yj > point.lat) &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Great-circle distance in metres between two coordinates (Haversine).
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000; // earth radius, metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Centroid (average vertex) of a polygon — used to rank zones by proximity when
// a delivery point falls outside every zone boundary.
export function polygonCentroid(polygon: LatLng[]): LatLng {
  const sum = polygon.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / polygon.length, lng: sum.lng / polygon.length };
}
