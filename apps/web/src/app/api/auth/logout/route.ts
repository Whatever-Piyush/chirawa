import { NextResponse, type NextRequest } from 'next/server';
import { serverApi } from '@/lib/api/server';
import { clearAuthCookies } from '@/lib/api/cookies';
import { rateLimitOk, clientKey } from '@/lib/rate-limit';

// Revokes the refresh token backend-side (best effort) and always clears the
// session cookies.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!rateLimitOk(`logout:${clientKey(req.headers)}`, 20, 60_000)) {
    return NextResponse.json(
      { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Try again shortly.' } },
      { status: 429 },
    );
  }

  try {
    // Reads bl_rt from the cookie jar (serverApi's storage) and revokes it.
    await serverApi().logout();
  } catch {
    // Expired/already-revoked sessions still log out locally.
  }
  await clearAuthCookies();
  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
