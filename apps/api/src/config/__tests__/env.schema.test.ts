import { describe, it, expect } from 'vitest';
import { envSchema, RAZORPAY_SECRET_KEYS } from '../env.schema';

// Minimum required fields so only the Razorpay placeholder rule is under test.
const realProd = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db:5432/bringly',
  REDIS_URL: 'redis://redis:6379',
  JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----',
  JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----',
  RAZORPAY_KEY_ID: 'rzp_live_AbCdEf123456',
  RAZORPAY_KEY_SECRET: 'realLiveSecretXYZ',
  RAZORPAY_WEBHOOK_SECRET: 'realWebhookSecret123',
};

describe('envSchema — Razorpay placeholder hard-fail in production (0.2)', () => {
  it('accepts production when all Razorpay secrets are real', () => {
    expect(envSchema.safeParse(realProd).success).toBe(true);
  });

  it.each(RAZORPAY_SECRET_KEYS)('rejects production when %s contains "placeholder"', (key) => {
    const result = envSchema.safeParse({ ...realProd, [key]: 'placeholder' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors[key]).toBeTruthy();
    }
  });

  it('rejects production when RAZORPAY_KEY_ID falls back to its placeholder default', () => {
    const { RAZORPAY_KEY_ID: _omit, ...withoutKeyId } = realProd;
    const result = envSchema.safeParse(withoutKeyId); // default = 'rzp_test_placeholder'
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.RAZORPAY_KEY_ID).toBeTruthy();
    }
  });

  it('reports every placeholder secret at once, not just the first', () => {
    const result = envSchema.safeParse({
      ...realProd,
      RAZORPAY_KEY_SECRET: 'placeholder',
      RAZORPAY_WEBHOOK_SECRET: 'rzp_placeholder_value',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(fields.RAZORPAY_KEY_SECRET).toBeTruthy();
      expect(fields.RAZORPAY_WEBHOOK_SECRET).toBeTruthy();
    }
  });

  it('allows placeholders outside production (development on defaults)', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/dev',
      REDIS_URL: 'redis://localhost:6379',
      JWT_PRIVATE_KEY: 'k',
      JWT_PUBLIC_KEY: 'k',
      // Razorpay omitted → placeholder defaults apply, must be fine in dev.
    });
    expect(result.success).toBe(true);
  });

  it('allows placeholders in the test environment', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost/test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_PRIVATE_KEY: 'k',
      JWT_PUBLIC_KEY: 'k',
    });
    expect(result.success).toBe(true);
  });
});
