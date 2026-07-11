import { describe, it, expect, vi } from 'vitest';

// P1-1 regression tests: the per-user rate-limit bucket key must only ever
// come from a token whose SIGNATURE we verified. The old key fn base64-decoded
// the payload unverified — an attacker could mint unlimited fabricated `sub`
// values and give every request a fresh bucket.

vi.mock('../../../modules/auth/token.service', () => ({
  verifyAccessToken: vi.fn((token: string) => {
    if (token === 'valid.signed.token') return { sub: 'user-1', role: 'customer', profileId: 'p1' };
    throw new Error('invalid signature');
  }),
}));

import { userOrIpKey } from '../rate-limit';

const req = (authorization?: string) =>
  ({ headers: authorization ? { authorization } : {}, ip: '203.0.113.7' }) as never;

describe('userOrIpKey (P1-1)', () => {
  it('keys by user only for a token with a VERIFIED signature', () => {
    expect(userOrIpKey(req('Bearer valid.signed.token'))).toBe('u:user-1');
  });

  it('a forged token with a fabricated sub cannot mint its own bucket — falls back to IP', () => {
    // This is exactly the old bypass: a self-crafted, unsigned JWT whose
    // payload decodes fine but whose signature is garbage.
    const forged = `x.${Buffer.from(JSON.stringify({ sub: 'anything-i-want' })).toString('base64')}.y`;
    expect(userOrIpKey(req(`Bearer ${forged}`))).toBe('ip:203.0.113.7');
  });

  it('two different forged subs share the SAME per-IP bucket (no bucket minting)', () => {
    const forge = (sub: string) => `x.${Buffer.from(JSON.stringify({ sub })).toString('base64')}.y`;
    expect(userOrIpKey(req(`Bearer ${forge('a')}`))).toBe(userOrIpKey(req(`Bearer ${forge('b')}`)));
  });

  it('no Authorization header → per-IP bucket', () => {
    expect(userOrIpKey(req())).toBe('ip:203.0.113.7');
  });

  it('non-Bearer or garbage headers → per-IP bucket', () => {
    expect(userOrIpKey(req('Basic dXNlcjpwYXNz'))).toBe('ip:203.0.113.7');
    expect(userOrIpKey(req('Bearer '))).toBe('ip:203.0.113.7');
    expect(userOrIpKey(req('Bearer not-a-jwt'))).toBe('ip:203.0.113.7');
  });
});
