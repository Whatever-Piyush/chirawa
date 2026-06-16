import type { PrismaClient, MasterCatalog } from '@prisma/client';
import { isValidEan } from '../../shared/utils/barcode';
import type { OffLookup } from '../../services/off-source';

// ─── MasterCatalog lookup for the seller scan (Catalog Engine Phase 3) ────────
// Scan a barcode → return prefill (name / image / MRP / brand / unit). If the
// barcode isn't in our dictionary yet, fall back to ONE live OFF lookup and
// bootstrap a needs_review master from it (the image is left for the Phase 2
// enrichment worker — we don't block the scan on a network image fetch).

export interface MasterPrefill {
  id: string;
  barcode: string;
  name: string;
  brand: string | null;
  unit: string | null;
  mrpPaise: number | null;
  imageUrl: string | null;
  status: string;
}

export interface MasterLookupResult {
  found: boolean;
  source: 'master' | 'off_live' | null; // where the prefill came from
  master: MasterPrefill | null;
}

export interface MasterServiceDeps {
  offLive?: OffLookup; // live OFF fallback; omit to disable (e.g. tests / offline)
}

const toPrefill = (m: MasterCatalog): MasterPrefill => ({
  id: m.id, barcode: m.barcode, name: m.name, brand: m.brand,
  unit: m.unit, mrpPaise: m.mrpPaise, imageUrl: m.imageUrl, status: m.status,
});

export function createMasterService(prisma: PrismaClient, deps: MasterServiceDeps = {}) {
  async function lookupByBarcode(barcodeRaw: string): Promise<MasterLookupResult> {
    const barcode = barcodeRaw.trim();
    if (!barcode) return { found: false, source: null, master: null };

    // 1. Already in the dictionary → return it.
    const existing = await prisma.masterCatalog.findUnique({ where: { barcode } });
    if (existing) return { found: true, source: 'master', master: toPrefill(existing) };

    // 2. Unknown barcode → live OFF bootstrap, but only for a real GTIN and when a
    //    live source is wired. Invalid codes / no source → not found (manual entry).
    if (!isValidEan(barcode) || !deps.offLive) return { found: false, source: null, master: null };

    const off = await deps.offLive(barcode);
    if (!off) return { found: false, source: null, master: null };

    // Create a needs_review master from OFF. Image stays null → the enrichment
    // worker (enrichmentStatus = null = pending) fetches + re-hosts it later.
    try {
      const created = await prisma.masterCatalog.create({
        data: {
          barcode,
          name: off.name ?? `Item ${barcode}`,
          brand: off.brand,
          categoryName: off.categoryName,
          status: 'needs_review',
        },
      });
      return { found: true, source: 'off_live', master: toPrefill(created) };
    } catch {
      // Lost a race on the unique(barcode) — read back whoever won.
      const raced = await prisma.masterCatalog.findUnique({ where: { barcode } });
      return raced
        ? { found: true, source: 'master', master: toPrefill(raced) }
        : { found: false, source: null, master: null };
    }
  }

  return { lookupByBarcode };
}
