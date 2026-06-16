import type { PrismaClient } from '@prisma/client';
import { haversineMeters, type LatLng } from '../../shared/utils/geo';

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
  stockQty:  number | null; // null = untracked (treated as unlimited); number = must cover the qty
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
}

export interface ResolveOpts {
  // How far ABOVE a line's current-cheapest price we'll let a shop carry it in
  // order to merge it onto an already-chosen shop (fewer shops). Default 0 =
  // strict: a line is only merged onto a shop selling it at the cheapest price,
  // so the customer is NEVER charged above the displayed lowest-in-stock price.
  priceTolerancePaise?: number;
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
  const assignments = new Map<string, Assignment>();
  const dropped: string[] = [];

  // Per line: the candidates that can actually fulfil the requested quantity,
  // and the cheapest such price (the floor the tolerance is measured against).
  interface LineState { line: AggLine; viable: Candidate[]; floor: number }
  const states: LineState[] = [];
  for (const line of lines) {
    const all = candidatesByMaster.get(line.masterId) ?? [];
    const viable = all.filter((c) => c.stockQty == null || c.stockQty >= line.quantity);
    if (viable.length === 0) { dropped.push(line.key); continue; }
    const floor = Math.min(...viable.map((c) => c.price));
    states.push({ line, viable, floor });
  }

  // Can shop `c` cover this line within tolerance of its cheapest price?
  const covers = (c: Candidate, s: LineState): boolean => c.price <= s.floor + tolerance;

  const unassigned = new Set(states.map((s) => s.line.key));
  const byKey = new Map(states.map((s) => [s.line.key, s]));

  while (unassigned.size > 0) {
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
  }

  return { assignments, dropped };
}

export function createResolverService(prisma: PrismaClient) {
  /**
   * Resolve a batch of aggregated cart lines to concrete shops against LIVE
   * inventory. Queries every active, in-stock, open-shop Product for the lines'
   * masters (using the @@index([masterId, stockStatus, isActive]) index) and
   * hands them to the pure resolver.
   */
  async function resolveCart(
    lines: AggLine[],
    deliveryPoint: LatLng,
    opts: ResolveOpts = {},
  ): Promise<ResolveResult> {
    if (lines.length === 0) return { assignments: new Map(), dropped: [] };

    const masterIds = [...new Set(lines.map((l) => l.masterId))];
    const products = await prisma.product.findMany({
      where: {
        masterId:    { in: masterIds },
        isActive:    true,
        stockStatus: 'available',
        shop:        { isActive: true, isOpen: true },
      },
      select: {
        id: true, masterId: true, shopId: true, price: true, stockQty: true,
        shop: { select: { lat: true, lng: true } },
      },
    });

    const candidatesByMaster = new Map<string, Candidate[]>();
    for (const p of products) {
      if (!p.masterId) continue; // the `in` filter guarantees this, but keep TS happy
      const list = candidatesByMaster.get(p.masterId) ?? [];
      list.push({
        shopId:    p.shopId,
        productId: p.id,
        price:     p.price,
        stockQty:  p.stockQty,
        lat:       Number(p.shop.lat),
        lng:       Number(p.shop.lng),
      });
      candidatesByMaster.set(p.masterId, list);
    }

    return resolveAggregatedLines(lines, candidatesByMaster, deliveryPoint, opts);
  }

  return { resolveCart };
}
