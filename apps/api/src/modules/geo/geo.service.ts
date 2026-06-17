import { env } from '../../config/env';
import type { ReverseGeocodeResult, PlacePrediction, PlaceDetailsResult } from '@chirawa/types';

// ─── Mappls (MapmyIndia) geo proxy ────────────────────────────────────────────
// All Mappls credentials live ONLY here (server-side); the client only ever talks
// to /geo/*. The app serves Chirawa only, so search is biased to the town and
// then hard-filtered to a 15 km radius using the `distance` Mappls returns.
//
// Auth: client_id/secret → a ~24 h OAuth bearer token (Autosuggest, atlas.mappls).
//       REST key in the URL path (rev_geocode, apis.mappls/advancedmaps).
// Any placeholder credential ⇒ the matching call returns empty/none so the app
// falls back to its on-device geocoder (never throws into a request).
//
// Endpoint shapes below were verified against the LIVE Mappls API (2026-06-17):
//   • Autosuggest returns eLoc + placeName + placeAddress + distance, but NOT
//     coordinates, and the free tier has no coordinate-returning Place Detail /
//     forward-geocode API (those are premium). See placeDetails() for the
//     consequence (map opens at the Chirawa-centre default on a pick).

const CHIRAWA_CENTER = { lat: 28.240303949239777, lng: 75.64655776908275 };
const SEARCH_RADIUS_M = 15000; // ~15 km: town + nearby villages
const FETCH_TIMEOUT_MS = 4000;

const TOKEN_URL = 'https://outpost.mappls.com/api/security/oauth/token';
const AUTOSUGGEST_URL = 'https://atlas.mappls.com/api/places/search/json';
const REV_GEOCODE_URL = (key: string): string =>
  `https://apis.mappls.com/advancedmaps/v1/${encodeURIComponent(key)}/rev_geocode`;

export interface GeoDeps { fetchImpl?: typeof fetch }

// Open Location Code (Plus Code) token, e.g. "6JVX+3C". Mappls returns real
// addresses, but we keep the guard so a stray Plus Code never leaks as an area.
const PLUS_CODE_RE = /\b[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\b/i;

export function isPlusCode(s: string | null | undefined): boolean {
  return !!s && PLUS_CODE_RE.test(s.trim());
}

function stripPlusCodePrefix(s: string): string {
  return s.replace(/^\s*[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\s*,?\s*/i, '').trim();
}

const isPlaceholder = (v: string | undefined): boolean => !v || v === 'placeholder';

// ─── OAuth token (cached ~24 h) ───────────────────────────────────────────────

interface MapplsTokenResp { access_token?: string; token_type?: string; expires_in?: number }

let cachedToken: { header: string; expiresAt: number } | null = null;

// Exposed for tests — clears the module-level token cache between cases.
export function __resetTokenCache(): void { cachedToken = null; }

// Returns the `Authorization` header value ("<token_type> <access_token>"), or
// null when credentials are unset or the token call fails.
async function getAuthHeader(deps: GeoDeps): Promise<string | null> {
  if (isPlaceholder(env.MAPPLS_CLIENT_ID) || isPlaceholder(env.MAPPLS_CLIENT_SECRET)) return null;

  const now = Date.now();
  // 60 s safety margin so we never use a token that's about to expire mid-request.
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.header;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const body = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     env.MAPPLS_CLIENT_ID,
      client_secret: env.MAPPLS_CLIENT_SECRET,
    });
    const res = await fetchImpl(TOKEN_URL, {
      method:  'POST',
      signal:  ctrl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as MapplsTokenResp;
    if (!json.access_token) return null;
    const header = `${json.token_type ?? 'bearer'} ${json.access_token}`;
    cachedToken = { header, expiresAt: now + (json.expires_in ?? 3600) * 1000 };
    return header;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Autosuggest (place search) ───────────────────────────────────────────────

interface MapplsSuggestion {
  eLoc?:         string;
  placeName?:    string;
  placeAddress?: string;
  distance?:     number; // metres from the `location` we pass (Chirawa centre)
}
interface MapplsAutosuggestResp { suggestedLocations?: MapplsSuggestion[] }

// Pure parser (exported for unit tests): maps Mappls suggestions → predictions.
// placeId is the raw eLoc (resolved later by placeDetails). Anything beyond the
// 15 km Chirawa radius is dropped — Mappls only *biases* to `location`, so we
// enforce the radius ourselves using the `distance` it returns.
export function parseAutosuggest(suggestions: MapplsSuggestion[]): PlacePrediction[] {
  const out: PlacePrediction[] = [];
  for (const s of suggestions) {
    if (!s.eLoc) continue;
    const m = typeof s.distance === 'number' ? s.distance : null;
    if (m !== null && m > SEARCH_RADIUS_M) continue; // hard Chirawa-only filter

    out.push({
      placeId:       s.eLoc,
      primaryText:   s.placeName ?? s.placeAddress ?? '',
      secondaryText: s.placeAddress ?? '',
      distanceKm:    m !== null ? Math.round(m / 100) / 10 : null,
    });
  }
  return out;
}

export async function autocompletePlaces(
  input: { q: string; sessionToken: string },
  deps: GeoDeps = {},
): Promise<PlacePrediction[]> {
  const header = await getAuthHeader(deps);
  if (!header) return [];

  const fetchImpl = deps.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // `location` biases to Chirawa AND makes Mappls return `distance` (used to
    // both rank and hard-filter to the service area).
    const url = `${AUTOSUGGEST_URL}?query=${encodeURIComponent(input.q)}`
      + `&location=${CHIRAWA_CENTER.lat},${CHIRAWA_CENTER.lng}`;
    const res = await fetchImpl(url, { headers: { Authorization: header }, signal: ctrl.signal });
    if (!res.ok) return [];
    const json = (await res.json()) as MapplsAutosuggestResp;
    return parseAutosuggest(json.suggestedLocations ?? []);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ─── Place details (pick → coordinates) ───────────────────────────────────────
// Mappls' FREE tier exposes no coordinate-returning API: Autosuggest omits
// lat/lng, and Place Detail / forward Geocode-with-coords are premium (verified
// live — they return DAILY_LIMIT_EXHAUSTED / 412). So we can't resolve an eLoc to
// coordinates here. Returning null makes the app open the map at its Chirawa-
// centre default (AddressMapScreen: `route.params?.center ?? CHIRAWA_CENTER`);
// the user positions the pin and reverseGeocode() fills the address.
//   → If the premium Place Detail API is enabled later, resolve `input.placeId`
//     (the eLoc) to { lat, lng } here and return it.
export async function placeDetails(
  _input: { placeId: string; sessionToken: string },
  _deps: GeoDeps = {},
): Promise<PlaceDetailsResult | null> {
  return null;
}

// ─── Reverse geocode ──────────────────────────────────────────────────────────

interface MapplsRevResult {
  formatted_address?: string;
  street?:      string;
  subLocality?: string;
  locality?:    string;
  village?:     string;
  city?:        string;
  state?:       string;
  pincode?:     string;
}
interface MapplsRevResp { results?: MapplsRevResult[] }

const NONE: ReverseGeocodeResult = {
  area: null, street: null, city: null, state: null, pincode: null, formatted: null, source: 'none',
};

// Pure parser (exported for unit tests): first Mappls result → cleaned address.
// NB: Mappls' rev_geocode also returns an `area` field, but it holds the COUNTRY
// ("India") — so we deliberately build the area line from sub-locality/locality.
export function parseRevGeocode(results: MapplsRevResult[]): ReverseGeocodeResult {
  const r = results[0];
  if (!r) return NONE;

  const rawArea   = r.subLocality || r.locality || r.village || null;
  const cleanArea = rawArea && !isPlusCode(rawArea) ? rawArea : null;
  const city      = r.city || r.locality || null;
  const formatted = r.formatted_address ? stripPlusCodePrefix(r.formatted_address) : null;
  const anything  = cleanArea || r.street || city || r.pincode || formatted;

  return {
    area:      cleanArea,
    street:    r.street ?? null,
    city,
    state:     r.state ?? null,
    pincode:   r.pincode ?? null,
    formatted,
    source:    anything ? 'mappls' : 'none',
  };
}

export async function reverseGeocode(
  input: { lat: number; lng: number },
  deps: GeoDeps = {},
): Promise<ReverseGeocodeResult> {
  if (isPlaceholder(env.MAPPLS_REST_KEY)) return NONE;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${REV_GEOCODE_URL(env.MAPPLS_REST_KEY)}?lat=${input.lat}&lng=${input.lng}`;
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) return NONE;
    const json = (await res.json()) as MapplsRevResp;
    return parseRevGeocode(json.results ?? []);
  } catch {
    return NONE;
  } finally {
    clearTimeout(timer);
  }
}
