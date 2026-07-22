import { DEFAULT_INVENTORY_CONFIG, type InventoryConfig } from './belief';

// ─── AppConfig-backed inventory tuning (Inventory Engine) ─────────────────────
// Every knob is an `inv.*` row in the existing AppConfig key/value table so ops
// can retune thresholds without a deploy. Missing/invalid rows fall back to the
// defaults in belief.ts. Cached in-process for 60s — these change rarely and
// the belief math runs on hot paths (resolver, feed build, cart add).

// Minimal client slice — works with PrismaClient AND a transaction client.
export interface AppConfigReader {
  appConfig: {
    findMany: (args: {
      where: { key: { startsWith: string } };
    }) => Promise<Array<{ key: string; value: string }>>;
  };
}

const CACHE_TTL_MS = 60_000;

let cached: { at: number; cfg: InventoryConfig } | null = null;

function num(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Pure parse — exported for tests. Unknown keys ignored; bad values fall back. */
export function parseInventoryConfig(rows: Array<{ key: string; value: string }>): InventoryConfig {
  const kv = new Map(rows.map((r) => [r.key, r.value]));
  const d = DEFAULT_INVENTORY_CONFIG;
  return {
    kSigma: num(kv.get('inv.k_sigma'), d.kSigma),
    thetaHide: num(kv.get('inv.theta_hide'), d.thetaHide),
    thetaFlag: num(kv.get('inv.theta_flag'), d.thetaFlag),
    thetaAuto: num(kv.get('inv.theta_auto'), d.thetaAuto),
    maxShopsPerGroup: Math.min(3, Math.max(1, num(kv.get('inv.max_shops_per_group'), d.maxShopsPerGroup))),
    reservationTtlMin: num(kv.get('inv.reservation_ttl_min'), d.reservationTtlMin),
    morningCardN: num(kv.get('inv.morning_card_n'), d.morningCardN),
    bucketLots: num(kv.get('inv.bucket_lots'), d.bucketLots),
    bucketSome: num(kv.get('inv.bucket_some'), d.bucketSome),
    classes: {
      1: { tauHours: num(kv.get('inv.tau.slow'), d.classes[1]!.tauHours), velPerDay: num(kv.get('inv.vel.slow'), d.classes[1]!.velPerDay) },
      2: { tauHours: num(kv.get('inv.tau.med'), d.classes[2]!.tauHours), velPerDay: num(kv.get('inv.vel.med'), d.classes[2]!.velPerDay) },
      3: { tauHours: num(kv.get('inv.tau.fast'), d.classes[3]!.tauHours), velPerDay: num(kv.get('inv.vel.fast'), d.classes[3]!.velPerDay) },
      4: { tauHours: num(kv.get('inv.tau.ultra'), d.classes[4]!.tauHours), velPerDay: num(kv.get('inv.vel.ultra'), d.classes[4]!.velPerDay) },
    },
  };
}

export async function getInventoryConfig(prisma: AppConfigReader): Promise<InventoryConfig> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.cfg;
  let rows: Array<{ key: string; value: string }> = [];
  try {
    rows = await prisma.appConfig.findMany({ where: { key: { startsWith: 'inv.' } } });
  } catch {
    // Config must never take ordering down — fall back to defaults.
  }
  const cfg = parseInventoryConfig(rows);
  cached = { at: Date.now(), cfg };
  return cfg;
}

/** Test hook — drop the in-process cache. */
export function resetInventoryConfigCache(): void {
  cached = null;
}
