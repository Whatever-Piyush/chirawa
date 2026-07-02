// Dynamic Expo config (SDK 54) — extends app.json (passed in as `config`).
// Exists for ONE reason: the Android map tile-render key must not live in git.
// The previously hardcoded key is COMPROMISED (public git history) — rotate it
// in the Google Cloud console and restrict the replacement to this package name
// + release signing SHA-1 + "Maps SDK for Android" only (a mobile-SDK tile key;
// every maps API call — search, geocoding, distance — is Mappls, server-side).
//
// Where to set GOOGLE_MAPS_ANDROID_API_KEY:
//   • local prebuild/dev-client: apps/customer-app/.env (Expo CLI loads it)
//   • EAS builds: an EAS environment variable on each build profile
// Unset ⇒ the Android map view renders blank tiles; the rest of the app works.
export default ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? '' },
    },
  },
});
