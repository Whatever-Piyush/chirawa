import { cookies } from 'next/headers';
import type { AuthTokens } from '@chirawa/types';
import { AUTH_COOKIES, ACCESS_TOKEN_MAX_AGE, REFRESH_TOKEN_MAX_AGE } from './cookie-names';

// httpOnly session cookies. The browser never reads these (Bearer is injected by
// the BFF); they are minted at verify-otp (Task 11) and rotated on refresh.
// Names/lifetimes live in cookie-names.ts (also imported by middleware).
export { AUTH_COOKIES, ACCESS_TOKEN_MAX_AGE, REFRESH_TOKEN_MAX_AGE };

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
