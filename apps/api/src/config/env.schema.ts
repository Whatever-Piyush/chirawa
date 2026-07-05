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

const looksLikePlaceholder = (value: string): boolean =>
  value.toLowerCase().includes('placeholder');

export const envSchema = z
  .object({
    // ── Server ──────────────────────────────────────────────────────────────
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default('0.0.0.0'),
    // Fastify trustProxy: 'true'/'false', a hop count ('1'), or a comma list of
    // trusted proxy IPs/CIDRs ('127.0.0.1,::1'). 'true' trusts EVERY client's
    // X-Forwarded-For — fine in dev, spoofable rate-limit keys if the API port
    // is directly reachable in prod. Set to the real proxy hops when deploying.
    TRUST_PROXY: z
      .string()
      .default('true')
      .transform((v): boolean | number | string[] => {
        const t = v.trim();
        if (t === 'true') return true;
        if (t === 'false') return false;
        if (/^\d+$/.test(t)) return Number(t);
        return t.split(',').map((s) => s.trim()).filter(Boolean);
      }),

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
  // Production hard-fail: no Razorpay secret may still be a placeholder (0.2).
  // Only enforced in production so local/dev/test can keep running on defaults.
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
  });

export type Env = z.infer<typeof envSchema>;
