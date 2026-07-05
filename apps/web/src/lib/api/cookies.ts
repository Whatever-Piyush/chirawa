import { cookies } from 'next/headers';
import type { AuthTokens } from '@chirawa/types';

// httpOnly session cookies. The browser never reads these (Bearer is injected by
// the BFF); they are minted at verify-otp (Task 11) and rotated on refresh.
export const AUTH_COOKIES = {
  access: 'bl_at',
  refresh: 'bl_rt',
} as const;

export const ACCESS_TOKEN_MAX_AGE = 15 * 60; // 15 min (JWT lifetime)
export const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days (opaque refresh)

// Cookie attributes for the session cookies. Secure-by-default: only disabled
// when COOKIE_SECURE is explicitly 'false' (local dev over http).
export function authCookieOptions(maxAge: number) {
  const domain = process.env.COOKIE_DOMAIN;
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== 'false',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
    ...(domain ? { domain } : {}),
  };
}

// ─── Read/write helpers (next/headers — request-scoped) ─────────────────────
// set/delete only work in Route Handlers / Server Actions (mutable cookie jar);
// in RSC they throw. That's fine: public catalog reads never touch tokens, and
// the auth flows (BFF refresh, verify-otp) run in handlers.

export async function readAuthCookies(): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
}> {
  const store = await cookies();
  return {
    accessToken: store.get(AUTH_COOKIES.access)?.value ?? null,
    refreshToken: store.get(AUTH_COOKIES.refresh)?.value ?? null,
  };
}

export async function writeAuthCookies(tokens: Pick<AuthTokens, 'accessToken' | 'refreshToken'>): Promise<void> {
  const store = await cookies();
  store.set(AUTH_COOKIES.access, tokens.accessToken, authCookieOptions(ACCESS_TOKEN_MAX_AGE));
  store.set(AUTH_COOKIES.refresh, tokens.refreshToken, authCookieOptions(REFRESH_TOKEN_MAX_AGE));
}

export async function clearAuthCookies(): Promise<void> {
  const store = await cookies();
  store.delete(AUTH_COOKIES.access);
  store.delete(AUTH_COOKIES.refresh);
}
