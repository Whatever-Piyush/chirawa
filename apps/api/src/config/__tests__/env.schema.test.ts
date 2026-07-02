import { describe, it, expect } from 'vitest';
import {
  envSchema,
  collectProductionWarnings,
  RAZORPAY_SECRET_KEYS,
  PROD_REQUIRED_SERVICE_KEYS,
  PROD_NO_LOCALHOST_KEYS,
  type Env,
} from '../env.schema';

// Minimum viable PRODUCTION env — every hard-fail rule satisfied, so each test
// below breaks exactly one thing.
const realProd = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db:5432/bringly',
  REDIS_URL: 'redis://redis:6379',
  JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----',
  JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----',
  RAZORPAY_KEY_ID: 'rzp_live_AbCdEf123456',
  RAZORPAY_KEY_SECRET: 'realLiveSecretXYZ',
  RAZORPAY_WEBHOOK_SECRET: 'realWebhookSecret123',
  FAST2SMS_API_KEY: 'realFast2SmsKey123',
  R2_ACCOUNT_ID: 'realR2Account',
  R2_ACCESS_KEY_ID: 'realR2AccessKey',
  R2_SECRET_ACCESS_KEY: 'realR2Secret',
  R2_PUBLIC_URL: 'https://assets.chirawa.in',
  FRONTEND_URLS: 'https://chirawa.in',
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

describe('envSchema — NODE_ENV must be explicit (Hardening Phase 2, task 4)', () => {
  it('rejects when NODE_ENV is missing — no silent development default', () => {
    const { NODE_ENV: _omit, ...withoutNodeEnv } = realProd;
    const result = envSchema.safeParse(withoutNodeEnv);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.NODE_ENV?.join(' ')).toMatch(/explicitly/);
    }
  });

  it('rejects unknown NODE_ENV values', () => {
    const result = envSchema.safeParse({ ...realProd, NODE_ENV: 'prod' });
    expect(result.success).toBe(false);
  });
});

describe('envSchema — load-bearing service credentials in production (P2 t3/t6)', () => {
  it.each(PROD_REQUIRED_SERVICE_KEYS)('rejects production when %s is a placeholder', (key) => {
    const result = envSchema.safeParse({ ...realProd, [key]: 'placeholder' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors[key]).toBeTruthy();
    }
  });

  it.each(PROD_REQUIRED_SERVICE_KEYS)(
    'rejects production when %s falls back to its schema default',
    (key) => {
      const { [key]: _omit, ...without } = realProd;
      const result = envSchema.safeParse(without);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors[key]).toBeTruthy();
      }
    },
  );

  it.each(PROD_NO_LOCALHOST_KEYS)('rejects production when %s points at localhost', (key) => {
    const result = envSchema.safeParse({ ...realProd, [key]: 'http://localhost:3001' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors[key]).toBeTruthy();
    }
  });

  it('rejects production when a JWT key is still the .env.example template', () => {
    const result = envSchema.safeParse({
      ...realProd,
      JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nPASTE_GENERATED_KEY_HERE\n-----END PUBLIC KEY-----',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.JWT_PUBLIC_KEY).toBeTruthy();
    }
  });

  it('allows all of these to stay on defaults in development', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/dev',
      REDIS_URL: 'redis://localhost:6379',
      JWT_PRIVATE_KEY: 'k',
      JWT_PUBLIC_KEY: 'k',
    });
    expect(result.success).toBe(true);
  });
});

describe('collectProductionWarnings — designed degradations warn, not fail', () => {
  const parse = (overrides: Record<string, string> = {}): Env => {
    const result = envSchema.safeParse({ ...realProd, ...overrides });
    if (!result.success) throw new Error('fixture should parse');
    return result.data;
  };

  it('warns on every default-configured optional service', () => {
    const warnings = collectProductionWarnings(parse());
    expect(warnings.join('\n')).toMatch(/push notifications/i);
    expect(warnings.join('\n')).toMatch(/MAPPLS/);
    expect(warnings.join('\n')).toMatch(/payouts/i);
    expect(warnings.join('\n')).toMatch(/Sentry/);
    expect(warnings).toHaveLength(4);
  });

  it('is silent when every optional service is configured', () => {
    const warnings = collectProductionWarnings(
      parse({
        FCM_SERVICE_ACCOUNT_JSON: '{"project_id":"real"}',
        MAPPLS_CLIENT_ID: 'realId',
        MAPPLS_CLIENT_SECRET: 'realSecret',
        MAPPLS_REST_KEY: 'realKey',
        RAZORPAYX_ACCOUNT_NUMBER: '2323230000000000',
        SENTRY_DSN: 'https://x@o0.ingest.sentry.io/0',
      }),
    );
    expect(warnings).toHaveLength(0);
  });
});
