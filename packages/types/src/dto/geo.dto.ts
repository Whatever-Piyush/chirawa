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
  source:    'google' | 'mappls' | 'device' | 'none';
}

// ─── Place search (Places Autocomplete (New), proxied server-side) ────────────
// The Places key lives only on the backend. Results are hard-restricted to the
// Chirawa service area — the app is Chirawa-only for now.

export interface PlaceAutocompleteRequest {
  q:            string;
  sessionToken: string;   // UUID v4 per search session (Google billing grouping)
}

export interface PlacePrediction {
  placeId:       string;
  primaryText:   string;        // bold line, e.g. "Near Shyam Mandir"
  secondaryText: string;        // muted line, e.g. "Ambika Nagar, Chirawa, Rajasthan"
  distanceKm:    number | null; // from Chirawa centre
}

export interface PlaceDetailsRequest {
  placeId:      string;
  sessionToken: string;   // same token as the autocomplete session
}

export interface PlaceDetailsResult {
  lat:       number;
  lng:       number;
  area:      string | null;
  city:      string | null;
  pincode:   string | null;
  formatted: string | null;
}
