import { NextResponse } from 'next/server';
import { readAuthCookies } from '@/lib/api/cookies';
import { decodeJwtPayload, isExpired } from '@/lib/jwt';

// UI session probe: decodes the access JWT from the httpOnly cookie
// server-side (there is no /users/me — plan §2). Authorization is still the
// backend's job on every proxied call; this only feeds header/nav state.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(): Promise<NextResponse> {
  const { accessToken, refreshToken } = await readAuthCookies();

  if (!accessToken && !refreshToken) {
    return NextResponse.json({ authed: false }, { headers: NO_STORE });
  }

  const claims = accessToken ? decodeJwtPayload(accessToken) : null;
  if (claims && !isExpired(claims)) {
    return NextResponse.json(
      { authed: true, userId: claims.sub ?? null, role: claims.role ?? null },
      { headers: NO_STORE },
    );
  }

  // Access token missing/expired but a refresh token exists: still a session —
  // the BFF refreshes on the next API call. Reuse expired claims for identity.
  if (refreshToken) {
    return NextResponse.json(
      { authed: true, userId: claims?.sub ?? null, role: claims?.role ?? null, stale: true },
      { headers: NO_STORE },
    );
  }

  return NextResponse.json({ authed: false }, { headers: NO_STORE });
}
