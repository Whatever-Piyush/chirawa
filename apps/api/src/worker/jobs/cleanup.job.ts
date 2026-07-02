import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { logger } from '../logger';

/**
 * Maintenance cleanup jobs — run nightly.
 *
 * 1. Rider location records older than 7 days → deleted
 * 2. OTP attempts older than 24 hours → deleted
 * 3. Expired refresh tokens → deleted
 * 4. Expired cart DB records → deleted (Redis handles its own TTL)
 */

export async function runLocationCleanup(prisma: PrismaClient): Promise<void> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const result = await prisma.riderLocation.deleteMany({
    where: { recordedAt: { lt: sevenDaysAgo } },
  });

  logger.info({ deleted: result.count }, '🗑️  Location cleanup done');
}

export async function runOtpCleanup(prisma: PrismaClient): Promise<void> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const result = await prisma.otpAttempt.deleteMany({
    where: { attemptedAt: { lt: oneDayAgo } },
  });

  logger.info({ deleted: result.count }, '🗑️  OTP cleanup done');
}

export async function runTokenCleanup(prisma: PrismaClient): Promise<void> {
  const now = new Date();

  // Delete expired OR revoked tokens older than 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { revokedAt: { lt: sevenDaysAgo } },
        { usedAt:    { lt: sevenDaysAgo } },
      ],
    },
  });

  logger.info({ deleted: result.count }, '🗑️  Token cleanup done');
}

export async function runCartCleanup(prisma: PrismaClient, redis: Redis): Promise<void> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const expiredCarts = await prisma.cart.findMany({
    where:  { expiresAt: { lt: oneDayAgo } },
    select: { userId: true },
  });

  // Delete from Redis too
  if (expiredCarts.length > 0) {
    const pipeline = redis.pipeline();
    expiredCarts.forEach((c) => pipeline.del(`cart:${c.userId}`));
    await pipeline.exec();
  }

  const result = await prisma.cart.deleteMany({
    where: { expiresAt: { lt: oneDayAgo } },
  });

  logger.info({ deleted: result.count }, '🗑️  Cart cleanup done');
}
