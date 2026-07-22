// Session cookie names + lifetimes, importable from middleware (no next/headers
// dependency — middleware must stay edge-safe).
export const AUTH_COOKIES = {
  access: 'bl_at',
  refresh: 'bl_rt',
} as const;

export const ACCESS_TOKEN_MAX_AGE = 15 * 60; // 15 min (JWT lifetime)
export const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days (opaque refresh)
