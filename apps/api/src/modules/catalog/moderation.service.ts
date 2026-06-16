import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { AGG_CACHE_KEY } from './aggregation.service';

// ─── Catalog moderation, coverage & observability (Phase 7) ───────────────────
// The admin data-quality surface: the needs_review→approved gate, wrong-image
// reports, one-click legal takedowns, price-outlier detection, a coverage
// dashboard, and DB-derived metrics with threshold alerts. JSON only (there's no
// admin app yet — same shape as GET /admin/dispatch). Any change that alters the
// public feed busts the Phase-4 aggregation cache.

export type MasterDecision = 'approved' | 'rejected';

// Alert thresholds — flagged in the metrics JSON since there's no external
// alerting system. Hot-path counters (agg-cache hit / OFF-503 / image-pipeline
// error) are deferred; see the `deferred` field on getMetrics().
const ALERT = { enrichmentFailRate: 0.5, failedPickupRate: 0.05, openImageReports: 10 };

export function createModerationService(prisma: PrismaClient, redis: Redis) {
  const bustFeed = () => redis.del(AGG_CACHE_KEY).catch(() => {});

  // ── Moderation queue ──────────────────────────────────────────────────────

  async function listReviewQueue(limit = 200) {
    const masters = await prisma.masterCatalog.findMany({
      where:   { status: 'needs_review' },
      orderBy: { createdAt: 'asc' }, // oldest first — clear the backlog
      take:    limit,
      select: {
        id: true, barcode: true, name: true, brand: true, imageUrl: true,
        imageSource: true, imageLicense: true, imageAttribution: true,
        enrichmentStatus: true, enrichmentNote: true, createdAt: true,
        _count: { select: { products: true } },
      },
    });

    const masterIds = masters.map((m) => m.id);
    const reportRows = masterIds.length
      ? await prisma.imageReport.groupBy({
          by: ['masterId'], where: { masterId: { in: masterIds }, resolvedAt: null }, _count: { _all: true },
        })
      : [];
    const openReports = new Map(reportRows.map((r) => [r.masterId, r._count._all]));

    return masters.map(({ _count, ...m }) => ({
      ...m, productCount: _count.products, openReports: openReports.get(m.id) ?? 0,
    }));
  }

  // The needs_review → approved gate. A newly-approved master enters the feed, so
  // bust the agg cache.
  async function setMasterStatus(masterId: string, status: MasterDecision) {
    const updated = await prisma.masterCatalog.update({
      where: { id: masterId }, data: { status }, select: { id: true, status: true },
    });
    await bustFeed();
    return updated;
  }

  // ── Wrong-image reports ───────────────────────────────────────────────────

  async function listImageReports(limit = 200) {
    const reports = await prisma.imageReport.findMany({
      where:   { resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take:    limit,
      select:  { id: true, productId: true, masterId: true, reason: true, reportedById: true, createdAt: true },
    });

    // ImageReport has no relations — resolve product/master labels in batch.
    const productIds = [...new Set(reports.map((r) => r.productId).filter((x): x is string => !!x))];
    const masterIds  = [...new Set(reports.map((r) => r.masterId).filter((x): x is string => !!x))];
    const [products, masters] = await Promise.all([
      productIds.length ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }) : [],
      masterIds.length  ? prisma.masterCatalog.findMany({ where: { id: { in: masterIds } }, select: { id: true, name: true, imageUrl: true } }) : [],
    ]);
    const pName = new Map(products.map((p) => [p.id, p.name]));
    const mById = new Map(masters.map((m) => [m.id, m]));

    return reports.map((r) => ({
      ...r,
      productName:    r.productId ? pName.get(r.productId) ?? null : null,
      masterName:     r.masterId ? mById.get(r.masterId)?.name ?? null : null,
      masterImageUrl: r.masterId ? mById.get(r.masterId)?.imageUrl ?? null : null,
    }));
  }

  async function resolveImageReport(reportId: string, opts: { reApprove?: boolean } = {}) {
    const report = await prisma.imageReport.update({
      where: { id: reportId }, data: { resolvedAt: new Date() }, select: { id: true, masterId: true },
    });
    if (opts.reApprove && report.masterId) {
      await prisma.masterCatalog.update({ where: { id: report.masterId }, data: { status: 'approved' } });
      await bustFeed();
    }
    return { id: report.id, resolved: true };
  }

  // One-click legal takedown. Replace → swap in an own/clean image + approve;
  // remove → strip the image + provenance and re-gate (not shown without an
  // image). Either way, resolve the related open reports + bust the feed.
  async function takedownImage(masterId: string, opts: { replaceImageUrl?: string } = {}) {
    const data = opts.replaceImageUrl
      ? { imageUrl: opts.replaceImageUrl, imageSource: 'manual', imageLicense: 'owned', imageAttribution: null, status: 'approved' as const }
      : { imageUrl: null, imageSource: null, imageLicense: null, imageAttribution: null, status: 'needs_review' as const };

    const updated = await prisma.masterCatalog.update({
      where: { id: masterId }, data, select: { id: true, status: true, imageUrl: true },
    });
    await prisma.imageReport.updateMany({ where: { masterId, resolvedAt: null }, data: { resolvedAt: new Date() } });
    await bustFeed();
    return { id: updated.id, status: updated.status, imageUrl: updated.imageUrl, replaced: !!opts.replaceImageUrl };
  }

  // ── Price outliers ────────────────────────────────────────────────────────
  // Writes already enforce MRP ≥ price, but legacy/imported rows + master-MRP
  // mismatches slip through. Prisma can't compare two columns across a relation,
  // so fetch the candidates and check in JS (bounded by `take`).
  async function listPriceOutliers(limit = 500) {
    const products = await prisma.product.findMany({
      where: { isActive: true, OR: [{ mrpPaise: { not: null } }, { master: { mrpPaise: { not: null } } }] },
      take:  limit,
      select: { id: true, shopId: true, name: true, price: true, mrpPaise: true, master: { select: { mrpPaise: true } } },
    });
    const outliers: Array<{ productId: string; shopId: string; name: string; price: number; mrpPaise: number | null; masterMrpPaise: number | null; reason: string }> = [];
    for (const p of products) {
      const overOwn    = p.mrpPaise != null && p.price > p.mrpPaise;
      const overMaster = p.master?.mrpPaise != null && p.price > p.master.mrpPaise;
      if (overOwn || overMaster) {
        outliers.push({
          productId: p.id, shopId: p.shopId, name: p.name, price: p.price,
          mrpPaise: p.mrpPaise, masterMrpPaise: p.master?.mrpPaise ?? null,
          reason: overOwn ? 'price_over_mrp' : 'price_over_master_mrp',
        });
      }
    }
    return outliers;
  }

  // ── Coverage dashboard ────────────────────────────────────────────────────

  async function getCoverage() {
    const [activeProducts, withImage, withBarcode, statusRows, enrichRows] = await Promise.all([
      prisma.product.count({ where: { isActive: true } }),
      prisma.product.count({ where: { isActive: true, OR: [{ images: { some: {} } }, { master: { imageUrl: { not: null } } }] } }),
      prisma.product.count({ where: { isActive: true, barcode: { not: null } } }),
      prisma.masterCatalog.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.masterCatalog.groupBy({ by: ['enrichmentStatus'], _count: { _all: true } }),
    ]);

    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
    const masterStatus: Record<string, number> = { needs_review: 0, approved: 0, rejected: 0 };
    for (const r of statusRows) masterStatus[r.status] = r._count._all;
    const enrichment: Record<string, number> = { unattempted: 0, enriched: 0, needs_manual: 0, error: 0 };
    for (const r of enrichRows) {
      const key = r.enrichmentStatus ?? 'unattempted';
      if (key in enrichment) enrichment[key]! += r._count._all; else enrichment.unattempted! += r._count._all;
    }
    const attempted = enrichment.enriched! + enrichment.needs_manual! + enrichment.error!;

    return {
      activeProducts,
      withImage, withImagePct: pct(withImage, activeProducts),
      withBarcode, withBarcodePct: pct(withBarcode, activeProducts),
      masterStatus, enrichment,
      enrichmentSuccessRate: attempted > 0 ? Math.round((enrichment.enriched! / attempted) * 1000) / 10 : 0,
      needsManualCount: enrichment.needs_manual!,
    };
  }

  // ── Metrics + alerts (DB-derived) ─────────────────────────────────────────

  async function getMetrics(windowDays = 7) {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const [enrichRows, unavailableItems, totalItems, openReports] = await Promise.all([
      prisma.masterCatalog.groupBy({ by: ['enrichmentStatus'], _count: { _all: true } }),
      prisma.orderItem.count({ where: { fulfillmentStatus: 'unavailable_refunded', createdAt: { gte: since } } }),
      prisma.orderItem.count({ where: { createdAt: { gte: since } } }),
      prisma.imageReport.count({ where: { resolvedAt: null } }),
    ]);

    let enriched = 0, needsManual = 0, errored = 0;
    for (const r of enrichRows) {
      if (r.enrichmentStatus === 'enriched') enriched = r._count._all;
      else if (r.enrichmentStatus === 'needs_manual') needsManual = r._count._all;
      else if (r.enrichmentStatus === 'error') errored = r._count._all;
    }
    const attempted = enriched + needsManual + errored;
    const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : 0);
    const mk = (key: string, value: number, threshold: number) => ({ key, value, threshold, breached: value > threshold });

    const metrics = [
      mk('enrichmentFailRate', rate(needsManual + errored, attempted), ALERT.enrichmentFailRate),
      mk('failedPickupRate',   rate(unavailableItems, totalItems),     ALERT.failedPickupRate),
      mk('openImageReports',   openReports,                            ALERT.openImageReports),
    ];
    return {
      windowDays,
      metrics,
      alerts: metrics.filter((m) => m.breached),
      // Real-time rates needing hot-path Redis counters — deferred follow-up.
      deferred: ['aggCacheHitRate', 'offError503Count', 'imagePipelineErrorRate'],
    };
  }

  return {
    listReviewQueue, setMasterStatus, listImageReports, resolveImageReport,
    takedownImage, listPriceOutliers, getCoverage, getMetrics,
  };
}
