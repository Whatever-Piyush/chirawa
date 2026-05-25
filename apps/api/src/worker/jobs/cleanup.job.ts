import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';

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

  console.log(`🗑️  Location cleanup: deleted ${result.count} old records`);
}

export async function runOtpCleanup(prisma: PrismaClient): Promise<void> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const result = await prisma.otpAttempt.deleteMany({
    where: { attemptedAt: { lt: oneDayAgo } },
  });

  console.log(`🗑️  OTP cleanup: deleted ${result.count} old attempts`);
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

  console.log(`🗑️  Token cleanup: deleted ${result.count} expired tokens`);
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

  console.log(`🗑️  Cart cleanup: deleted ${result.count} expired carts`);
}
