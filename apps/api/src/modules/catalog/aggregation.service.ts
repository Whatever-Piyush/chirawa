import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { beliefBand, effectiveQty as beliefEffectiveQty } from '../inventory/belief';
import { getInventoryConfig } from '../inventory/inventory.config';

// ─── Aggregated "one store" feed (Catalog Engine Phase 4) ─────────────────────
// Groups active, in-stock Product rows by masterId across active shops → ONE tile
// per master, displayed from the (approved) MasterCatalog canonical name/image,
// shop identity hidden, priced at the LOWEST in-stock price among carrying shops.
// Products with no approved master pass through as their own tile (graceful
// degrade — single shop or long-tail items still show). Plan A: this is pure
// presentation; the concrete shop is chosen by the Phase 5 checkout resolver.
//
// Chirawa is a single serviceable area, so the plan's `catalog:agg:{area}` is one
// key here. The heavy group-across-shops scan is cached in Redis with a
// single-flight lock + TTL jitter so an invalidation can't stampede the DB.

export const AGG_CACHE_KEY = 'catalog:agg:all';
const AGG_LOCK_KEY = 'catalog:agg:lock';

export interface AggTile {
  masterId: string | null;  // null = passthrough (no approved master)
  productId: string;        // representative (cheapest in-stock) product — for cart until the Phase 5 resolver
  name: string;             // canonical (master) name, or the product's own when passthrough
  imageUrl: string | null;
  pricePaise: number;       // lowest in-stock price among carrying shops
  mrpPaise: number | null;
  unit: string | null;
  brand: string | null;
  shopCount: number;        // how many shops carry it (identity hidden, count surfaced)
  // Inventory Engine: max promisable units across carrying shops. null = at
  // least one carrying shop is untracked (no numeric cap). The customer app
  // shows "सिर्फ N बचे" from this and clamps the qty stepper.
  capQty: number | null;
}

// Minimal product shape the grouping needs (matches the Prisma select below).
export interface AggInputProduct {
  id: string;
  name: string;
  price: number;
  mrpPaise: number | null;
  unit: string | null;
  images: { url: string }[];
  master: { id: string; status: string; name: string; imageUrl: string | null; mrpPaise: number | null; unit: string | null; brand: string | null } | null;
  // Read-time promisable qty for TRACKED products (computed in build());
  // null/undefined = untracked (unlimited as far as the tile cap goes).
  effectiveQty?: number | null;
}

/**
 * Pure grouping: collapse in-stock products into tiles. A product counts toward an
 * aggregated tile only when its master is APPROVED (the needs_review gate keeps
 * unapproved canonical data out of the public feed); otherwise it's a passthrough
 * tile from the product's own data. The cheapest carrying shop sets the price.
 */
export function aggregateTiles(products: AggInputProduct[]): AggTile[] {
  // Price ascending so the first product seen per master is the cheapest in-stock.
  const ordered = [...products].sort((a, b) => a.price - b.price);

  const byMaster = new Map<string, AggTile>();
  const passthrough: AggTile[] = [];

  for (const p of ordered) {
    const m = p.master && p.master.status === 'approved' ? p.master : null;
    const cap = p.effectiveQty === undefined ? null : p.effectiveQty;
    if (m) {
      const existing = byMaster.get(m.id);
      if (existing) {
        existing.shopCount += 1; // price stays the min (we're iterating cheapest-first)
        // Any untracked carrier lifts the cap; otherwise the max wins (the
        // resolver can route to whichever shop can cover the qty).
        existing.capQty = existing.capQty == null || cap == null ? null : Math.max(existing.capQty, cap);
      } else {
        byMaster.set(m.id, {
          masterId: m.id,
          productId: p.id,
          name: m.name,
          imageUrl: m.imageUrl ?? p.images[0]?.url ?? null,
          pricePaise: p.price,
          mrpPaise: m.mrpPaise ?? p.mrpPaise,
          unit: m.unit ?? p.unit,
          brand: m.brand,
          shopCount: 1,
          capQty: cap,
        });
      }
    } else {
      passthrough.push({
        masterId: null,
        productId: p.id,
        name: p.name,
        imageUrl: p.images[0]?.url ?? null,
        pricePaise: p.price,
        mrpPaise: p.mrpPaise,
        unit: p.unit,
        brand: null,
        shopCount: 1,
        capQty: cap,
      });
    }
  }

  return [...byMaster.values(), ...passthrough].sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Daily Essentials (TOP_SELLING_SKUS.md) ──────────────────────────────────
// A curated, ordered set of everyday top-selling SKUs for a tier-3 town like
// Chirawa (milk, atta, bread, eggs, oil, dal, tea, soap, biscuits…). Each entry
// resolves to the best IN-STOCK aggregated tile (prefer the exact SKU, else a
// keyword), in this priority order, deduped; out-of-stock entries are skipped.
// Honest: real SKUs at the aggregated lowest price — NOT a fabricated sales rank.
// Phase 2 can blend in real OrderItem sales once Chirawa has traffic.
export interface Essential { key: string; prefer: string; match: RegExp }

export const DAILY_ESSENTIALS: ReadonlyArray<Essential> = [
  // Tier 1 — daily perishables
  { key: 'milk',     prefer: 'Amul Taaza Toned Milk',                  match: /toned milk/i },
  { key: 'bread',    prefer: 'Britannia Whole Wheat Bread',            match: /\bbread\b/i },
  { key: 'eggs',     prefer: 'Farm Fresh Eggs',                        match: /\beggs?\b/i },
  { key: 'dahi',     prefer: 'Amul Masti Dahi',                        match: /\b(dahi|curd)\b/i },
  { key: 'banana',   prefer: 'Fresh Banana',                           match: /banana/i },
  { key: 'onion',    prefer: 'Onion',                                  match: /\bonion\b/i },
  { key: 'potato',   prefer: 'Organically Grown Potato',               match: /potato/i },
  { key: 'tomato',   prefer: 'Tomato Local',                           match: /\btomato\b(?!.*(ketchup|sauce|mayo))/i },
  // Tier 2 — kitchen staples
  { key: 'atta',     prefer: 'Aashirvaad Select Atta',                 match: /\batta\b/i },
  { key: 'rice',     prefer: 'India Gate Classic Basmati Rice',        match: /\brice\b/i },
  { key: 'oil',      prefer: 'Fortune Sunflower Oil',                  match: /\b(sunflower|mustard|refined|edible|soya|soybean|cooking)\b.*\boil\b/i },
  { key: 'sugar',    prefer: 'Madhur Pure Sugar',                      match: /\bsugar\b/i },
  { key: 'salt',     prefer: 'Tata Salt Iodised',                      match: /\bsalt\b/i },
  { key: 'dal',      prefer: 'Tata Sampann Toor Dal',                  match: /\b(toor|moong|chana|arhar|masoor|urad)\b.*\bdal\b/i },
  { key: 'tea',      prefer: 'Tata Tea Gold',                          match: /\btea\b/i },
  { key: 'ghee',     prefer: 'Amul Pure Ghee',                         match: /\bghee\b/i },
  // Tier 3 — everyday snacks & beverages
  { key: 'biscuit',  prefer: 'Parle-G Gold Biscuits',                  match: /parle-?g|biscuit/i },
  { key: 'noodles',  prefer: 'Maggi 2-Minute Masala Noodles',          match: /\bnoodles?\b/i },
  { key: 'namkeen',  prefer: 'Bikaji Bikaneri Bhujia',                 match: /bhujia|namkeen/i },
  { key: 'cold',     prefer: 'Thums Up',                               match: /thums ?up|coca-?cola|\bpepsi\b|\bsprite\b/i },
  { key: 'water',    prefer: 'Bisleri Mineral Water',                  match: /mineral water|bisleri/i },
  // Tier 4 — daily personal & home care
  { key: 'soap',     prefer: 'Lifebuoy Total 10 Soap',                 match: /\bsoap\b/i },
  { key: 'shampoo',  prefer: 'Clinic Plus Strong & Long Shampoo',      match: /shampoo/i },
  { key: 'hairoil',  prefer: 'Parachute Coconut Hair Oil',             match: /hair oil/i },
  { key: 'detergent',prefer: 'Surf Excel Matic Front Load Powder',     match: /detergent|surf excel|\bariel\b/i },
  { key: 'dishwash', prefer: 'Vim Dishwash Gel (Lemon)',               match: /dishwash|\bvim\b/i },
  { key: 'mosquito', prefer: 'Good Knight Gold Flash Refill',          match: /mosquito|good knight|all out/i },
  { key: 'pads',     prefer: 'Whisper Ultra Soft Sanitary Pads (XL+)', match: /sanitary pad|whisper|stayfree|\bsofy\b/i },
];

// Resolve the curated essentials against a live aggregated feed → ordered tiles.
// Prefer an exact (case-insensitive) name match, else the first keyword match;
// each tile used at most once; out-of-stock (absent from the feed) skipped.
export function pickDailyEssentials(
  tiles: AggTile[], essentials: ReadonlyArray<Essential> = DAILY_ESSENTIALS, limit = 30,
): AggTile[] {
  const used = new Set<string>();
  const out: AggTile[] = [];
  for (const e of essentials) {
    if (out.length >= limit) break;
    const want = e.prefer.toLowerCase();
    const exact = tiles.find((t) => !used.has(t.productId) && t.name.toLowerCase() === want);
    const tile = exact ?? tiles.find((t) => !used.has(t.productId) && e.match.test(t.name));
    if (tile) { used.add(tile.productId); out.push(tile); }
  }
  return out;
}

export interface AggDeps {
  sleep?: (ms: number) => Promise<void>;
  ttlSeconds?: number;     // base cache TTL
  jitterSeconds?: number;  // added randomly to desync expiry (anti-stampede)
  lockMs?: number;         // single-flight lock lifetime
}

export function createAggregationService(prisma: PrismaClient, redis: Redis, deps: AggDeps = {}) {
  const sleep   = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const ttl     = deps.ttlSeconds ?? 120;
  const jitter  = deps.jitterSeconds ?? 30;
  const lockMs  = deps.lockMs ?? 10_000;

  async function build(): Promise<AggTile[]> {
    const products = await prisma.product.findMany({
      where: { isActive: true, stockStatus: 'available', shop: { isActive: true } },
      select: {
        id: true, name: true, price: true, mrpPaise: true, unit: true,
        images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
        master: { select: { id: true, status: true, name: true, imageUrl: true, mrpPaise: true, unit: true, brand: true } },
        inventoryState: {
          select: {
            expectedQty: true, reservedQty: true, velocityClass: true,
            confidenceBase: true, lastVerifiedAt: true,
          },
        },
      },
    });

    // Inventory Engine read-time gate: `stockStatus` is projected only at event
    // time, so decay between events is applied HERE. A tracked product whose
    // belief has slid into the hidden band (or is fully reserved) leaves the
    // feed; the survivors carry their promisable qty for the tile cap. Binary
    // products pass through untouched — stockStatus already filtered them.
    const cfg = await getInventoryConfig(prisma);
    const now = new Date();
    const input: AggInputProduct[] = [];
    for (const p of products) {
      const s = (p as { inventoryState?: {
        expectedQty: number | null; reservedQty: number; velocityClass: number | null;
        confidenceBase: unknown; lastVerifiedAt: Date | null;
      } | null }).inventoryState;
      if (s && s.expectedQty != null) {
        const belief = {
          expectedQty: s.expectedQty, reservedQty: s.reservedQty,
          velocityClass: s.velocityClass, confidenceBase: Number(s.confidenceBase),
          lastVerifiedAt: s.lastVerifiedAt,
        };
        if (beliefBand(belief, cfg, now) === 'hidden') continue;
        input.push({ ...(p as unknown as AggInputProduct), effectiveQty: beliefEffectiveQty(belief, cfg, now) });
      } else {
        input.push(p as unknown as AggInputProduct);
      }
    }
    return aggregateTiles(input);
  }

  async function getFeed(): Promise<AggTile[]> {
    const cached = await redis.get(AGG_CACHE_KEY).catch(() => null);
    if (cached) return JSON.parse(cached) as AggTile[];

    // Single-flight: only the lock holder rebuilds + writes; others wait for it.
    const gotLock = await redis.set(AGG_LOCK_KEY, '1', 'PX', lockMs, 'NX').catch(() => null);
    if (gotLock !== 'OK') {
      for (let i = 0; i < 20; i++) {
        await sleep(50);
        const c = await redis.get(AGG_CACHE_KEY).catch(() => null);
        if (c) return JSON.parse(c) as AggTile[];
      }
      return build(); // holder still busy → serve fresh without caching (never block)
    }

    try {
      const feed = await build();
      const ttlJittered = ttl + Math.floor(Math.random() * (jitter + 1));
      await redis.setex(AGG_CACHE_KEY, ttlJittered, JSON.stringify(feed)).catch(() => {});
      return feed;
    } finally {
      await redis.del(AGG_LOCK_KEY).catch(() => {});
    }
  }

  async function invalidate(): Promise<void> {
    await redis.del(AGG_CACHE_KEY).catch(() => {});
  }

  // Daily Essentials (TOP_SELLING_SKUS.md): a curated VIEW over the (cached)
  // aggregated feed — the everyday top-selling SKUs in priority order.
  async function getDailyEssentials(): Promise<AggTile[]> {
    return pickDailyEssentials(await getFeed());
  }

  return { getFeed, build, invalidate, getDailyEssentials };
}
