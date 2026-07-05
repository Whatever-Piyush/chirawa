import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import {
  AUTH_COOKIES,
  authCookieOptions,
  ACCESS_TOKEN_MAX_AGE,
  REFRESH_TOKEN_MAX_AGE,
} from '@/lib/api/cookies';

// Same-origin BFF proxy. The browser calls /api/bff/<path> and this forwards to
// BACKEND_API_BASE/<path>, injecting the Bearer from the httpOnly cookie and
// refreshing on 401. Keeping the browser same-origin means no backend REST CORS.
//
// Hardening (plan B2):
//  - explicit method+path ALLOWLIST — only the customer storefront surface is
//    proxied; admin/seller/payment/loyalty/notification routes and the
//    cookie-owning auth flows (verify-otp/refresh/logout live in /api/auth/*)
//    are unreachable through here (404, indistinguishable from unknown paths)
//  - forwards the client IP chain (x-forwarded-for) so backend per-IP rate
//    limits key on the real user instead of this server's egress IP
//  - request body cap (100 KB) and upstream timeout (15 s)

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BACKEND_API_BASE = (
  process.env.BACKEND_API_BASE ?? 'http://localhost:3000/api/v1'
).replace(/\/$/, '');

const MAX_BODY_BYTES = 100_000;
const UPSTREAM_TIMEOUT_MS = 15_000;

// method → allowed path patterns (matched against the decoded /-joined path,
// no leading slash, no query). Keep in sync with @chirawa/api-client usage.
const ALLOW: Record<string, RegExp[]> = {
  GET: [
    /^catalog\/(shops|products|feed|daily-essentials|specials|categories|bestsellers|category-images|master)(\/.*)?$/,
    /^search(\/suggest)?$/,
    /^cart$/,
    /^users\/me\/addresses(\/.*)?$/,
    /^orders(\/.*)?$/,
    /^delivery\/orders\/[^/]+\/rider-location$/,
  ],
  POST: [
    /^auth\/send-otp$/,
    /^cart\/items$/,
    /^pricing\/preview$/,
    /^users\/me\/addresses(\/[^/]+\/default)?$/,
    /^orders$/,
    /^orders\/[^/]+\/(cancel|rate)$/,
    /^geo\/(reverse|autocomplete|place)$/,
  ],
  PATCH: [/^cart\/items\/[^/]+$/, /^orders\/[^/]+\/(delivery-address|receiver)$/],
  PUT: [/^users\/me\/addresses\/[^/]+$/],
  DELETE: [/^cart$/, /^cart\/items\/[^/]+$/, /^users\/me\/addresses\/[^/]+$/],
};

function isAllowed(method: string, path: string): boolean {
  return (ALLOW[method] ?? []).some((re) => re.test(path));
}

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

// Request headers we forward browser → backend. (Host/cookie/connection are not.)
const FORWARD_REQ_HEADERS = ['content-type', 'idempotency-key', 'accept', 'accept-language'];

function buildHeaders(req: NextRequest, token: string | null): Headers {
  const h = new Headers();
  for (const name of FORWARD_REQ_HEADERS) {
    const v = req.headers.get(name);
    if (v) h.set(name, v);
  }
  // Real client IP chain (when fronted by nginx/CDN) so backend per-IP rate
  // limits and OTP abuse caps key on the user, not this server.
  const xff = req.headers.get('x-forwarded-for');
  if (xff) h.set('x-forwarded-for', xff);
  const realIp = req.headers.get('x-real-ip');
  if (realIp) h.set('x-real-ip', realIp);
  if (token) h.set('authorization', `Bearer ${token}`);
  return h;
}

// Mirror the backend response (status + content-type + body) back to the browser.
// We deliberately do NOT forward the backend's Set-Cookie — the BFF owns cookies.
function passthrough(backendRes: Response): NextResponse {
  const headers = new Headers();
  const ct = backendRes.headers.get('content-type');
  if (ct) headers.set('content-type', ct);
  return new NextResponse(backendRes.body, { status: backendRes.status, headers });
}

async function tryRefresh(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const r = await fetch(`${BACKEND_API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { tokens?: { accessToken?: string; refreshToken?: string } };
    const t = data.tokens;
    return t?.accessToken && t?.refreshToken
      ? { accessToken: t.accessToken, refreshToken: t.refreshToken }
      : null;
  } catch {
    return null;
  }
}

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await ctx.params;
  const segments = (path ?? []).map(encodeURIComponent);
  const joined = segments.join('/');

  const method = req.method.toUpperCase();
  if (!isAllowed(method, joined)) {
    return jsonError(404, 'NOT_FOUND', 'Route not found');
  }

  const target = `${BACKEND_API_BASE}/${joined}${req.nextUrl.search}`;

  const hasBody = method !== 'GET' && method !== 'HEAD';
  // Buffer the body so it can be replayed on a post-refresh retry.
  const bodyBuf = hasBody ? await req.arrayBuffer() : undefined;
  if (bodyBuf !== undefined && bodyBuf.byteLength > MAX_BODY_BYTES) {
    return jsonError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  }

  const store = await cookies();
  const accessToken = store.get(AUTH_COOKIES.access)?.value ?? null;
  const refreshToken = store.get(AUTH_COOKIES.refresh)?.value ?? null;

  const send = (token: string | null): Promise<Response> => {
    const init: RequestInit = {
      method,
      headers: buildHeaders(req, token),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    };
    if (bodyBuf !== undefined) init.body = bodyBuf;
    return fetch(target, init);
  };

  let backendRes: Response;
  try {
    backendRes = await send(accessToken);
  } catch {
    return jsonError(504, 'UPSTREAM_TIMEOUT', 'Backend did not respond in time');
  }

  // Refresh-on-401 → rotate cookies → retry once.
  let rotated: { accessToken: string; refreshToken: string } | null = null;
  if (backendRes.status === 401 && refreshToken) {
    rotated = await tryRefresh(refreshToken);
    if (rotated) {
      try {
        backendRes = await send(rotated.accessToken);
      } catch {
        return jsonError(504, 'UPSTREAM_TIMEOUT', 'Backend did not respond in time');
      }
    } else {
      // Unrecoverable session — clear cookies and surface the 401.
      const res401 = passthrough(backendRes);
      res401.cookies.delete(AUTH_COOKIES.access);
      res401.cookies.delete(AUTH_COOKIES.refresh);
      return res401;
    }
  }

  const res = passthrough(backendRes);
  if (rotated) {
    res.cookies.set(AUTH_COOKIES.access, rotated.accessToken, authCookieOptions(ACCESS_TOKEN_MAX_AGE));
    res.cookies.set(AUTH_COOKIES.refresh, rotated.refreshToken, authCookieOptions(REFRESH_TOKEN_MAX_AGE));
  }
  return res;
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
};
