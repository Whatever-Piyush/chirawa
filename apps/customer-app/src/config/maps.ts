// Google Maps key — same value already shipped (publicly) in app.json under
// android.config.googleMaps. Kept here so JS (Geocoding REST API) can reuse it
// without pulling in expo-constants. If this is rotated, update app.json too.
//
// NOTE: for reverse-geocoding to work this key must have the **Geocoding API**
// enabled in Google Cloud (the Maps SDK rendering uses a separate surface).
export const GOOGLE_MAPS_API_KEY = 'AIzaSyBN1U2Krej0cXtPdLmED6APAi2h7xF0f2I';
