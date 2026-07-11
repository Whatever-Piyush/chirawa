import type { PrismaClient } from '@prisma/client';
import { haversineMeters, type LatLng } from '../../shared/utils/geo';
import { confidence as beliefConfidence, effectiveQty as beliefEffectiveQty } from '../inventory/belief';
import { getInventoryConfig } from '../inventory/inventory.config';

// ─── Checkout resolver (Catalog Engine Phase 5) ───────────────────────────────
// The Phase 4 feed shows one aggregated tile per master at the LOWEST in-stock
// price, hiding shop identity. At checkout we must turn each such "aggregated"
// (fungible) cart line back into a CONCRETE (shop, product) — re-validating that
// it's still in stock and honoring the displayed price — while routing the whole
// cart through the FEWEST shops possible (then nearest). This module is that
// resolver: a pure decision function (unit-tested) + a thin Prisma factory that
// feeds it live candidates. Pinned lines (Specials / passthrough) never reach it.

// One shop's offer for a master (a concrete Product row + where its shop sits).
export interface Candidate {
  shopId:    string;
  productId: string;
  price:     number;        // paise — this shop's current price
  // Belief-derived promisable quantity (Inventory Engine): expected − reserved −
  // drift buffer. null = untracked/binary (no numeric cap — stockStatus gated
  // upstream); a number must cover the requested qty to be viable.
  effectiveQty: number | null;
  confidence?:  number;     // tracked items only; candidates below θ never reach here
  lat:       number;
  lng:       number;
}

// An aggregated cart line awaiting resolution. `key` uniquely identifies the
// cart line (so the caller can map the assignment back); `displayedUnitPrice` is
// what the feed showed (kept for observability — the charged price is re-derived).
export interface AggLine {
  key:                string;
  masterId:           string;
  quantity:           number;
  displayedUnitPrice: number;
}

export interface Assignment {
  shopId:    string;
  productId: string;
  unitPrice: number; // paise — the resolved shop's re-validated price
}

export interface ResolveResult {
  assignments: Map<string, Assignment>; // line.key → concrete (shop, product, price)
  dropped:     string[];                // line.keys with zero in-stock candidates
  // JSON-safe decision snapshot: why each line went where (persisted on the
  // fee-carrier order as resolverTrace — answers "why Seller A?" from data).
  trace:       ResolverTrace;
}

export interface ResolverTrace {
  maxShops: number;
  lines: Array<{
    key: string; masterId: string; qty: number;
    candidates: Array<{ shopId: string; productId: string; price: number; effectiveQty: number | null; confidence?: number; viable: boolean }>;
  }>;
  chosen: Array<{ shopId: string; lineKeys: string[] }>;
  dropped: string[];
}

export interface ResolveOpts {
  // How far ABOVE a line's current-cheapest price we'll let a shop carry it in
  // order to merge it onto an already-chosen shop (fewer shops). Default 0 =
  // strict: a line is only merged onto a shop selling it at the cheapest price,
  // so the customer is NEVER charged above the displayed lowest-in-stock price.
  priceTolerancePaise?: number;
  // Products that just lost a reservation race — the placement retry loop
  // excludes them so the resolver picks another shop (or drops the line).
  excludeProductIds?: string[];
  // Cap on distinct shops per resolution (Inventory Engine): every extra pickup
  // is +4–7 min and +1 failure surface. Lines not coverable within the cap are
  // dropped. Default comes from AppConfig inv.max_shops_per_group (hard cap 3).
  maxShops?: number;
}

/**
 * Pure resolver. Routes aggregated lines onto the fewest shops without ever
 * overcharging beyond `priceTolerancePaise`:
 *
 *  - A candidate is *viable* for a line if it carries the master and (when its
 *    stock is tracked) has enough of it for the requested quantity.
 *  - Each line's price floor = the cheapest viable candidate. A shop may "cover"
 *    a line only if its price ≤ floor + tolerance (so default 0 ⇒ only the
 *    cheapest shops cover a line ⇒ the charged price equals the displayed one).
 *  - Greedy set-cover: repeatedly pick the shop that covers the most still-
 *    unassigned lines (tiebreak: nearest to the delivery point, then lowest
 *    summed price, then shopId for determinism) and assign ALL the lines it can
 *    cover to it. Because a chosen shop sweeps up every line it can reach, a new
 *    shop is only opened when no already-chosen shop can serve the line —
 *    i.e. the shop count is minimized greedily.
 *  - A line with no viable candidate is `dropped` (just sold out everywhere).
 */
export function resolveAggregatedLines(
  lines: AggLine[],
  candidatesByMaster: Map<string, Candidate[]>,
  deliveryPoint: LatLng,
  opts: ResolveOpts = {},
): ResolveResult {
  const tolerance = opts.priceTolerancePaise ?? 0;
  const maxShops = Math.min(3, Math.max(1, opts.maxShops ?? 3));
  const assignments = new Map<string, Assignment>();
  const dropped: string[] = [];
  const trace: ResolverTrace = { maxShops, lines: [], chosen: [], dropped: [] };

  // Per line: the candidates that can actually fulfil the requested quantity,
  // and the cheapest such price (the floor the tolerance is measured against).
  interface LineState { line: AggLine; viable: Candidate[]; floor: number }
  const states: LineState[] = [];
  for (const line of lines) {
    const all = candidatesByMaster.get(line.masterId) ?? [];
    const viable = all.filter((c) => c.effectiveQty == null || c.effectiveQty >= line.quantity);
    trace.lines.push({
      key: line.key, masterId: line.masterId, qty: line.quantity,
      candidates: all.map((c) => ({
        shopId: c.shopId, productId: c.productId, price: c.price,
        effectiveQty: c.effectiveQty,
        ...(c.confidence != null ? { confidence: Number(c.confidence.toFixed(3)) } : {}),
        viable: c.effectiveQty == null || c.effectiveQty >= line.quantity,
      })),
    });
    if (viable.length === 0) { dropped.push(line.key); continue; }
    const floor = Math.min(...viable.map((c) => c.price));
    states.push({ line, viable, floor });
  }

  // Can shop `c` cover this line within tolerance of its cheapest price?
  const covers = (c: Candidate, s: LineState): boolean => c.price <= s.floor + tolerance;

  const unassigned = new Set(states.map((s) => s.line.key));
  const byKey = new Map(states.map((s) => [s.line.key, s]));

  // Each loop iteration opens exactly one (new) shop; the cap bounds pickups.
  let shopsOpened = 0;
  while (unassigned.size > 0 && shopsOpened < maxShops) {
    // Build, per shop, the set of unassigned lines it can cover (and the concrete
    // product + price it would use for each). A shop is identified by shopId; all
    // of a shop's candidates share lat/lng.
    interface ShopOption { shopId: string; lat: number; lng: number; covered: Array<{ key: string; productId: string; price: number }> }
    const shops = new Map<string, ShopOption>();
    for (const key of unassigned) {
      const s = byKey.get(key)!;
      for (const c of s.viable) {
        if (!covers(c, s)) continue;
        let opt = shops.get(c.shopId);
        if (!opt) { opt = { shopId: c.shopId, lat: c.lat, lng: c.lng, covered: [] }; shops.set(c.shopId, opt); }
        // A shop may carry the master via multiple product rows — keep the cheapest.
        const prior = opt.covered.find((x) => x.key === key);
        if (!prior) opt.covered.push({ key, productId: c.productId, price: c.price });
        else if (c.price < prior.price) { prior.productId = c.productId; prior.price = c.price; }
      }
    }

    // Pick the shop covering the most lines; ties → nearest, then cheapest, then id.
    const best = [...shops.values()].sort((a, b) => {
      if (b.covered.length !== a.covered.length) return b.covered.length - a.covered.length;
      const da = haversineMeters(deliveryPoint, { lat: a.lat, lng: a.lng });
      const db = haversineMeters(deliveryPoint, { lat: b.lat, lng: b.lng });
      if (da !== db) return da - db;
      const pa = a.covered.reduce((t, x) => t + x.price, 0);
      const pb = b.covered.reduce((t, x) => t + x.price, 0);
      if (pa !== pb) return pa - pb;
      return a.shopId.localeCompare(b.shopId);
    })[0]!;

    for (const x of best.covered) {
      assignments.set(x.key, { shopId: best.shopId, productId: x.productId, unitPrice: x.price });
      unassigned.delete(x.key);
    }
    trace.chosen.push({ shopId: best.shopId, lineKeys: best.covered.map((x) => x.key) });
    shopsOpened += 1;
  }

  // Lines the shop cap left uncovered are dropped, not silently spread thinner.
  for (const key of unassigned) dropped.push(key);

  trace.dropped = [...dropped];
  return { assignments, dropped, trace };
}

export function createResolverService(prisma: PrismaClient) {
  /**
   * Resolve a batch of aggregated cart lines to concrete shops against LIVE
   * belief state. Queries every active, in-stock, open-shop Product for the
   * lines' masters, computes read-time effective qty + confidence per candidate
   * (Inventory Engine), gates out candidates below θ_hide (visibility and
   * routability are ONE predicate — never route what we wouldn't show), and
   * hands the survivors to the pure resolver with the shop cap.
   */
  async function resolveCart(
    lines: AggLine[],
    deliveryPoint: LatLng,
    opts: ResolveOpts = {},
  ): Promise<ResolveResult> {
    if (lines.length === 0) {
      return { assignments: new Map(), dropped: [], trace: { maxShops: 0, lines: [], chosen: [], dropped: [] } };
    }

    const cfg = await getInventoryConfig(prisma);
    const now = new Date();
    const masterIds = [...new Set(lines.map((l) => l.masterId))];
    const products = await prisma.product.findMany({
      where: {
        masterId:    { in: masterIds },
        isActive:    true,
        stockStatus: 'available',
        shop:        { isActive: true, isOpen: true },
        ...(opts.excludeProductIds?.length ? { id: { notIn: opts.excludeProductIds } } : {}),
      },
      select: {
        id: true, masterId: true, shopId: true, price: true,
        shop: { select: { lat: true, lng: true } },
        inventoryState: {
          select: {
            expectedQty: true, reservedQty: true, velocityClass: true,
            confidenceBase: true, lastVerifiedAt: true,
          },
        },
      },
    });

    const candidatesByMaster = new Map<string, Candidate[]>();
    for (const p of products) {
      if (!p.masterId) continue; // the `in` filter guarantees this, but keep TS happy

      let effective: number | null = null;
      let conf: number | undefined;
      const s = p.inventoryState;
      if (s && s.expectedQty != null) {
        const belief = {
          expectedQty: s.expectedQty, reservedQty: s.reservedQty,
          velocityClass: s.velocityClass, confidenceBase: Number(s.confidenceBase),
          lastVerifiedAt: s.lastVerifiedAt,
        };
        conf = beliefConfidence(belief, cfg, now);
        // θ gate: decay may have crossed the line since the last projection
        // event — the resolver reads the belief live, never a stale status.
        if (conf < cfg.thetaHide) continue;
        effective = beliefEffectiveQty(belief, cfg, now) ?? 0;
        if (effective <= 0) continue;
      }

      const list = candidatesByMaster.get(p.masterId) ?? [];
      list.push({
        shopId:    p.shopId,
        productId: p.id,
        price:     p.price,
        effectiveQty: effective,
        ...(conf != null ? { confidence: conf } : {}),
        lat:       Number(p.shop.lat),
        lng:       Number(p.shop.lng),
      });
      candidatesByMaster.set(p.masterId, list);
    }

    return resolveAggregatedLines(lines, candidatesByMaster, deliveryPoint, {
      ...opts,
      maxShops: opts.maxShops ?? cfg.maxShopsPerGroup,
    });
  }

  return { resolveCart };
}
