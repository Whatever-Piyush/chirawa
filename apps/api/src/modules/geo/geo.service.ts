import { env } from '../../config/env';
import type { ReverseGeocodeResult } from '@chirawa/types';

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
