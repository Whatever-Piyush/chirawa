import type { FastifyRequest } from 'fastify';

// Per-user key for @fastify/rate-limit. The limiter runs at onRequest (before our
// auth preHandler), so request.auth isn't populated yet — we read the JWT `sub`
// straight from the bearer token for KEYING ONLY (no verification needed here;
// the route's authenticate middleware still does the real verification). Falls
// back to IP for unauthenticated requests.
function userOrIpKey(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const part = header.slice(7).split('.')[1];
    if (part) {
      try {
        const payload = JSON.parse(Buffer.from(part, 'base64').toString('utf8')) as { sub?: string };
        if (payload.sub) return `u:${payload.sub}`;
      } catch { /* malformed token → fall through to IP */ }
    }
  }
  return `ip:${req.ip}`;
}

/**
 * Per-route rate limit keyed per-user (in addition to the global per-IP cap).
 * Spread into a route's options: `{ ...perUserRateLimit(10, '1 minute'), preHandler: [...] }`.
 */
export function perUserRateLimit(max: number, timeWindow: string) {
  return { config: { rateLimit: { max, timeWindow, keyGenerator: userOrIpKey } } };
}
