import type { PrismaClient, Prisma } from '@prisma/client';
import { processImage as defaultProcessImage } from '../../services/image-pipeline';
import type { OffLookup } from '../../services/off-source';

// ─── Bulk catalog enrichment (Catalog Engine Phase 2, BullMQ v5, ₹0) ──────────
// For each MasterCatalog row that still has no image, resolve its barcode against
// the OFF bulk dump → fetch the front image through the Phase 1 pipeline (which
// re-hosts it to R2 + records CC-BY-SA attribution) → set imageUrl + provenance.
// The row stays status=needs_review (the moderation gate before it's public).
//
// Idempotent + resumable: selection skips rows already 'enriched' or
// 'needs_manual'; 'error' rows are retried next run. The pipeline's content-hash
// keys mean even a re-processed image overwrites the same R2 object — zero dupes.
// Never blocks a user request — this only runs in the worker, async.

export interface EnrichmentDeps {
  source: OffLookup;
  processImage?: typeof defaultProcessImage;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Polite gap between real OFF image fetches (~85/min at the 700ms default). */
  minIntervalMs?: number;
  /** Max masters processed per run (keeps a sweep bounded). */
  batchSize?: number;
  /** Re-attempt rows previously marked needs_manual (e.g. after a dump refresh). */
  includeNeedsManual?: boolean;
}

export interface EnrichmentResult {
  scanned: number;
  enriched: number;
  needsManual: number;
  errors: number;
}

const DEFAULT_MIN_INTERVAL_MS = 700;
const DEFAULT_BATCH_SIZE = 500;
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runCatalogEnrichment(prisma: PrismaClient, deps: EnrichmentDeps): Promise<EnrichmentResult> {
  const { source } = deps;
  const processImage = deps.processImage ?? defaultProcessImage;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const minIntervalMs = deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;

  // Resumable selection: never-attempted (null) + transient 'error', plus
  // 'needs_manual' only when explicitly forced. 'enriched' is always skipped.
  const statuses: Array<string | null> = deps.includeNeedsManual ? [null, 'error', 'needs_manual'] : [null, 'error'];
  const candidates = await prisma.masterCatalog.findMany({
    where: {
      imageUrl: null,
      status: { not: 'rejected' },
      OR: statuses.map((s) => ({ enrichmentStatus: s })),
    },
    select: { id: true, barcode: true, brand: true, categoryName: true },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });

  const result: EnrichmentResult = { scanned: candidates.length, enriched: 0, needsManual: 0, errors: 0 };

  for (const m of candidates) {
    try {
      const off = await source(m.barcode);

      if (!off || !off.imageUrl) {
        await prisma.masterCatalog.update({
          where: { id: m.id },
          data: { enrichmentStatus: 'needs_manual', enrichmentNote: 'no OFF match with image', enrichmentAttemptedAt: now() },
        });
        result.needsManual++;
        continue;
      }

      const img = await processImage({ url: off.imageUrl, source: 'open_food_facts', license: 'CC-BY-SA', attribution: off.attribution });
      // Politeness gap after each real OFF image fetch (rate-limit the CDN hits).
      if (minIntervalMs > 0) await sleep(minIntervalMs);

      const data: Prisma.MasterCatalogUpdateInput = {
        imageUrl: img.url,
        imageSource: 'open_food_facts',
        imageLicense: 'CC-BY-SA',
        imageAttribution: off.attribution,
        enrichmentStatus: 'enriched',
        enrichmentNote: null,
        enrichmentAttemptedAt: now(),
        // status stays needs_review — the moderation gate before public (Phase 7).
      };
      // Backfill descriptive fields from OFF only when ours are empty.
      if (m.brand == null && off.brand) data.brand = off.brand;
      if (m.categoryName == null && off.categoryName) data.categoryName = off.categoryName;

      await prisma.masterCatalog.update({ where: { id: m.id }, data });
      result.enriched++;
    } catch (err) {
      const note = err instanceof Error ? err.message : 'unknown error';
      await prisma.masterCatalog.update({
        where: { id: m.id },
        data: { enrichmentStatus: 'error', enrichmentNote: note.slice(0, 250), enrichmentAttemptedAt: now() },
      }).catch(() => { /* don't let a logging update abort the sweep */ });
      result.errors++;
    }
  }

  console.log(`🧩 Catalog enrichment: scanned ${result.scanned}, enriched ${result.enriched}, needs_manual ${result.needsManual}, errors ${result.errors}`);
  return result;
}
