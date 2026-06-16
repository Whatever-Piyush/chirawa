import * as Location from 'expo-location';
import { api } from '../services/api.service';

// Plus Code guard (mirror of the backend's) — an Open Location Code like "6JVX+3C"
// must never be shown to the user as an "area". Alphabet excludes 0/1/A/E/I/L/O/U.
const PLUS_CODE_RE = /\b[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\b/i;
export function isPlusCode(s: string | null | undefined): boolean {
  return !!s && PLUS_CODE_RE.test(s.trim());
}

export interface ResolvedAddress {
  lat:     number;
  lng:     number;
  area:    string | null;   // human locality line (never a Plus Code)
  street:  string | null;
  city:    string | null;
  pincode: string | null;
  source:  'google' | 'device' | 'none';
}

export type LocationOutcome =
  | { ok: true;  address: ResolvedAddress }
  | { ok: false; reason: 'denied' | 'unavailable' };

// Big-tech "use my current location" flow, secured:
//  1. foreground ("when in use") permission
//  2. GPS coordinates
//  3. reverse-geocode via OUR backend (Google key stays server-side)
//  4. fall back to the on-device geocoder — but never surface a Plus Code
export async function resolveCurrentAddress(): Promise<LocationOutcome> {
  // 1 — foreground permission (the caller shows the rationale banner first).
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return { ok: false, reason: 'denied' };

  // 2 — coordinates (Balanced is accurate enough for an address line and faster).
  let coords: { lat: number; lng: number };
  try {
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  // 3 — backend Google proxy (best quality, Plus-Code-free).
  try {
    const g = await api.reverseGeocode(coords.lat, coords.lng);
    if (g && g.source === 'google' && (g.area || g.street || g.city)) {
      return {
        ok: true,
        address: {
          ...coords,
          area:    g.area && !isPlusCode(g.area) ? g.area : (g.city ?? null),
          street:  g.street,
          city:    g.city,
          pincode: g.pincode,
          source:  'google',
        },
      };
    }
  } catch { /* fall through to the device geocoder */ }

  // 4 — on-device fallback (works without a server key); strip Plus Codes.
  try {
    const [p] = await Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lng });
    if (p) {
      const area   = [p.district, p.subregion, p.city].find((x) => !!x && !isPlusCode(x)) ?? null;
      const street = [p.name, p.street].find((x) => !!x && !isPlusCode(x)) ?? null;
      return {
        ok: true,
        address: {
          ...coords,
          area,
          street,
          city:    p.city && !isPlusCode(p.city) ? p.city : null,
          pincode: p.postalCode ?? null,
          source:  'device',
        },
      };
    }
  } catch { /* ignore — return coords-only below */ }

  // 5 — coordinates resolved but no readable address.
  return { ok: true, address: { ...coords, area: null, street: null, city: null, pincode: null, source: 'none' } };
}
