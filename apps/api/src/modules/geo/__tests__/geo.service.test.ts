import { describe, it, expect } from 'vitest';
import { isPlusCode, parseAutosuggest, parseRevGeocode } from '../geo.service';

describe('isPlusCode', () => {
  it('flags Open Location Codes and ignores normal text', () => {
    expect(isPlusCode('6JVX+3C')).toBe(true);
    expect(isPlusCode('6JVX+3C, Shyampura')).toBe(true);
    expect(isPlusCode('Shyampura')).toBe(false);
    expect(isPlusCode('Purani Basti')).toBe(false);
    expect(isPlusCode(null)).toBe(false);
  });
});

describe('parseAutosuggest', () => {
  it('maps Mappls suggestions, using eLoc as placeId and distance for the km chip', () => {
    // Shapes mirror the live API: eLoc + placeName + placeAddress + distance(m),
    // and crucially NO latitude/longitude.
    const out = parseAutosuggest([
      { eLoc: '6SD6D2', placeName: 'Chirawa Railway Station', placeAddress: 'Sarvodaya Colony, Chirawa, Rajasthan, 333026', distance: 1909 },
    ]);
    expect(out).toHaveLength(1);
    const [p] = out;
    expect(p!.placeId).toBe('6SD6D2');
    expect(p!.primaryText).toBe('Chirawa Railway Station');
    expect(p!.secondaryText).toBe('Sarvodaya Colony, Chirawa, Rajasthan, 333026');
    expect(p!.distanceKm).toBe(1.9);
  });

  it('hard-filters results beyond the 15 km Chirawa radius (e.g. Chirala AP)', () => {
    const out = parseAutosuggest([
      { eLoc: 'NEAR01', placeName: 'Chirawa',  distance: 533 },
      { eLoc: '2ULOGN', placeName: 'Chirala',  distance: 1462197 }, // ~1462 km
    ]);
    expect(out.map((p) => p.primaryText)).toEqual(['Chirawa']);
  });

  it('skips suggestions without an eLoc and keeps a null distance', () => {
    const out = parseAutosuggest([
      { placeName: 'No eLoc' },
      { eLoc: 'NODIST', placeName: 'No distance' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.placeId).toBe('NODIST');
    expect(out[0]!.distanceKm).toBeNull();
  });
});

describe('parseRevGeocode', () => {
  it('maps the first Mappls result, building area from sub-locality (NOT the country `area` field)', () => {
    const out = parseRevGeocode([
      {
        formatted_address: 'Main Market Road, Gandhi Chowk, Shyampura, Chirawa, Rajasthan. Pin-333026 (India)',
        street: 'Main Market Road',
        subLocality: 'Gandhi Chowk',
        locality: 'Shyampura',
        city: 'Chirawa',
        state: 'Rajasthan',
        pincode: '333026',
      },
    ]);
    expect(out.area).toBe('Gandhi Chowk');
    expect(out.street).toBe('Main Market Road');
    expect(out.city).toBe('Chirawa');
    expect(out.state).toBe('Rajasthan');
    expect(out.pincode).toBe('333026');
    expect(out.source).toBe('mappls');
  });

  it('falls back to locality for the area when sub-locality is absent', () => {
    const out = parseRevGeocode([{ locality: 'Shyampura', city: 'Chirawa' }]);
    expect(out.area).toBe('Shyampura');
  });

  it('returns source "none" for empty results', () => {
    expect(parseRevGeocode([]).source).toBe('none');
  });

  it('never surfaces a Plus Code as the area', () => {
    const out = parseRevGeocode([{ subLocality: '6JVX+3C', city: 'Chirawa' }]);
    expect(out.area).toBeNull();
    expect(out.city).toBe('Chirawa');
  });
});
