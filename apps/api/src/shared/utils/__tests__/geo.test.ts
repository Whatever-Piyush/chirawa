import { describe, it, expect } from 'vitest';
import { pointInPolygon, haversineMeters, polygonCentroid, type LatLng } from '../geo';

// A ~1km square around Chirawa town centre.
const square: LatLng[] = [
  { lat: 28.230, lng: 75.625 },
  { lat: 28.230, lng: 75.636 },
  { lat: 28.240, lng: 75.636 },
  { lat: 28.240, lng: 75.625 },
];

describe('pointInPolygon', () => {
  it('returns true for a point inside the polygon', () => {
    expect(pointInPolygon({ lat: 28.235, lng: 75.630 }, square)).toBe(true);
  });
  it('returns false for a point outside the polygon', () => {
    expect(pointInPolygon({ lat: 28.250, lng: 75.650 }, square)).toBe(false);
  });
  it('returns false for a degenerate polygon (< 3 vertices)', () => {
    expect(pointInPolygon({ lat: 28.235, lng: 75.630 }, square.slice(0, 2))).toBe(false);
  });
});

describe('haversineMeters', () => {
  it('is ~0 for identical points', () => {
    expect(haversineMeters({ lat: 28.233, lng: 75.630 }, { lat: 28.233, lng: 75.630 })).toBeCloseTo(0, 5);
  });
  it('measures a known short distance within tolerance', () => {
    // ~0.01° latitude ≈ 1.11 km
    const d = haversineMeters({ lat: 28.230, lng: 75.630 }, { lat: 28.240, lng: 75.630 });
    expect(d).toBeGreaterThan(1050);
    expect(d).toBeLessThan(1160);
  });
  it('detects two points within the 800m batching radius', () => {
    const d = haversineMeters({ lat: 28.2330, lng: 75.6307 }, { lat: 28.2360, lng: 75.6320 });
    expect(d).toBeLessThan(800);
  });
});

describe('polygonCentroid', () => {
  it('returns the average vertex of the square', () => {
    const c = polygonCentroid(square);
    expect(c.lat).toBeCloseTo(28.235, 3);
    expect(c.lng).toBeCloseTo(75.6305, 3);
  });
});
