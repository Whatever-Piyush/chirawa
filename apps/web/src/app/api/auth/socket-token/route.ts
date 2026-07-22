import { NextResponse, type NextRequest } from 'next/server';
import {
  readAuthCookies,
  writeAuthCookies,
} from '@/lib/api/cookies';
import { refreshTokens } from '@/lib/api/refresh';
import { decodeJwtPayload, isExpired } from '@/lib/jwt';
import { rateLimitOk, clientKey } from '@/lib/rate-limit';

// Hands the (15-min) access token to the client for the Socket.IO handshake —
// the one place the token intentionally reaches JS, because the websocket
// connects browser→backend directly. Requires a live session; refreshes and
// rotates cookies when the access token has lapsed.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

function deny(status: number, code: string): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message: 'Login required' } },
    { status, headers: NO_STORE },
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!rateLimitOk(`socket-token:${clientKey(req.headers)}`, 30, 60_000)) {
    return deny(429, 'RATE_LIMIT_EXCEEDED');
  }

  // GETs skip the middleware origin check (they're not state-changing), but
  // this one returns a credential — so verify same-origin here.
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    return deny(403, 'CROSS_ORIGIN_DENIED');
  }

  const { accessToken, refreshToken } = await readAuthCookies();

  if (accessToken) {
    const claims = decodeJwtPayload(accessToken);
    if (claims && !isExpired(claims, 60)) {
      return NextResponse.json({ token: accessToken }, { headers: NO_STORE });
    }
  }

  if (refreshToken) {
    const rotated = await refreshTokens(refreshToken);
    if (rotated) {
      await writeAuthCookies(rotated);
      return NextResponse.json({ token: rotated.accessToken }, { headers: NO_STORE });
    }
  }

  return deny(401, 'UNAUTHENTICATED');
}
