import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIES } from '@/lib/api/cookie-names';

// Two jobs (plan Task 11 + C1):
//  1. CSRF belt-and-braces — state-changing /api/* requests must be same-origin.
//     SameSite=Lax cookies already block classic CSRF; this catches stragglers.
//  2. Soft gate — checkout/order/account pages redirect to /login when no
//     session cookies exist. Real authorization stays with the backend (JWT on
//     every proxied call); this only spares users a broken page.

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const GATED = [/^\/checkout(\/|$)/, /^\/order\//, /^\/orders(\/|$)/, /^\/account(\/|$)/];

function forbidden(): NextResponse {
  return NextResponse.json(
    { success: false, error: { code: 'CROSS_ORIGIN_DENIED', message: 'Cross-origin request blocked' } },
    { status: 403 },
  );
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;

  if (pathname.startsWith('/api/') && STATE_CHANGING.has(req.method)) {
    // Modern browsers: Sec-Fetch-Site must be same-origin (or none — direct
    // navigation/tools). Older browsers lack the header → fall through to the
    // Origin check below.
    const secFetchSite = req.headers.get('sec-fetch-site');
    if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
      return forbidden();
    }
    const origin = req.headers.get('origin');
    if (origin) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        return forbidden();
      }
      if (originHost !== req.nextUrl.host) return forbidden();
    }
  }

  if (GATED.some((re) => re.test(pathname))) {
    const hasSession =
      req.cookies.has(AUTH_COOKIES.access) || req.cookies.has(AUTH_COOKIES.refresh);
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.search = `next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/:path*',
    '/checkout/:path*',
    '/checkout',
    '/order/:path*',
    '/orders/:path*',
    '/orders',
    '/account/:path*',
    '/account',
  ],
};
