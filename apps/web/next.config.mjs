const isProd = process.env.NODE_ENV === 'production';

// Prod image host (Cloudflare R2 / CDN) — also whitelisted in the CSP.
const IMAGE_HOST = process.env.NEXT_PUBLIC_IMAGE_HOST;

// Socket.IO origin for live order tracking (Task 14). The browser connects to
// the backend directly (ws), so CSP connect-src must allow it.
const SOCKET_ORIGIN = (process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:3000').replace(/\/$/, '');

// Strict static CSP. Deliberately NOT nonce-based: per-request nonces cannot
// live inside ISR-cached HTML (they'd force every page dynamic), so script-src
// keeps 'unsafe-inline' for Next's hydration payload. Compensating controls:
// zero third-party scripts, React auto-escaping, JSON-LD `<`-escaped, external
// script sources locked to 'self'.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${IMAGE_HOST ? ` https://${IMAGE_HOST}` : ''}${isProd ? '' : ' http://localhost:3000'}`,
  `connect-src 'self' ${SOCKET_ORIGIN} ${SOCKET_ORIGIN.replace(/^http/, 'ws')}`,
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProd ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), payment=(), usb=(), geolocation=(self)',
  },
  // HSTS only in prod (meaningless over plain-http dev and would poison localhost).
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared workspace packages ship raw TS/TSX — Next must transpile them.
  transpilePackages: ['@chirawa/api-client', '@chirawa/types', '@chirawa/i18n'],
  images: {
    // Product/shop images come from R2_PUBLIC_URL (Cloudflare R2). In dev it
    // defaults to the API origin (localhost:3000). The PROD R2/CloudFront public
    // host is a secret not in the repo — set NEXT_PUBLIC_IMAGE_HOST (plan §8).
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '3000', pathname: '/**' },
      ...(IMAGE_HOST ? [{ protocol: 'https', hostname: IMAGE_HOST, pathname: '/**' }] : []),
    ],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
