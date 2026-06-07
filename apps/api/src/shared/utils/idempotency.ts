import type Redis from 'ioredis';
import { ConflictError } from '../errors/app-errors';

// In-flight lock window: short, so a process that dies mid-request auto-releases
// the key instead of wedging the client for the full replay window.
const LOCK_TTL_SECONDS   = 60;
// Completed-response replay window — a retry within this window gets the original
// response back instead of creating a second order.
const RESULT_TTL_SECONDS = 24 * 60 * 60;

// Marker stored while the first request is still running.
const IN_FLIGHT = '__in_flight__';

export interface IdempotentResponse {
  status: number;
  body:   unknown;
}

/**
 * Run `handler` at most once per (scope, key), using a Redis SETNX lock.
 *
 *  - First caller wins the lock (SET … NX), runs the handler, then caches the
 *    response for replay.
 *  - A concurrent caller while the first is still in flight gets a 409 (retry
 *    shortly) — we must not create a second order.
 *  - A caller after completion gets the SAME cached response back (replay).
 *  - If the handler throws, the lock is released so a genuine retry can proceed;
 *    we never cache failures.
 *
 * `scope` should include the user id so one user's key can never collide with —
 * or replay — another user's request.
 */
export async function runIdempotent(
  redis: Redis,
  scope: string,
  key: string,
  handler: () => Promise<IdempotentResponse>,
): Promise<IdempotentResponse & { replayed: boolean }> {
  const redisKey = `idem:${scope}:${key}`;

  // Atomic set-if-not-exists with TTL — this is the SETNX lock.
  const acquired = await redis.set(redisKey, IN_FLIGHT, 'EX', LOCK_TTL_SECONDS, 'NX');

  if (acquired === 'OK') {
    try {
      const result = await handler();
      await redis.set(redisKey, JSON.stringify(result), 'EX', RESULT_TTL_SECONDS);
      return { ...result, replayed: false };
    } catch (err) {
      // Don't cache failures — let the next attempt try again.
      await redis.del(redisKey).catch(() => {});
      throw err;
    }
  }

  // Lock already held — either still running, or finished with a cached response.
  const existing = await redis.get(redisKey);
  if (!existing || existing === IN_FLIGHT) {
    throw new ConflictError('A request with this Idempotency-Key is still being processed. Please retry shortly.');
  }
  const cached = JSON.parse(existing) as IdempotentResponse;
  return { ...cached, replayed: true };
}

// Normalize the incoming header (may be string | string[] | undefined) into a
// usable key, or null if absent. Bounded length to keep Redis keys sane.
export function readIdempotencyKey(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  const trimmed = raw?.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}
