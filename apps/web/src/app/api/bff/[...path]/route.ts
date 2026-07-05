import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import {
  AUTH_COOKIES,
  authCookieOptions,
  ACCESS_TOKEN_MAX_AGE,
  REFRESH_TOKEN_MAX_AGE,
} from '@/lib/api/cookies';

// Generic same-origin passthrough proxy. The browser calls /api/bff/<path> and
// this forwards to BACKEND_API_BASE/<path>, injecting the Bearer from the
// httpOnly cookie and refreshing on 401 (dormant until login mints cookies in
// Task 11). Keeping the browser same-origin means no backend CORS changes.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BACKEND_API_BASE = (
  process.env.BACKEND_API_BASE ?? 'http://localhost:3000/api/v1'
).replace(/\/$/, '');

// Request headers we forward browser → backend. (Host/cookie/connection are not.)
const FORWARD_REQ_HEADERS = ['content-type', 'idempotency-key', 'accept', 'accept-language'];

function buildHeaders(req: NextRequest, token: string | null): Headers {
  const h = new Headers();
  for (const name of FORWARD_REQ_HEADERS) {
    const v = req.headers.get(name);
    if (v) h.set(name, v);
  }
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
  const targetPath = '/' + (path ?? []).map(encodeURIComponent).join('/');
  const target = `${BACKEND_API_BASE}${targetPath}${req.nextUrl.search}`;

  const method = req.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  // Buffer the body so it can be replayed on a post-refresh retry.
  const bodyBuf = hasBody ? await req.arrayBuffer() : undefined;

  const store = await cookies();
  const accessToken = store.get(AUTH_COOKIES.access)?.value ?? null;
  const refreshToken = store.get(AUTH_COOKIES.refresh)?.value ?? null;

  const send = (token: string | null): Promise<Response> => {
    const init: RequestInit = {
      method,
      headers: buildHeaders(req, token),
      redirect: 'manual',
      cache: 'no-store',
    };
    if (bodyBuf !== undefined) init.body = bodyBuf;
    return fetch(target, init);
  };

  let backendRes = await send(accessToken);

  // Refresh-on-401 → rotate cookies → retry once (dormant with no cookies).
  let rotated: { accessToken: string; refreshToken: string } | null = null;
  if (backendRes.status === 401 && refreshToken) {
    rotated = await tryRefresh(refreshToken);
    if (rotated) {
      backendRes = await send(rotated.accessToken);
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
