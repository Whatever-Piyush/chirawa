import crypto from 'crypto';
import type Redis from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { ValidationError, BusinessRuleError } from '../../shared/errors/app-errors';
import { serviceLogger } from '../../shared/observability/logger';

const log = serviceLogger('otp');

// Redis key helpers — consistent naming prevents typos
const keys = {
  otp:          (phone: string) => `otp:data:${phone}`,
  lockout:      (phone: string) => `otp:lockout:${phone}`,
  ratePhone1h:  (phone: string) => `otp:rate:phone1h:${phone}`,
  ratePhone24h: (phone: string) => `otp:rate:phone24h:${phone}`,
  rateIp1h:     (ip: string)   => `otp:rate:ip1h:${ip}`,
};

interface OtpData {
  code: string;
  attempts: number;
  createdAt: number;
}

export function createOtpService(redis: Redis, prisma: PrismaClient) {
  // ── Rate Limit Check ───────────────────────────────────────────────────────
  async function checkRateLimits(phone: string, ip: string): Promise<void> {
    // Check lockout first
    const locked = await redis.get(keys.lockout(phone));
    if (locked) {
      throw new BusinessRuleError(
        'Bahut zyada galat OTP. 15 minute baad try karein.',
      );
    }

    const [phone1h, phone24h, ip1h] = await Promise.all([
      redis.get(keys.ratePhone1h(phone)),
      redis.get(keys.ratePhone24h(phone)),
      redis.get(keys.rateIp1h(ip)),
    ]);

    if (parseInt(phone1h ?? '0') >= 3) {
      throw new BusinessRuleError(
        '1 ghante mein zyada OTP nahi milega. Baad mein try karein.',
      );
    }
    if (parseInt(phone24h ?? '0') >= 10) {
      throw new BusinessRuleError(
        'Aaj ke liye OTP limit khatam ho gayi. Kal try karein.',
      );
    }
    if (parseInt(ip1h ?? '0') >= 20) {
      throw new BusinessRuleError(
        'Bahut zyada requests. Thodi der baad try karein.',
      );
    }
  }

  // ── Increment Rate Limit Counters ──────────────────────────────────────────
  async function incrementRateLimits(phone: string, ip: string): Promise<void> {
    const pipeline = redis.pipeline();

    pipeline.incr(keys.ratePhone1h(phone));
    pipeline.expire(keys.ratePhone1h(phone), 3600);
    pipeline.incr(keys.ratePhone24h(phone));
    pipeline.expire(keys.ratePhone24h(phone), 86400);
    pipeline.incr(keys.rateIp1h(ip));
    pipeline.expire(keys.rateIp1h(ip), 3600);

    await pipeline.exec();
  }

  // ── Send OTP ───────────────────────────────────────────────────────────────
  async function sendOtp(phone: string, ip: string): Promise<{ expiresInSeconds: number }> {
    await checkRateLimits(phone, ip);

    // NEVER use Math.random() for OTPs — not cryptographically random
    const code = crypto.randomInt(100000, 1000000).toString();
    const otpData: OtpData = { code, attempts: 0, createdAt: Date.now() };

    // Store in Redis — 5 minute TTL
    await redis.setex(keys.otp(phone), 300, JSON.stringify(otpData));
    await incrementRateLimits(phone, ip);

    // Log to DB for audit
    await prisma.otpAttempt.create({
      data: {
        phone,
        ipAddress: ip,
        isSuccessful: false,
        expiresAt: new Date(Date.now() + 300_000),
      },
    });

    // Send SMS
    await dispatchOtp(phone, code);

    return { expiresInSeconds: 300 };
  }

  // ── Verify OTP ─────────────────────────────────────────────────────────────
  async function verifyOtp(phone: string, code: string): Promise<void> {
    // Dev bypass — 123456 always passes in non-production environments
    if (process.env.NODE_ENV === 'development' && code === '123456') {
      return;
    }

    // Check lockout
    const locked = await redis.get(keys.lockout(phone));
    if (locked) {
      throw new BusinessRuleError(
        'Bahut zyada galat OTP. 15 minute baad try karein.',
      );
    }

    const raw = await redis.get(keys.otp(phone));
    if (!raw) {
      throw new ValidationError('OTP expire ho gaya. Nayi OTP mangaiye.');
    }

    const otpData = JSON.parse(raw) as OtpData;

    if (otpData.code !== code) {
      otpData.attempts += 1;

      if (otpData.attempts >= 5) {
        // Lock for 15 minutes
        await redis.del(keys.otp(phone));
        await redis.setex(keys.lockout(phone), 900, '1');
        throw new BusinessRuleError(
          '5 baar galat OTP. 15 minute ke liye locked. Dobara OTP mangaiye.',
        );
      }

      // Update attempt count in Redis
      await redis.setex(keys.otp(phone), 300, JSON.stringify(otpData));
      throw new ValidationError(
        `Galat OTP. ${5 - otpData.attempts} aur try baaki hain.`,
      );
    }

    // Correct — delete OTP so it can't be reused
    await redis.del(keys.otp(phone));

    // Mark successful in DB
    await prisma.otpAttempt.create({
      data: {
        phone,
        isSuccessful: true,
        expiresAt: new Date(Date.now() + 300_000),
      },
    });
  }

  // ── SMS Dispatch ───────────────────────────────────────────────────────────
  async function dispatchOtp(phone: string, code: string): Promise<void> {
    if (env.NODE_ENV !== 'production') {
      // Dev mode — log OTP so you can test without SMS credits
      log.warn({ phone, code }, 'DEV OTP (not sent — non-production)');
      return;
    }

    // Production — Fast2SMS. Route 'otp' rides Fast2SMS's OWN DLT-approved
    // template ("Your OTP: {#var#}"), so OTP login needs no DLT registration
    // of ours (Phase 5 §5) — unlike sms.service's transactional templates.
    try {
      const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          authorization: env.FAST2SMS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          route: 'otp',
          variables_values: code,
          numbers: phone,
        }),
      });

      if (!response.ok) {
        log.error({ status: response.status, body: await response.text() }, 'Fast2SMS error');
      }
    } catch (err) {
      // SMS failure should NOT fail login — log and continue
      log.error({ err }, 'SMS dispatch failed (non-fatal)');
    }
  }

  return { sendOtp, verifyOtp };
}
