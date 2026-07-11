import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { serviceLogger } from '../shared/observability/logger';

const log = serviceLogger('off-source');

// ─── Open Food Facts source for catalog enrichment (Phase 2, ₹0) ──────────────
// We resolve a barcode → front-image URL + basic fields from the OFF **bulk
// dump** (a local JSONL file), NOT the live API: OFF caps the API at ~100 req/min
// and IP-bans abuse, so bulk enrichment must never hammer it. The live API is a
// single-item fallback for the seller scan (Phase 3), not this bulk path.
//
// The image URL returned here is OFF's; the enrichment worker fetches it through
// the Phase 1 pipeline, which re-hosts it to our R2 (never hotlinked) and records
// the CC-BY-SA attribution.

export interface OffProduct {
  barcode: string;
  name: string | null;
  brand: string | null;
  categoryName: string | null;
  imageUrl: string | null; // OFF front-image URL to fetch + re-host (null = no image yet)
  source: 'open_food_facts';
  license: 'CC-BY-SA';
  attribution: string; // OFF product page, for the credits page
}

// barcode → product, or null when OFF has no usable (imaged) entry for it.
export type OffLookup = (barcode: string) => Promise<OffProduct | null>;

export const offProductUrl = (barcode: string): string =>
  `https://world.openfoodfacts.org/product/${barcode}`;

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return null;
}

/**
 * Map a parsed OFF product object → OffProduct. Shared by the dump (per line) and
 * the live API. `imageUrl` may be null — the live seller-scan path still wants the
 * name/brand to create a master even when OFF has no image yet (Phase 2 images it
 * later). `fallbackBarcode` supplies the code when the row omits it.
 */
export function offProductFromRow(row: Record<string, unknown>, fallbackBarcode?: string): OffProduct | null {
  const barcode = firstString(row.code, row._id, fallbackBarcode);
  if (!barcode) return null;

  const categoriesRaw = typeof row.categories === 'string' ? row.categories.split(',')[0] : undefined;

  return {
    barcode,
    name: firstString(row.product_name, row.product_name_en, row.generic_name),
    brand: firstString(row.brands),
    categoryName: firstString(categoriesRaw),
    imageUrl: firstString(row.image_front_url, row.image_url),
    source: 'open_food_facts',
    license: 'CC-BY-SA',
    attribution: offProductUrl(barcode),
  };
}

/**
 * Parse one OFF JSONL dump line → an OffProduct WITH an image. The dump powers
 * bulk image enrichment, so malformed / barcode-less / image-less rows → null.
 */
export function parseOffDumpLine(line: string): OffProduct | null {
  const t = line.trim();
  if (!t) return null;
  let row: Record<string, unknown>;
  try { row = JSON.parse(t) as Record<string, unknown>; } catch { return null; }
  const p = offProductFromRow(row);
  return p && p.imageUrl ? p : null;
}

/**
 * Build an OFF lookup backed by a local JSONL bulk dump. The dump is streamed +
 * indexed once, lazily, on the first lookup (memoized). If no dump is configured
 * or the file is missing, returns a lookup that always yields null (so the worker
 * marks items needs_manual rather than crashing) — logged once.
 */
export function createOffDumpSource(dumpPath?: string | null): OffLookup {
  if (!dumpPath || !existsSync(dumpPath)) {
    let warned = false;
    return async () => {
      if (!warned) {
        warned = true;
        log.warn({ dumpPath: dumpPath ?? '' }, 'OFF dump not found; enrichment will mark items needs_manual');
      }
      return null;
    };
  }

  let indexPromise: Promise<Map<string, OffProduct>> | null = null;

  async function buildIndex(): Promise<Map<string, OffProduct>> {
    const map = new Map<string, OffProduct>();
    const rl = createInterface({ input: createReadStream(dumpPath!, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      const p = parseOffDumpLine(line);
      if (p) map.set(p.barcode, p);
    }
    log.info({ products: map.size, dumpPath }, 'OFF dump indexed');
    return map;
  }

  return async (barcode: string) => {
    indexPromise ??= buildIndex();
    const map = await indexPromise;
    return map.get(barcode) ?? null;
  };
}
