import { z } from 'zod';

const envSchema = z.object({
  // ── Server ──────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),

  // ── Database ─────────────────────────────────────────────────────────────
  // Required — server won't start without a DB URL
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // ── Redis ────────────────────────────────────────────────────────────────
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // ── JWT ──────────────────────────────────────────────────────────────────
  // Required for auth — but can be placeholder in early dev (auth won't work)
  JWT_PRIVATE_KEY: z.string().min(1, 'JWT_PRIVATE_KEY is required'),
  JWT_PUBLIC_KEY: z.string().min(1, 'JWT_PUBLIC_KEY is required'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN_DAYS: z.coerce.number().int().default(7),

  // ── External Services ─────────────────────────────────────────────────────
  // Optional in dev — real values needed before going live
  RAZORPAY_KEY_ID: z.string().default('rzp_test_placeholder'),
  RAZORPAY_KEY_SECRET: z.string().default('placeholder'),
  RAZORPAY_WEBHOOK_SECRET: z.string().default('placeholder'),
  FCM_SERVICE_ACCOUNT_JSON: z.string().default('{}'),
  FAST2SMS_API_KEY: z.string().default('placeholder'),
  GOOGLE_MAPS_API_KEY: z.string().default('placeholder'),

  // ── Cloudflare R2 ─────────────────────────────────────────────────────────
  R2_ACCOUNT_ID: z.string().default('placeholder'),
  R2_ACCESS_KEY_ID: z.string().default('placeholder'),
  R2_SECRET_ACCESS_KEY: z.string().default('placeholder'),
  R2_BUCKET_NAME: z.string().default('chirawa-assets'),
  R2_PUBLIC_URL: z.string().default('http://localhost:3000'),

  // ── App Config ────────────────────────────────────────────────────────────
  APP_NAME: z.string().default('Chirawa'),
  FRONTEND_URLS: z.string().default('http://localhost:3001'),
  // ₹2000 in paise — rider COD float cap
  COD_FLOAT_CAP_PAISE: z.coerce.number().int().default(200000),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('\n❌ Invalid environment variables:\n');
    const errors = result.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  ${key}: ${messages?.join(', ')}`);
    });
    console.error('\nFix these in apps/api/.env then restart.\n');
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();
