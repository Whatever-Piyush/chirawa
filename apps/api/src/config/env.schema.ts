import { z } from 'zod';

// Pure schema, kept separate from env.ts so it can be unit-tested without the
// module-load side effect (env.ts calls validateEnv() → process.exit on import).

// Razorpay credentials that MUST be real before running in production. A
// placeholder here is dangerous: razorpay.service treats unconfigured keys as
// "dev mock" and skips signature verification, so webhooks can't be trusted and
// prepaid orders are effectively free (0.2).
export const RAZORPAY_SECRET_KEYS = [
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
] as const;

// Further credentials that hard-fail production boot when left on their dev
// placeholder (Hardening Phase 2, tasks 3+6). Rationale per key:
//   FAST2SMS_API_KEY — OTP SMS dispatch; placeholder = nobody can log in.
//   R2_*             — asset uploads AND the fallback credentials for DB
//                      backups (backup-core `pick('BACKUP_R2_*', 'R2_*')`);
//                      placeholder = uploads refused + backups unconfigured.
export const PROD_REQUIRED_SERVICE_KEYS = [
  'FAST2SMS_API_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const;

// URL values whose localhost defaults must never survive into production:
//   FRONTEND_URLS — CORS allowlist (HTTP + Socket.IO); localhost = web
//                   clients blocked or, worse, a dev origin trusted in prod.
//   R2_PUBLIC_URL — base for every stored image URL we hand to the apps.
export const PROD_NO_LOCALHOST_KEYS = ['FRONTEND_URLS', 'R2_PUBLIC_URL'] as const;

const looksLikePlaceholder = (value: string): boolean =>
  value.toLowerCase().includes('placeholder');

const looksLikeLocalhost = (value: string): boolean =>
  /localhost|127\.0\.0\.1/i.test(value);

// Copy-paste artifact from .env.example's JWT template lines.
const JWT_TEMPLATE_MARKER = 'PASTE_GENERATED_KEY_HERE';

export const envSchema = z
  .object({
    // ── Server ──────────────────────────────────────────────────────────────
    // NO default — a silently-unset NODE_ENV used to mean 'development', which
    // in prod would enable the 123456 OTP bypass, log OTPs instead of sending
    // SMS, and relax rate limits. Every entrypoint must set it explicitly
    // (local: apps/api/.env; server: PM2 env_production + /opt/chirawa .env).
    NODE_ENV: z.enum(['development', 'test', 'production'], {
      required_error:
        'NODE_ENV must be set explicitly (development | test | production) — it no longer defaults to development',
    }),
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
    // RazorpayX source account number for seller payouts (0.3). Payouts only run
    // when this is set AND the Razorpay keys are real; otherwise settlements stay
    // pending rather than faking a payout.
    RAZORPAYX_ACCOUNT_NUMBER: z.string().default('placeholder'),
    FCM_SERVICE_ACCOUNT_JSON: z.string().default('{}'),
    FAST2SMS_API_KEY: z.string().default('placeholder'),
    // Google Maps key — now only used by the customer app's Android map render
    // (set in app.json), NOT the backend geo proxy. Kept for reference/back-compat.
    GOOGLE_MAPS_API_KEY: z.string().default('placeholder'),
    // Mappls (MapmyIndia) — backend geo proxy: place search + reverse geocoding.
    // client_id/secret mint a 24h OAuth token used for Autosuggest; the REST key
    // is used for the rev_geocode endpoint. Any placeholder ⇒ the matching /geo/*
    // endpoint returns empty/none and the app falls back to its on-device geocoder.
    MAPPLS_CLIENT_ID: z.string().default('placeholder'),
    MAPPLS_CLIENT_SECRET: z.string().default('placeholder'),
    MAPPLS_REST_KEY: z.string().default('placeholder'),

    // ── Cloudflare R2 ─────────────────────────────────────────────────────────
    R2_ACCOUNT_ID: z.string().default('placeholder'),
    R2_ACCESS_KEY_ID: z.string().default('placeholder'),
    R2_SECRET_ACCESS_KEY: z.string().default('placeholder'),
    R2_BUCKET_NAME: z.string().default('chirawa-assets'),
    R2_PUBLIC_URL: z.string().default('http://localhost:3000'),
    // Canonical fallback tile for missing images (Catalog Engine Phase 1). Used
    // where a concrete URL is required (e.g. aggregated feed served from
    // MasterCatalog, notifications); the customer apps render their own native
    // placeholder for null images, so this never overrides that.
    PLACEHOLDER_IMAGE_URL: z.string().default('https://placehold.co/1200x1200/EEEEEE/999999.webp?text=No+Image'),
    // ── Catalog enrichment (Phase 2) ──────────────────────────────────────────
    // Path to a local Open Food Facts JSONL bulk dump for image enrichment. Empty
    // = no dump (the worker marks items needs_manual). Bulk enrichment never uses
    // the live OFF API (rate-limit / IP-ban risk).
    OFF_DUMP_PATH: z.string().default(''),
    // Descriptive User-Agent for the live OFF API (seller-scan single-item lookup,
    // Phase 3). OFF requires identifying yourself; include a real contact.
    OFF_USER_AGENT: z.string().default('Bringly/1.0 (catalog@bringly.example)'),

    // ── Observability ─────────────────────────────────────────────────────────
    // Sentry is OPTIONAL: an empty DSN disables it (no-op), so dev/local don't
    // need it. Set both in production for error tracking with release tagging (4.1).
    SENTRY_DSN:     z.string().default(''),
    SENTRY_RELEASE: z.string().default(''),

    // ── App Config ────────────────────────────────────────────────────────────
    APP_NAME: z.string().default('Chirawa'),
    FRONTEND_URLS: z.string().default('http://localhost:3001'),
    // ₹2000 in paise — rider COD float cap
    COD_FLOAT_CAP_PAISE: z.coerce.number().int().default(200000),
  })
  // Production hard-fails — only enforced in production so local/dev/test can
  // keep running on defaults:
  //   • no Razorpay secret may still be a placeholder (0.2)
  //   • no load-bearing service credential may still be a placeholder (P2 t3/t6)
  //   • no CORS/asset URL may still point at localhost
  //   • JWT keys must not be the .env.example template value
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of RAZORPAY_SECRET_KEYS) {
      if (looksLikePlaceholder(env[key])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is still a placeholder — set the real Razorpay credential before running in production`,
        });
      }
    }
    for (const key of PROD_REQUIRED_SERVICE_KEYS) {
      if (looksLikePlaceholder(env[key])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is still a placeholder — this service is load-bearing in production (OTP login / asset uploads / DB backups)`,
        });
      }
    }
    for (const key of PROD_NO_LOCALHOST_KEYS) {
      if (looksLikeLocalhost(env[key])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} points at localhost — set the real production URL(s)`,
        });
      }
    }
    for (const key of ['JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY'] as const) {
      if (env[key].includes(JWT_TEMPLATE_MARKER)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} still contains the .env.example template value — generate real keys (node scripts/generate-dev-keys.mjs, or a prod-only pair)`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

// Non-fatal production degradations. These services have designed fallbacks
// (feature stays off / pending rather than broken), so they warn loudly at
// boot instead of blocking it. Fatal problems belong in the superRefine above.
export function collectProductionWarnings(env: Env): string[] {
  const warnings: string[] = [];
  if (env.FCM_SERVICE_ACCOUNT_JSON === '{}') {
    warnings.push('FCM_SERVICE_ACCOUNT_JSON is unset — push notifications are DISABLED');
  }
  if (
    [env.MAPPLS_CLIENT_ID, env.MAPPLS_CLIENT_SECRET, env.MAPPLS_REST_KEY].some(looksLikePlaceholder)
  ) {
    warnings.push('MAPPLS_* has placeholder(s) — /geo/* place search + reverse geocoding return empty; apps fall back to on-device geocoder');
  }
  if (looksLikePlaceholder(env.RAZORPAYX_ACCOUNT_NUMBER)) {
    warnings.push('RAZORPAYX_ACCOUNT_NUMBER is a placeholder — seller payouts stay PENDING (no payout source account)');
  }
  if (env.SENTRY_DSN === '') {
    warnings.push('SENTRY_DSN is empty — Sentry error tracking is DISABLED');
  }
  return warnings;
}
