import { env } from '../config/env';
import { serviceLogger } from '../shared/observability/logger';
import { offProductFromRow, type OffLookup, type OffProduct } from './off-source';

const log = serviceLogger('off-live');

// ─── Live Open Food Facts API (single-item, Phase 3 seller scan) ──────────────
// When a scanned barcode isn't in our MasterCatalog, we fall back to ONE live OFF
// lookup to bootstrap a needs_review master. This is the only place we hit the
// live API — bulk enrichment uses the dump (Phase 2). OFF caps the API at ~100
// req/min and IP-bans abuse, so this is conservatively rate-limited and sends a
// descriptive User-Agent per their API conditions. Failures return null (never
// block the seller — they can still create the product manually).

const OFF_API_URL = (barcode: string): string =>
  `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json` +
  `?fields=code,product_name,product_name_en,generic_name,brands,categories,image_front_url,image_url`;

const RATE_LIMIT = 90;            // stay safely under OFF's ~100/min
const RATE_WINDOW_MS = 60_000;
const FETCH_TIMEOUT_MS = 8_000;

export interface OffLiveDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Build a live OFF lookup. Each instance keeps its own sliding-window rate state,
 * so it stays under the API cap; over the cap it returns null (skips) rather than
 * risking a ban. Returns an OffProduct (image may be null) or null when not found.
 */
export function createOffLiveSource(deps: OffLiveDeps = {}): OffLookup {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const recentCalls: number[] = []; // timestamps within the window

  return async (barcode: string): Promise<OffProduct | null> => {
    const t = now();
    while (recentCalls.length > 0 && t - recentCalls[0]! > RATE_WINDOW_MS) recentCalls.shift();
    if (recentCalls.length >= RATE_LIMIT) {
      log.warn({ barcode, ratePerMin: RATE_LIMIT }, 'OFF live rate limit reached; skipping');
      return null;
    }
    recentCalls.push(t);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchImpl(OFF_API_URL(barcode), {
        signal: ctrl.signal,
        headers: { 'User-Agent': env.OFF_USER_AGENT, Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { status?: number; product?: Record<string, unknown> };
      if (json.status !== 1 || !json.product) return null; // OFF: status 1 = product found
      return offProductFromRow(json.product, barcode);
    } catch {
      // Network/timeout/parse error → treat as "not found"; the seller path
      // falls back to manual entry, and we never throw into a user request.
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
