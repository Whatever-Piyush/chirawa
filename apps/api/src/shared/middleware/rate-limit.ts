import type { FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../../modules/auth/token.service';

// Per-user key for @fastify/rate-limit. The limiter runs at onRequest (before
// the auth preHandler), so request.auth isn't populated yet — we read the JWT
// ourselves.
//
// P1-1: the `sub` is only trusted after FULL signature verification. The old
// version base64-decoded the payload without verifying, so an attacker could
// mint unlimited fabricated `sub` values (or slap a fake Bearer on any request)
// and give every request its own fresh bucket — per-user limits on checkout/
// payment routes were advisory. Now a bucket key can only come from a token WE
// signed; everything else (absent, malformed, forged, expired) shares the
// caller's per-IP bucket. An expired-token fallback to IP is fine: the route's
// authenticate preHandler 401s it anyway. RS256 verify costs ~microseconds and
// only runs on routes that opted into perUserRateLimit.
export function userOrIpKey(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = verifyAccessToken(header.slice(7));
      if (payload.sub) return `u:${payload.sub}`;
    } catch { /* unverifiable token → fall through to IP */ }
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
