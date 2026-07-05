import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@chirawa/api-client';
import type { VerifyOtpResponse } from '@chirawa/types';
import { serverApi } from '@/lib/api/server';
import { writeAuthCookies } from '@/lib/api/cookies';
import { rateLimitOk, clientKey } from '@/lib/rate-limit';

// Mints the httpOnly session: phone+otp → backend verify → Set-Cookie
// bl_at/bl_rt. Tokens NEVER appear in the response body — the browser only
// learns {isNewUser, role}. Backend enforces the real OTP limits; the local
// limiter just shields this cookie-minting endpoint.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PHONE_RE = /^[6-9]\d{9}$/;
const OTP_RE = /^\d{4,8}$/;

function err(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!rateLimitOk(`verify-otp:${clientKey(req.headers)}`, 10, 60_000)) {
    return err(429, 'RATE_LIMIT_EXCEEDED', 'Bahut zyada requests. Thodi der baad try karein.');
  }

  const body = (await req.json().catch(() => null)) as { phone?: unknown; otp?: unknown } | null;
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const otp = typeof body?.otp === 'string' ? body.otp.trim() : '';
  if (!PHONE_RE.test(phone) || !OTP_RE.test(otp)) {
    return err(400, 'VALIDATION_ERROR', 'Sahi phone number aur OTP daalein.');
  }

  let result: VerifyOtpResponse & { role?: string };
  try {
    result = await serverApi().verifyOtp({ phone, otp });
  } catch (e) {
    if (e instanceof ApiError) return err(e.statusCode, e.code ?? 'AUTH_FAILED', e.message);
    return err(502, 'UPSTREAM_ERROR', 'Login abhi possible nahi. Dobara try karein.');
  }

  // Web sessions are CUSTOMER-only: a seller/rider token behind the BFF cookie
  // would expose their surface through this origin. (Customer requiresPin is
  // always false — plan §2.)
  const role = result.role ?? 'customer';
  if (role !== 'customer' || result.requiresPin) {
    return err(403, 'ROLE_NOT_ALLOWED', 'Yeh login sirf customers ke liye hai. Seller/Rider app use karein.');
  }

  await writeAuthCookies(result.tokens);
  return NextResponse.json(
    { isNewUser: result.isNewUser, role },
    { headers: { 'cache-control': 'no-store' } },
  );
}
