import type { PrismaClient } from '@prisma/client';

// ─── Food module configuration (Food.md §3, §5) ───────────────────────────────
// EVERY business number for Food lives here, config-first: the flat delivery
// fee, the UPI-only payment rule, the 30–50 min ETA band, the markup engine
// (0% at launch; percentage / fixed / per-restaurant / per-category later), and
// the cart policy (one restaurant per food order — a config value, NOT a
// hardcoded "forever"). Overrides come from the existing AppConfig table under
// the `food.config` key; these constants are the documented launch defaults.
// The marketplace FeeRule / pricing.service are NOT involved (isolation).

export const FOOD_CONFIG_KEY = 'food.config';

export interface FoodMarkupRule {
  percent?: number;    // e.g. 10 → +10%
  fixedPaise?: number; // e.g. 500 → +₹5 per item
}

export interface FoodConfig {
  deliveryFeePaise: number; // flat — ₹30 at launch (Food.md §5)
  payment: {
    onlineOnly: boolean;        // COD shown as "Coming Soon" (disabled) while true
    allowedMethods: string[];   // ['upi'] at launch — no other method anywhere
  };
  eta: { minMinutes: number; maxMinutes: number }; // "30–50 mins" header band
  markup: {
    defaultPercent: number;
    defaultFixedPaise: number;
    perRestaurant: Record<string, FoodMarkupRule>; // restaurantId → rule
    perCategory: Record<string, FoodMarkupRule>;   // menuCategoryId → rule
  };
  cartPolicy: {
    // 1 = one restaurant per food order (Food.md §4). Raising this later is the
    // entire "multi-restaurant checkout" switch — no call-site rewrites.
    maxRestaurantsPerFoodOrder: number;
  };
  ops: {
    // food-reconcile sweep cadence (launch hardening).
    reconcileIntervalSeconds: number;
    // Don't touch pending_payment orders younger than this — gives the client
    // verify-payment call its fair chance before the sweep intervenes.
    reconcileMinAgeSeconds: number;
    // pending_payment with NO captured Razorpay payment after this → auto-cancel.
    pendingPaymentExpiryMinutes: number;
    // paid but unaccepted by the restaurant after this → auto-cancel + refund.
    acceptTimeoutMinutes: number;
  };
}

export const DEFAULT_FOOD_CONFIG: FoodConfig = {
  deliveryFeePaise: 3_000, // ₹30 flat
  payment: { onlineOnly: true, allowedMethods: ['upi'] },
  eta: { minMinutes: 30, maxMinutes: 50 },
  markup: {
    defaultPercent: 0, // launch decision (Food.md §11.3): customers see real menu prices
    defaultFixedPaise: 0,
    perRestaurant: {},
    perCategory: {},
  },
  cartPolicy: { maxRestaurantsPerFoodOrder: 1 },
  ops: {
    reconcileIntervalSeconds: 120,
    reconcileMinAgeSeconds: 180,
    pendingPaymentExpiryMinutes: 30,
    acceptTimeoutMinutes: 15,
  },
};

// Shallow-per-section merge: an AppConfig override may set just one section
// (e.g. only the fee) without having to restate the whole shape.
export function mergeFoodConfig(override: unknown): FoodConfig {
  if (!override || typeof override !== 'object') return DEFAULT_FOOD_CONFIG;
  const o = override as Partial<Record<keyof FoodConfig, unknown>>;
  const d = DEFAULT_FOOD_CONFIG;
  return {
    deliveryFeePaise:
      typeof o.deliveryFeePaise === 'number' && Number.isInteger(o.deliveryFeePaise) && o.deliveryFeePaise >= 0
        ? o.deliveryFeePaise
        : d.deliveryFeePaise,
    payment:    { ...d.payment,    ...(typeof o.payment    === 'object' && o.payment    ? o.payment    : {}) },
    eta:        { ...d.eta,        ...(typeof o.eta        === 'object' && o.eta        ? o.eta        : {}) },
    markup:     { ...d.markup,     ...(typeof o.markup     === 'object' && o.markup     ? o.markup     : {}) },
    cartPolicy: { ...d.cartPolicy, ...(typeof o.cartPolicy === 'object' && o.cartPolicy ? o.cartPolicy : {}) },
    ops:        { ...d.ops,        ...(typeof o.ops        === 'object' && o.ops        ? o.ops        : {}) },
  };
}

// 60s in-process cache — config changes land within a minute without a DB read
// per request. Failures (missing row, bad JSON) fall back to the defaults so a
// mangled AppConfig row can never take Food down.
const CACHE_TTL_MS = 60_000;
let cached: { at: number; value: FoodConfig } | null = null;

export async function loadFoodConfig(prisma: PrismaClient): Promise<FoodConfig> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  let value = DEFAULT_FOOD_CONFIG;
  try {
    const row = await prisma.appConfig.findUnique({ where: { key: FOOD_CONFIG_KEY } });
    if (row) value = mergeFoodConfig(JSON.parse(row.value));
  } catch {
    /* defaults win — never fail a request over config */
  }
  cached = { at: now, value };
  return value;
}

// Test seam — lets unit/API tests reset the cache between cases.
export function __resetFoodConfigCache(): void {
  cached = null;
}
