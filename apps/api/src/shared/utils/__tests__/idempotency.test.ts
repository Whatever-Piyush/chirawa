import { describe, it, expect, vi } from 'vitest';
import { runIdempotent, readIdempotencyKey } from '../idempotency';
import { ConflictError } from '../../errors/app-errors';

// Minimal in-memory fake of the ioredis surface runIdempotent uses, honouring
// SET … NX (set-if-not-exists) and EX (ttl ignored — tests don't advance time).
function makeRedis() {
  const store = new Map<string, string>();
  const redis = {
    set: vi.fn(async (key: string, val: string, _ex: string, _ttl: number, nx?: string) => {
      if (nx === 'NX' && store.has(key)) return null;
      store.set(key, val);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
  return { redis: redis as never, store };
}

const SCOPE = 'order:user_1';
const KEY = 'idem-abc';

describe('runIdempotent (0.5 — Redis SETNX idempotency)', () => {
  it('runs the handler once and returns its response (replayed=false)', async () => {
    const { redis } = makeRedis();
    const handler = vi.fn().mockResolvedValue({ status: 201, body: { id: 'order_1' } });

    const result = await runIdempotent(redis, SCOPE, KEY, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 201, body: { id: 'order_1' } });
    expect(result.replayed).toBe(false);
  });

  it('replays the cached response on a repeat key without re-running the handler', async () => {
    const { redis } = makeRedis();
    const handler = vi.fn().mockResolvedValue({ status: 201, body: { id: 'order_1' } });

    await runIdempotent(redis, SCOPE, KEY, handler);
    const second = await runIdempotent(redis, SCOPE, KEY, handler);

    expect(handler).toHaveBeenCalledTimes(1);          // not called again
    expect(second).toMatchObject({ status: 201, body: { id: 'order_1' }, replayed: true });
  });

  it('rejects a concurrent in-flight request with 409 ConflictError', async () => {
    const { redis } = makeRedis();
    let resolveFirst!: () => void;
    const firstHandler = vi.fn(() => new Promise<{ status: number; body: unknown }>((res) => {
      resolveFirst = () => res({ status: 201, body: { id: 'order_1' } });
    }));

    const inFlight = runIdempotent(redis, SCOPE, KEY, firstHandler); // acquires lock, awaits handler
    await Promise.resolve(); // let the lock get written

    await expect(runIdempotent(redis, SCOPE, KEY, vi.fn())).rejects.toBeInstanceOf(ConflictError);

    resolveFirst();
    await inFlight;
  });

  it('releases the lock on handler failure so a genuine retry can proceed', async () => {
    const { redis } = makeRedis();
    const failing = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(runIdempotent(redis, SCOPE, KEY, failing)).rejects.toThrow('boom');

    // Lock released → a fresh attempt with the same key runs the handler again.
    const ok = vi.fn().mockResolvedValue({ status: 201, body: { id: 'order_retry' } });
    const result = await runIdempotent(redis, SCOPE, KEY, ok);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 201, body: { id: 'order_retry' }, replayed: false });
  });

  it('scopes keys per user — same key, different scope does not collide', async () => {
    const { redis } = makeRedis();
    const h1 = vi.fn().mockResolvedValue({ status: 201, body: { id: 'a' } });
    const h2 = vi.fn().mockResolvedValue({ status: 201, body: { id: 'b' } });

    const r1 = await runIdempotent(redis, 'order:user_1', KEY, h1);
    const r2 = await runIdempotent(redis, 'order:user_2', KEY, h2);

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    expect(r1.body).toMatchObject({ id: 'a' });
    expect(r2.body).toMatchObject({ id: 'b' });
  });
});

describe('readIdempotencyKey', () => {
  it('returns null for absent / blank headers', () => {
    expect(readIdempotencyKey(undefined)).toBeNull();
    expect(readIdempotencyKey('   ')).toBeNull();
  });
  it('trims, takes the first of an array, and caps length', () => {
    expect(readIdempotencyKey('  abc  ')).toBe('abc');
    expect(readIdempotencyKey(['first', 'second'])).toBe('first');
    expect(readIdempotencyKey('x'.repeat(300))).toHaveLength(200);
  });
});
