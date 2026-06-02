import { describe, it, expect } from 'vitest';
import { pickZone, pickBestRider, type ZoneLite, type RiderCandidate } from '../dispatch.service';

const square = (latMin: number, latMax: number, lngMin: number, lngMax: number) => [
  { lat: latMin, lng: lngMin }, { lat: latMin, lng: lngMax },
  { lat: latMax, lng: lngMax }, { lat: latMax, lng: lngMin },
];

const zones: ZoneLite[] = [
  { id: 'central', name: 'Central', polygon: square(28.233, 28.242, 75.626, 75.636) },
  { id: 'south',   name: 'South',   polygon: square(28.224, 28.233, 75.626, 75.636) },
  { id: 'east',    name: 'East',    polygon: square(28.233, 28.242, 75.636, 75.646) },
];

describe('pickZone', () => {
  it('returns the zone containing the point', () => {
    expect(pickZone(zones, { lat: 28.237, lng: 75.630 })?.id).toBe('central');
    expect(pickZone(zones, { lat: 28.228, lng: 75.630 })?.id).toBe('south');
  });
  it('falls back to the nearest zone when the point is outside all polygons', () => {
    // Far north-east of every zone → nearest by centroid is "east".
    expect(pickZone(zones, { lat: 28.250, lng: 75.650 })?.id).toBe('east');
  });
  it('returns null when there are no zones', () => {
    expect(pickZone([], { lat: 28.237, lng: 75.630 })).toBeNull();
  });
});

describe('pickBestRider', () => {
  const riders: RiderCandidate[] = [
    { riderProfileId: 'r1', userId: 'u1', activeCount: 2 },
    { riderProfileId: 'r2', userId: 'u2', activeCount: 0 },
    { riderProfileId: 'r3', userId: 'u3', activeCount: 1 },
  ];
  it('picks the rider with the fewest active deliveries', () => {
    expect(pickBestRider(riders)?.riderProfileId).toBe('r2');
  });
  it('returns null when there are no candidates', () => {
    expect(pickBestRider([])).toBeNull();
  });
  it('is stable on ties (first wins)', () => {
    const tied: RiderCandidate[] = [
      { riderProfileId: 'a', userId: 'ua', activeCount: 1 },
      { riderProfileId: 'b', userId: 'ub', activeCount: 1 },
    ];
    expect(pickBestRider(tied)?.riderProfileId).toBe('a');
  });
});
