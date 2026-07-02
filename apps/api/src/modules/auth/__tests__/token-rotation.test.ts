import { describe, it, expect, vi } from 'vitest';

// Stub jwt so rotation tests need no real RSA key material.
vi.mock('jsonwebtoken', () => ({
  default: { sign: vi.fn(() => 'fake.access.jwt') },
}));

import { rotateRefreshToken } from '../token.service';
import { AuthenticationError } from '../../../shared/errors/app-errors';

// P1-7 regression tests: refresh rotation must be an atomic CLAIM
// (conditional updateMany on usedAt IS NULL), not check-then-act. Two
// concurrent refreshes with the same token used to both pass the usedAt
// check and both mint sessions — racing straight past reuse detection.

const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000);

function makeStored(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tok_1',
    userId: 'user_1',
    usedAt: null,
    revokedAt: null,
    expiresAt: FUTURE,
    user: {
      id: 'user_1',
      role: 'customer',
      customerProfile: { id: 'cp_1' },
      sellerProfile: null,
      riderProfile: null,
      adminProfile: null,
    },
    ...overrides,
  };
}

// claimResults: queued {count} results for the CLAIM updateMany (where.id).
// Revocations (where.userId) are recorded separately.
function makePrisma(stored: ReturnType<typeof makeStored> | null, claimResults: number[]) {
  const claims = [...claimResults];
  const revokeCalls: unknown[] = [];
  const claimCalls: unknown[] = [];
  const prisma = {
    refreshToken: {
      findUnique: vi.fn().mockResolvedValue(stored),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
        if ('id' in args.where) {
          claimCalls.push(args);
          return Promise.resolve({ count: claims.shift() ?? 0 });
        }
        revokeCalls.push(args);
        return Promise.resolve({ count: 2 });
      }),
    },
  };
  return { prisma, revokeCalls, claimCalls };
}

describe('rotateRefreshToken — atomic claim (P1-7)', () => {
  it('rotates when the claim wins: usedAt-conditional CAS, then a new pair', async () => {
    const { prisma, revokeCalls, claimCalls } = makePrisma(makeStored(), [1]);

    const result = await rotateRefreshToken(prisma as never, 'raw-token');

    expect(result.userId).toBe('user_1');
    expect(result.newAccessToken).toBe('fake.access.jwt');
    expect(result.newRefreshToken).toMatch(/^[0-9a-f]{64}$/);
    // The claim must be CONDITIONAL on usedAt — that's the whole fix.
    expect(claimCalls[0]).toMatchObject({ where: { id: 'tok_1', usedAt: null } });
    expect(revokeCalls).toHaveLength(0);
  });

  it('treats a LOST claim as reuse: revokes every session and refuses (the P1-7 race)', async () => {
    // findUnique saw usedAt=null (stale read), but a concurrent rotation
    // consumed the token before our CAS → count 0.
    const { prisma, revokeCalls } = makePrisma(makeStored(), [0]);

    await expect(rotateRefreshToken(prisma as never, 'raw-token'))
      .rejects.toThrow(AuthenticationError);
    expect(revokeCalls[0]).toMatchObject({
      where: { userId: 'user_1', revokedAt: null },
      data:  { revokedAt: expect.any(Date) },
    });
    expect(prisma.refreshToken.create).not.toHaveBeenCalled(); // no session minted
  });

  it('only ONE of two concurrent refreshes mints a session; the other trips the alarm', async () => {
    // Same DB: both read the token clean; the CAS serializes them (1 then 0).
    const { prisma, revokeCalls } = makePrisma(makeStored(), [1, 0]);

    const [a, b] = await Promise.allSettled([
      rotateRefreshToken(prisma as never, 'raw-token'),
      rotateRefreshToken(prisma as never, 'raw-token'),
    ]);

    const outcomes = [a.status, b.status].sort();
    expect(outcomes).toEqual(['fulfilled', 'rejected']);
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1); // exactly one new session
    expect(revokeCalls).toHaveLength(1);                          // loser revoked the family
  });

  it('overt reuse (usedAt already set) keeps precedence over expiry and revokes all', async () => {
    const { prisma, revokeCalls } = makePrisma(
      makeStored({ usedAt: new Date(), expiresAt: new Date(0) }), // replayed AND expired
      [],
    );

    await expect(rotateRefreshToken(prisma as never, 'raw-token'))
      .rejects.toThrow(/compromised/);
    expect(revokeCalls).toHaveLength(1); // must trip the alarm, not report "expired"
  });

  it('expired or revoked tokens fail plainly without the theft response', async () => {
    for (const stored of [makeStored({ expiresAt: new Date(0) }), makeStored({ revokedAt: new Date() })]) {
      const { prisma, revokeCalls } = makePrisma(stored, []);
      await expect(rotateRefreshToken(prisma as never, 'raw-token'))
        .rejects.toThrow(/expired/i);
      expect(revokeCalls).toHaveLength(0);
    }
  });

  it('unknown token hash fails without touching anything', async () => {
    const { prisma, revokeCalls } = makePrisma(null, []);
    await expect(rotateRefreshToken(prisma as never, 'raw-token'))
      .rejects.toThrow(/Invalid session/);
    expect(revokeCalls).toHaveLength(0);
  });
});
