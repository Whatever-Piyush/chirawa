// Reverse-geocoding with a layered fallback so a real street/area name shows on
// every pin drag and on "current location":
//   1. Google Geocoding REST API (most accurate for Chirawa / Indian addresses)
//   2. native expo-location reverse geocoder (works even if the Maps key doesn't
//      have the Geocoding API enabled yet)
// The pin's coordinates are always exact; this only resolves the readable text.
import * as Location from 'expo-location';
import { GOOGLE_MAPS_API_KEY } from '../config/maps';

export interface ResolvedAddress {
  title:    string;   // most specific line (locality / area / road)
  subtitle: string;   // full formatted address
  locality: string;   // area / neighbourhood
  city:     string;
  pincode:  string;
}

interface GeocodeComponent {
  long_name:  string;
  short_name: string;
  types:      string[];
}
interface GeocodeResult {
  formatted_address: string;
  address_components: GeocodeComponent[];
}
interface GeocodeResponse {
  status:  string;
  results: GeocodeResult[];
}

const PINCODE = '333026'; // Chirawa fallback

function pick(components: GeocodeComponent[], type: string): string | undefined {
  return components.find((c) => c.types.includes(type))?.long_name;
}

async function googleGeocode(lat: number, lng: number): Promise<ResolvedAddress> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}` +
    `&key=${GOOGLE_MAPS_API_KEY}&language=en&region=in`;

  const res = await fetch(url);
  const json = (await res.json()) as GeocodeResponse;
  if (json.status !== 'OK' || json.results.length === 0) {
    throw new Error(`Google geocode failed: ${json.status}`);
  }

  const best = json.results[0];
  const c = best.address_components;

  const area =
    pick(c, 'sublocality_level_1') ?? pick(c, 'sublocality') ??
    pick(c, 'neighborhood') ?? pick(c, 'route') ?? '';
  const city =
    pick(c, 'locality') ?? pick(c, 'administrative_area_level_3') ??
    pick(c, 'administrative_area_level_2') ?? 'Chirawa';
  const pincode = pick(c, 'postal_code') ?? PINCODE;

  const title = area || city || c[0]?.long_name || 'Chirawa';
  const subtitle = best.formatted_address.replace(/, India$/, '');

  return { title, subtitle, locality: area || city, city, pincode };
}

async function nativeGeocode(lat: number, lng: number): Promise<ResolvedAddress> {
  const hits = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
  const g = hits[0];
  if (!g) throw new Error('Native geocode returned nothing');

  const area = g.name || g.street || g.district || g.subregion || '';
  const city = g.city || g.subregion || g.region || 'Chirawa';
  const parts = [g.name || g.street, g.district, g.subregion || g.city, g.region]
    .filter((p): p is string => Boolean(p))
    .filter((p, i, arr) => p !== arr[i - 1]);

  return {
    title:    area || city || 'Chirawa',
    subtitle: g.formattedAddress || parts.join(', ') || (area || city),
    locality: area || city,
    city,
    pincode:  g.postalCode || PINCODE,
  };
}

/**
 * Resolve lat/lng → a readable address. Tries Google, then the native geocoder.
 * Throws only if BOTH fail (caller supplies the last-resort label).
 */
export async function reverseGeocode(lat: number, lng: number): Promise<ResolvedAddress> {
  try {
    return await googleGeocode(lat, lng);
  } catch {
    return await nativeGeocode(lat, lng); // throws if this also fails
  }
}
