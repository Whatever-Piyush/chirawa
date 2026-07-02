import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { AuthenticationError } from '../../shared/errors/app-errors';

export interface JwtPayload {
  sub: string;       // userId
  role: string;      // UserRole
  profileId: string; // e.g. customerProfile.id
  iat?: number;
  exp?: number;
}

// Replace literal \n (stored in .env as \\n) with real newlines for PEM format
function parsePemKey(key: string): string {
  return key.replace(/\\n/g, '\n');
}

function getPrivateKey(): string {
  const key = parsePemKey(env.JWT_PRIVATE_KEY);
  if (key.includes('REPLACE_ME')) {
    throw new Error(
      'JWT_PRIVATE_KEY not configured. Run: node scripts/generate-dev-keys.mjs',
    );
  }
  return key;
}

function getPublicKey(): string {
  const key = parsePemKey(env.JWT_PUBLIC_KEY);
  if (key.includes('REPLACE_ME')) {
    throw new Error(
      'JWT_PUBLIC_KEY not configured. Run: node scripts/generate-dev-keys.mjs',
    );
  }
  return key;
}

// ── Access Token ──────────────────────────────────────────────────────────────

export function signAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  // @types/jsonwebtoken ≥9.0.7 narrows expiresIn to ms.StringValue; our env var
  // is a free-form string ("15m") validated by convention, so cast at this edge.
  return jwt.sign(payload, getPrivateKey(), {
    algorithm: 'RS256',
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as NonNullable<jwt.SignOptions['expiresIn']>,
    issuer: 'chirawa-api',
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, getPublicKey(), {
      algorithms: ['RS256'],
      issuer: 'chirawa-api',
    }) as JwtPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AuthenticationError('Token expire ho gaya. Refresh karein.');
    }
    throw new AuthenticationError('Invalid token.');
  }
}

// ── Refresh Token ─────────────────────────────────────────────────────────────

/** Generate a cryptographically random 64-char hex token */
export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** One-way hash for safe storage — we store the hash, never the raw token */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function storeRefreshToken(
  prisma: PrismaClient,
  userId: string,
  token: string,
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + env.JWT_REFRESH_EXPIRES_IN_DAYS);

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
    },
  });
}

export interface RotationResult {
  newAccessToken: string;
  newRefreshToken: string;
  userId: string;
  role: string;
  profileId: string;
}

/** Theft response: kill every live session for the user, forcing re-login. */
async function revokeAllUserSessions(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data:  { revokedAt: new Date() },
  });
}

/**
 * Refresh token rotation:
 * 1. Find token by hash
 * 2. If already used → theft detected → revoke ALL user sessions
 * 3. Atomically CLAIM it (conditional updateMany on usedAt IS NULL) — the
 *    loser of a concurrent double-refresh is treated exactly like reuse (P1-7)
 * 4. Issue new pair
 */
export async function rotateRefreshToken(
  prisma: PrismaClient,
  oldToken: string,
): Promise<RotationResult> {
  const tokenHash = hashToken(oldToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          customerProfile: { select: { id: true } },
          sellerProfile:   { select: { id: true } },
          riderProfile:    { select: { id: true } },
          adminProfile:    { select: { id: true } },
        },
      },
    },
  });

  if (!stored) {
    throw new AuthenticationError('Invalid session. Please login again.');
  }

  // ⚠ Token reuse detected — possible token theft. Fast path: keeps its
  // precedence over the expiry check (a replayed-but-expired token must still
  // trip the alarm, not report a bland "session expired").
  if (stored.usedAt !== null) {
    await revokeAllUserSessions(prisma, stored.userId);
    throw new AuthenticationError(
      'Security alert: session compromised. Please login again.',
    );
  }

  if (stored.revokedAt !== null || stored.expiresAt < new Date()) {
    throw new AuthenticationError('Session expired. Please login again.');
  }

  // Atomically CLAIM the token (P1-7). The old code checked `usedAt === null`
  // and then updated in a second statement — two concurrent refreshes with the
  // same token both passed the check and both minted sessions, racing past the
  // very reuse-detection this exists for. A conditional updateMany is a
  // compare-and-set: under Postgres READ COMMITTED the loser re-evaluates the
  // predicate after the winner commits, matches 0 rows, and lands in the
  // reuse branch. Exactly one caller can ever consume a refresh token.
  const claimed = await prisma.refreshToken.updateMany({
    where: { id: stored.id, usedAt: null },
    data:  { usedAt: new Date() },
  });

  // ⚠ Claim lost → a concurrent rotation consumed this token between our read
  // and the CAS (the exact race the fast path above cannot see). Same
  // treatment as overt reuse: revoke the whole session family and fail.
  if (claimed.count === 0) {
    await revokeAllUserSessions(prisma, stored.userId);
    throw new AuthenticationError(
      'Security alert: session compromised. Please login again.',
    );
  }

  // Resolve profileId
  const { user } = stored;
  let profileId = '';
  if (user.role === 'customer') profileId = user.customerProfile?.id ?? '';
  if (user.role === 'seller')   profileId = user.sellerProfile?.id ?? '';
  if (user.role === 'rider')    profileId = user.riderProfile?.id ?? '';
  if (user.role === 'admin')    profileId = user.adminProfile?.id ?? '';

  // Issue new pair
  const newRefreshToken = generateRefreshToken();
  await storeRefreshToken(prisma, user.id, newRefreshToken);

  const newAccessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    profileId,
  });

  return {
    newAccessToken,
    newRefreshToken,
    userId: user.id,
    role: user.role,
    profileId,
  };
}
