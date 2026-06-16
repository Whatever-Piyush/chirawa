import { env } from '../../config/env';
import type { ReverseGeocodeResult, PlacePrediction, PlaceDetailsResult } from '@chirawa/types';

// Reverse-geocode proxy. The Google Geocoding key lives ONLY here (server-side);
// the client never sees it. We build the request, call Google, then post-process
// to a small, Plus-Code-free address — exactly the secure-proxy pattern Google
// recommends for mobile clients.

const GEOCODE_URL = (lat: number, lng: number, key: string): string =>
  'https://maps.googleapis.com/maps/api/geocode/json'
  + `?latlng=${lat},${lng}&language=en&region=in&key=${encodeURIComponent(key)}`;

const FETCH_TIMEOUT_MS = 4000;

// Open Location Code (Plus Code) token, e.g. "6JVX+3C". Its alphabet excludes
// 0/1/A/E/I/L/O/U; a code is base-20 chars + '+' + 2–3 more. We must never show
// one as a street/area — that's the bug this whole change fixes.
const PLUS_CODE_RE = /\b[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\b/i;

export function isPlusCode(s: string | null | undefined): boolean {
  return !!s && PLUS_CODE_RE.test(s.trim());
}

// "6JVX+3C, Shyampura, Rajasthan" → "Shyampura, Rajasthan"
function stripPlusCodePrefix(s: string): string {
  return s.replace(/^\s*[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\s*,?\s*/i, '').trim();
}

interface GoogleComponent { long_name: string; short_name: string; types: string[] }
interface GoogleResult { formatted_address?: string; types?: string[]; address_components?: GoogleComponent[] }
interface GoogleResponse { status?: string; results?: GoogleResult[] }

// First component (across results) matching any wanted type and not a Plus Code.
function pick(results: GoogleResult[], wanted: string[]): string | null {
  for (const r of results) {
    for (const c of r.address_components ?? []) {
      if (c.types.some((t) => wanted.includes(t)) && !isPlusCode(c.long_name)) {
        return c.long_name;
      }
    }
  }
  return null;
}

// Pure parser over Google results — exported for unit testing.
export function parseGoogleResults(results: GoogleResult[]): ReverseGeocodeResult {
  // Drop Plus-Code-only results (types include 'plus_code') — not real addresses.
  const usable = results.filter((r) => !(r.types ?? []).includes('plus_code'));
  const pool = usable.length > 0 ? usable : results;

  const area = pick(pool, ['sublocality_level_1', 'sublocality', 'neighborhood'])
            ?? pick(pool, ['locality']);
  const street  = pick(pool, ['route']);
  const city    = pick(pool, ['locality', 'administrative_area_level_3', 'administrative_area_level_2']);
  const state   = pick(pool, ['administrative_area_level_1']);
  const pincode = pick(pool, ['postal_code']);

  const firstFmt  = pool.find((r) => r.formatted_address)?.formatted_address ?? null;
  const formatted = firstFmt ? stripPlusCodePrefix(firstFmt) : null;

  const cleanArea = area && !isPlusCode(area) ? area : null;
  const anything  = cleanArea || street || city || pincode || formatted;
  return {
    area: cleanArea,
    street, city, state, pincode, formatted,
    source: anything ? 'google' : 'none',
  };
}

export interface ReverseGeocodeDeps { fetchImpl?: typeof fetch }

const NONE: ReverseGeocodeResult = {
  area: null, street: null, city: null, state: null, pincode: null, formatted: null, source: 'none',
};

export async function reverseGeocode(
  input: { lat: number; lng: number },
  deps: ReverseGeocodeDeps = {},
): Promise<ReverseGeocodeResult> {
  const key = env.GOOGLE_MAPS_API_KEY;
  // No real key configured → let the client fall back to its on-device geocoder.
  if (!key || key === 'placeholder') return NONE;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(GEOCODE_URL(input.lat, input.lng, key), { signal: ctrl.signal });
    if (!res.ok) return NONE;
    const json = (await res.json()) as GoogleResponse;
    if (json.status !== 'OK' || !json.results || json.results.length === 0) return NONE;
    return parseGoogleResults(json.results);
  } catch {
    // Network / timeout / parse error → graceful "none"; never throw into a request.
    return NONE;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Place search — Places API (New), hard-restricted to Chirawa ──────────────
// The app serves only Chirawa for now, so search must surface ONLY Chirawa-area
// matches. We use `locationRestriction` (a circle around the town) which Google
// guarantees excludes results outside it — never another city/state.

const CHIRAWA_CENTER = { lat: 28.240303949239777, lng: 75.64655776908275 };
const SEARCH_RADIUS_M = 15000; // ~15 km: town + nearby villages
const PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACES_DETAILS_URL = (id: string): string =>
  `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`;

function toRad(d: number): number { return (d * Math.PI) / 180; }
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371, dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

interface PlacesAutoResp {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
      text?: { text?: string };
      distanceMeters?: number;
    };
  }>;
}

export async function autocompletePlaces(
  input: { q: string; sessionToken: string },
  deps: ReverseGeocodeDeps = {},
): Promise<PlacePrediction[]> {
  const key = env.GOOGLE_MAPS_API_KEY;
  if (!key || key === 'placeholder') return [];

  const fetchImpl = deps.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(PLACES_AUTOCOMPLETE_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask':
          'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.distanceMeters',
      },
      body: JSON.stringify({
        input: input.q,
        sessionToken: input.sessionToken,
        includedRegionCodes: ['in'],
        // Hard restriction → results outside this circle are NOT returned.
        locationRestriction: {
          circle: {
            center: { latitude: CHIRAWA_CENTER.lat, longitude: CHIRAWA_CENTER.lng },
            radius: SEARCH_RADIUS_M,
          },
        },
        origin: { latitude: CHIRAWA_CENTER.lat, longitude: CHIRAWA_CENTER.lng },
      }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as PlacesAutoResp;
    return (json.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => !!p && !!p.placeId)
      .map((p) => ({
        placeId:       p.placeId!,
        primaryText:   p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
        distanceKm:    typeof p.distanceMeters === 'number' ? Math.round(p.distanceMeters / 100) / 10 : null,
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

interface PlacesDetailsResp {
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; types?: string[] }>;
}

export async function placeDetails(
  input: { placeId: string; sessionToken: string },
  deps: ReverseGeocodeDeps = {},
): Promise<PlaceDetailsResult | null> {
  const key = env.GOOGLE_MAPS_API_KEY;
  if (!key || key === 'placeholder') return null;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${PLACES_DETAILS_URL(input.placeId)}?sessionToken=${encodeURIComponent(input.sessionToken)}`;
    const res = await fetchImpl(url, {
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'location,formattedAddress,addressComponents',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as PlacesDetailsResp;
    const lat = json.location?.latitude, lng = json.location?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;

    const comp = (wanted: string[]): string | null => {
      for (const c of json.addressComponents ?? []) {
        if ((c.types ?? []).some((t) => wanted.includes(t)) && c.longText && !isPlusCode(c.longText)) return c.longText;
      }
      return null;
    };
    return {
      lat, lng,
      area:      comp(['sublocality_level_1', 'sublocality', 'neighborhood']) ?? comp(['locality']),
      city:      comp(['locality', 'administrative_area_level_3', 'administrative_area_level_2']),
      pincode:   comp(['postal_code']),
      formatted: json.formattedAddress ? stripPlusCodePrefix(json.formattedAddress) : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
