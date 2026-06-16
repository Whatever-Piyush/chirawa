// Reverse-geocoding (coordinates → human address). The Geocoding API key lives
// only on the backend; the client sends coordinates and gets back a cleaned,
// Plus-Code-free address (or null when nothing usable could be resolved).

export interface ReverseGeocodeRequest {
  lat: number;
  lng: number;
}

export interface ReverseGeocodeResult {
  // Best human "area / locality" line (sublocality → neighbourhood → locality).
  // Guaranteed to NOT be a Plus Code.
  area:      string | null;
  street:    string | null;   // route / street name, when available
  city:      string | null;
  state:     string | null;
  pincode:   string | null;
  formatted: string | null;   // full one-line address (Plus Codes stripped)
  source:    'google' | 'device' | 'none';
}
