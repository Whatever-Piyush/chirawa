import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { createOtpService } from './otp.service';
import { normalizePhone } from '../../shared/utils/phone';
import {
  signAccessToken,
  generateRefreshToken,
  storeRefreshToken,
  rotateRefreshToken,
  hashToken,
} from './token.service';
import { ValidationError, NotFoundError, BusinessRuleError } from '../../shared/errors/app-errors';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  isNewUser: boolean;
  requiresPin: boolean;
  userId: string;
  role: string;
}

/** 6-char alphanumeric referral code — no confusing characters (0/O, 1/I/l) */
function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return code;
}

export function createAuthService(prisma: PrismaClient, redis: Redis) {
  const otpService = createOtpService(redis, prisma);

  // ── Send OTP ───────────────────────────────────────────────────────────────
  async function sendOtp(
    rawPhone: string,
    ipAddress: string,
  ): Promise<{ message: string; expiresInSeconds: number }> {
    const phone = normalizePhone(rawPhone);
    const result = await otpService.sendOtp(phone, ipAddress);
    return {
      message: 'OTP bhej diya gaya',
      expiresInSeconds: result.expiresInSeconds,
    };
  }

  // ── Verify OTP + Login / Signup ────────────────────────────────────────────
  async function verifyOtp(
    rawPhone: string,
    otp: string,
    referralCode?: string,
  ): Promise<AuthResult> {
    const phone = normalizePhone(rawPhone);
    await otpService.verifyOtp(phone, otp);

    // Find existing user or create new
    let user = await prisma.user.findUnique({ where: { phone } });
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      user = await prisma.user.create({
        data: {
          phone,
          role: 'customer',
          customerProfile: {
            create: {},
          },
        },
      });

      // Generate unique referral code for new user
      let code: string;
      let attempts = 0;
      do {
        code = generateReferralCode();
        attempts++;
        if (attempts > 10) throw new Error('Could not generate unique referral code');
      } while (await prisma.referralCode.findUnique({ where: { code } }));

      await prisma.referralCode.create({
        data: { code, ownerUserId: user.id },
      });

      // Process referral if provided
      if (referralCode) {
        await processReferral(user.id, referralCode);
      }
    }

    // Load full profile to get profileId
    const fullUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: {
        customerProfile: { select: { id: true } },
        sellerProfile:   { select: { id: true, pinHash: true } },
        riderProfile:    { select: { id: true, pinHash: true } },
        adminProfile:    { select: { id: true } },
      },
    });

    let profileId = '';
    let requiresPin = false;

    if (fullUser.role === 'customer') {
      profileId = fullUser.customerProfile?.id ?? '';
    } else if (fullUser.role === 'seller') {
      profileId = fullUser.sellerProfile?.id ?? '';
      requiresPin = !fullUser.sellerProfile?.pinHash;
    } else if (fullUser.role === 'rider') {
      profileId = fullUser.riderProfile?.id ?? '';
      requiresPin = !fullUser.riderProfile?.pinHash;
    } else if (fullUser.role === 'admin') {
      profileId = fullUser.adminProfile?.id ?? '';
      requiresPin = !fullUser.adminProfile?.pinHash;
    }

    // Issue tokens
    const accessToken = signAccessToken({
      sub: user.id,
      role: user.role,
      profileId,
    });
    const refreshToken = generateRefreshToken();
    await storeRefreshToken(prisma, user.id, refreshToken);

    // Access token expires in 15 minutes = 900 seconds
    return {
      accessToken,
      refreshToken,
      expiresIn: 900,
      isNewUser,
      requiresPin,
      userId: user.id,
      role: user.role,
    };
  }

  // ── Process Referral ───────────────────────────────────────────────────────
  async function processReferral(
    newUserId: string,
    referralCode: string,
  ): Promise<void> {
    const code = await prisma.referralCode.findUnique({
      where: { code: referralCode.toUpperCase() },
    });

    if (!code) return; // Invalid code — silently ignore

    // Cannot refer yourself
    if (code.ownerUserId === newUserId) return;

    // Already redeemed
    const existing = await prisma.referralRedemption.findUnique({
      where: { referredUserId: newUserId },
    });
    if (existing) return;

    await prisma.referralRedemption.create({
      data: {
        referralCodeId: code.id,
        referredUserId: newUserId,
        referrerCreditStatus: 'pending',
        refereeCreditStatus: 'pending',
      },
    });
  }

  // ── Refresh Tokens ─────────────────────────────────────────────────────────
  async function refresh(oldRefreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const result = await rotateRefreshToken(prisma, oldRefreshToken);
    return {
      accessToken: result.newAccessToken,
      refreshToken: result.newRefreshToken,
      expiresIn: 900,
    };
  }

  // ── Logout ─────────────────────────────────────────────────────────────────
  async function logout(userId: string, refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash, userId },
      data: { revokedAt: new Date() },
    });
  }

  // ── Set PIN (seller / rider / admin after first login) ────────────────────
  async function setPin(userId: string, role: string, pin: string): Promise<void> {
    const pinHash = await bcrypt.hash(pin, 12);

    if (role === 'seller') {
      await prisma.sellerProfile.update({
        where: { userId },
        data: { pinHash, pinFailCount: 0 },
      });
    } else if (role === 'rider') {
      await prisma.riderProfile.update({
        where: { userId },
        data: { pinHash, pinFailCount: 0 },
      });
    } else if (role === 'admin') {
      await prisma.adminProfile.update({
        where: { userId },
        data: { pinHash },
      });
    } else {
      throw new ValidationError('PIN sirf seller, rider, aur admin ke liye hai');
    }
  }

  // ── Verify PIN ─────────────────────────────────────────────────────────────
  async function verifyPin(userId: string, role: string, pin: string): Promise<void> {
    let storedHash: string | null = null;
    let failCount = 0;
    let lockedUntil: Date | null = null;

    if (role === 'seller') {
      const profile = await prisma.sellerProfile.findUniqueOrThrow({ where: { userId } });
      storedHash = profile.pinHash;
      failCount = profile.pinFailCount;
      lockedUntil = profile.pinLockedUntil;
    } else if (role === 'rider') {
      const profile = await prisma.riderProfile.findUniqueOrThrow({ where: { userId } });
      storedHash = profile.pinHash;
      failCount = profile.pinFailCount;
      lockedUntil = profile.pinLockedUntil;
    } else {
      throw new ValidationError('Invalid role for PIN verification');
    }

    if (lockedUntil && lockedUntil > new Date()) {
      throw new BusinessRuleError('PIN locked. 15 minute baad try karein.');
    }

    if (!storedHash) {
      throw new ValidationError('PIN set nahi hua. Pehle PIN set karein.');
    }

    const isValid = await bcrypt.compare(pin, storedHash);

    if (!isValid) {
      const newFailCount = failCount + 1;
      const updateData =
        newFailCount >= 5
          ? {
              pinFailCount: newFailCount,
              pinLockedUntil: new Date(Date.now() + 15 * 60 * 1000),
            }
          : { pinFailCount: newFailCount };

      if (role === 'seller') {
        await prisma.sellerProfile.update({ where: { userId }, data: updateData });
      } else {
        await prisma.riderProfile.update({ where: { userId }, data: updateData });
      }

      if (newFailCount >= 5) {
        throw new BusinessRuleError('5 baar galat PIN. 15 minute ke liye locked.');
      }

      throw new ValidationError(
        `Galat PIN. ${5 - newFailCount} aur try baaki hain.`,
      );
    }

    // Success — reset fail count
    const resetData = { pinFailCount: 0, pinLockedUntil: null };
    if (role === 'seller') {
      await prisma.sellerProfile.update({ where: { userId }, data: resetData });
    } else {
      await prisma.riderProfile.update({ where: { userId }, data: resetData });
    }
  }

  return { sendOtp, verifyOtp, refresh, logout, setPin, verifyPin };
}
