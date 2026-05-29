// Dev-only API/socket host. Override per-machine via EXPO_PUBLIC_API_HOST in
// apps/seller-app/.env (e.g. EXPO_PUBLIC_API_HOST=192.168.1.23). Expo inlines
// EXPO_PUBLIC_* at bundle time. Falls back to a default if unset.
//   • Physical device  → your Mac's LAN IP (`ipconfig getifaddr en0`)
//   • Android emulator → 10.0.2.2
//   • iOS simulator    → localhost
export const DEV_HOST = process.env.EXPO_PUBLIC_API_HOST ?? '192.168.1.5';
