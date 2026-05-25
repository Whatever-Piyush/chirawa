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
  return jwt.sign(payload, getPrivateKey(), {
    algorithm: 'RS256',
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
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

/**
 * Refresh token rotation:
 * 1. Find token by hash
 * 2. If already used → theft detected → revoke ALL user sessions
 * 3. Mark as used, issue new pair
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

  // ⚠ Token reuse detected — possible token theft
  if (stored.usedAt !== null) {
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AuthenticationError(
      'Security alert: session compromised. Please login again.',
    );
  }

  if (stored.revokedAt !== null || stored.expiresAt < new Date()) {
    throw new AuthenticationError('Session expired. Please login again.');
  }

  // Mark old token consumed
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { usedAt: new Date() },
  });

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
