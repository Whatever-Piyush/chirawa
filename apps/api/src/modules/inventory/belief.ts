// ─── Inventory belief math (Inventory Engine) ─────────────────────────────────
// Pure functions — no I/O. The stored row (`inventory_state`) holds the belief
// as of the LAST EVENT; everything time-dependent is derived here at read time
// (D7: no cron ever mutates rows with guesses).
//
// Two derived quantities, two jobs:
//   effectiveQty — "how many units can we promise right now"
//   confidence   — "should we promise unverified, or verify first"
//
// Both apply ONLY to count-tracked items (expectedQty != null). Binary items
// (the ~80% tail) keep the pre-engine semantics: `products.stockStatus` is the
// whole story — no decay, no auto-hide, no morning-card pressure. That exemption
// is deliberate: decaying confidence on items with no counts would silently hide
// the entire tail after a few quiet days.

export interface VelocityClassParams {
  tauHours: number; // confidence half-life driver: conf = base × e^(−hours/τ)
  velPerDay: number; // assumed offline consumption (units/day) until EWMA exists
}

export interface InventoryConfig {
  kSigma: number; // drift buffer multiplier (raise → fewer misses, less GMV)
  thetaHide: number; // below → hidden from feed AND routing (one predicate, on purpose)
  thetaFlag: number; // below → accept-screen chip + qty cap
  thetaAuto: number; // auto-accept without rider-verify only above this
  maxShopsPerGroup: number; // resolver shop cap (hard cap 3 enforced in resolver)
  reservationTtlMin: number; // prepaid hold expiry
  morningCardN: number; // verification card size
  bucketLots: number; // "बहुत है" default qty
  bucketSome: number; // "थोड़ा है" / toggle-in default qty
  classes: Record<number, VelocityClassParams>; // 1=slow 2=medium 3=fast 4=ultra (0=dead: no decay)
}

export const DEFAULT_INVENTORY_CONFIG: InventoryConfig = {
  kSigma: 1.0,
  thetaHide: 0.4,
  thetaFlag: 0.65,
  thetaAuto: 0.65,
  maxShopsPerGroup: 2,
  reservationTtlMin: 15,
  morningCardN: 8,
  bucketLots: 24,
  bucketSome: 8,
  classes: {
    1: { tauHours: 336, velPerDay: 0.2 },
    2: { tauHours: 72, velPerDay: 1.5 },
    3: { tauHours: 24, velPerDay: 6 },
    4: { tauHours: 8, velPerDay: 15 },
  },
};

// The slice of `inventory_state` the math needs. Decimal columns arrive as
// Prisma.Decimal — callers pass Number(confidenceBase).
export interface BeliefState {
  expectedQty: number | null;
  reservedQty: number;
  velocityClass: number | null;
  confidenceBase: number;
  lastVerifiedAt: Date | null;
}

export const DEFAULT_TRACKED_CLASS = 2; // medium — tracked rows without a class

export function isTracked(s: Pick<BeliefState, 'expectedQty'>): boolean {
  return s.expectedQty != null;
}

function classParams(s: BeliefState, cfg: InventoryConfig): VelocityClassParams | null {
  const cls = s.velocityClass ?? DEFAULT_TRACKED_CLASS;
  if (cls === 0) return null; // dead: no decay, no drift
  return cfg.classes[cls] ?? cfg.classes[DEFAULT_TRACKED_CLASS]!;
}

function hoursSinceVerify(s: BeliefState, now: Date): number {
  // A tracked row that was somehow never verified is maximally stale — the
  // backfill and every event set lastVerifiedAt, so this is a safety net.
  if (!s.lastVerifiedAt) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - s.lastVerifiedAt.getTime()) / 3_600_000);
}

/**
 * What we're willing to promise right now. `null` = untracked (no numeric cap —
 * availability is governed by `products.stockStatus` alone).
 *
 *   effective = max(0, expected − reserved − ⌈k × velPerDay × hours/24⌉)
 */
export function effectiveQty(s: BeliefState, cfg: InventoryConfig, now: Date): number | null {
  if (s.expectedQty == null) return null;
  const params = classParams(s, cfg);
  const drift = params
    ? Math.ceil(cfg.kSigma * params.velPerDay * (Math.min(hoursSinceVerify(s, now), 24 * 365) / 24))
    : 0;
  return Math.max(0, s.expectedQty - s.reservedQty - drift);
}

/**
 * P(a promise on this item succeeds), as a calibrated heuristic:
 * base (set by the last event) decayed by time-since-verification.
 * Untracked items return 1 — their gate is `stockStatus`, not this.
 */
export function confidence(s: BeliefState, cfg: InventoryConfig, now: Date): number {
  if (s.expectedQty == null) return 1;
  const params = classParams(s, cfg);
  if (!params) return s.confidenceBase; // dead class: no decay
  const hours = hoursSinceVerify(s, now);
  if (!Number.isFinite(hours)) return 0;
  return s.confidenceBase * Math.exp(-hours / params.tauHours);
}

// One predicate for both visibility and routing (a unified store must never
// show what it has already decided not to promise):
//   normal  — shown, routable, 1-tap accept
//   flagged — shown & routable, but the seller accept screen chips these lines
//   hidden  — out of aggregation AND out of the resolver; morning-card candidate
export type BeliefBand = 'normal' | 'flagged' | 'hidden';

export function beliefBand(s: BeliefState, cfg: InventoryConfig, now: Date): BeliefBand {
  if (s.expectedQty == null) return 'normal';
  const eff = effectiveQty(s, cfg, now)!;
  const conf = confidence(s, cfg, now);
  if (eff <= 0 || conf < cfg.thetaHide) return 'hidden';
  if (conf < cfg.thetaFlag) return 'flagged';
  return 'normal';
}

/**
 * Project the belief onto `products.stockStatus` (the read-side availability
 * every existing catalog/resolver/cart path already consumes). `hidden` is a
 * merchandising state owned by the seller — the projection never touches it.
 */
export function projectStockStatus(
  current: 'available' | 'out_of_stock' | 'hidden',
  band: BeliefBand,
): 'available' | 'out_of_stock' | 'hidden' {
  if (current === 'hidden') return 'hidden';
  return band === 'hidden' ? 'out_of_stock' : 'available';
}
