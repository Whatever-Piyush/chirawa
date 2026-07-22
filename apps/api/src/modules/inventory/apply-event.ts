import {
  beliefBand, projectStockStatus, DEFAULT_TRACKED_CLASS,
  type BeliefState, type InventoryConfig,
} from './belief';

// ─── applyInventoryEvent — THE single writer for belief state ─────────────────
// Clone of the transitionOrderStatus discipline: every belief mutation goes
// through this one function, which (in the caller's transaction, atomically):
//   1. upserts the product's inventory_state row per the event-effect table,
//   2. projects the belief onto products.stockStatus (+ mirrors expectedQty
//      into the legacy products.stockQty so existing app reads stay correct
//      until that column is dropped),
//   3. appends the inventory_events row with post-state snapshots.
//
// Reservation counter math (reserve/commit/release) lives in
// reservations.service.ts because the oversell guard must be a single SQL
// statement — that file and this one are the ONLY writers of inventory_state.
// No other service may touch these tables.

export type BeliefEventType =
  | 'seller_count' // exact count (head-list audit, chip "सिर्फ n", stock-qty API)
  | 'seller_bucket' // बहुत/थोड़ा bucket tap → category-default qty
  | 'seller_toggle_out' // "नहीं है" — trust it fully
  | 'seller_toggle_in' // back in stock, no count given
  | 'rider_reported_missing' // pickup miss: truth-grade zero
  | 'admin_adjust'
  | 'backfill'; // one-time migration from products.stockQty

export interface ApplyEventInput {
  productId: string;
  shopId: string;
  eventType: BeliefEventType;
  /** Absolute shelf count for count/bucket/adjust events; ignored for toggles-out/miss. */
  qty?: number | null;
  actorType: 'seller' | 'rider' | 'customer' | 'system' | 'admin';
  actorId?: string | null;
  orderId?: string | null;
  orderItemId?: string | null;
  reason?: string | null;
}

export interface ApplyEventResult {
  applied: boolean; // false = idempotent replay (duplicate orderItemId+eventType)
  expectedQty: number | null;
  confidenceBase: number;
  stockStatusChanged: boolean;
  stockStatusFrom: 'available' | 'out_of_stock' | 'hidden';
  stockStatusTo: 'available' | 'out_of_stock' | 'hidden';
}

// Minimal transaction slice (unit-testable with a fake tx, same pattern as the
// orders module's StockTx).
export interface InventoryTx {
  inventoryState: {
    findUnique: (args: unknown) => Promise<{
      expectedQty: number | null; reservedQty: number; velocityClass: number | null;
      confidenceBase: unknown; lastVerifiedAt: Date | null;
    } | null>;
    upsert: (args: unknown) => Promise<unknown>;
  };
  inventoryEvent: {
    createMany: (args: unknown) => Promise<{ count: number }>;
  };
  product: {
    findUnique: (args: unknown) => Promise<{ stockStatus: 'available' | 'out_of_stock' | 'hidden' } | null>;
    update: (args: unknown) => Promise<unknown>;
  };
}

interface BeliefPatch {
  expectedQty: number | null;
  confidenceBase: number;
  velocityClass: number | null;
  verified: boolean; // stamp lastVerifiedAt/Source/Qty
  verifiedSource?: string;
}

// The event-effect table (design §4.3), tracked/binary aware. `qty` is the
// absolute count where the event carries one.
function beliefPatch(
  eventType: BeliefEventType,
  prev: { expectedQty: number | null; velocityClass: number | null; confidenceBase: number },
  qty: number | null | undefined,
  cfg: InventoryConfig,
): BeliefPatch {
  const tracked = prev.expectedQty != null;
  const keepClass = prev.velocityClass;
  switch (eventType) {
    case 'seller_count':
      return {
        expectedQty: qty ?? prev.expectedQty, confidenceBase: 0.95,
        velocityClass: keepClass ?? DEFAULT_TRACKED_CLASS, verified: true, verifiedSource: 'seller_count',
      };
    case 'seller_bucket':
      return {
        expectedQty: qty ?? cfg.bucketSome, confidenceBase: 0.85,
        velocityClass: keepClass ?? DEFAULT_TRACKED_CLASS, verified: true, verifiedSource: 'seller_bucket',
      };
    case 'seller_toggle_out':
      // Binary items stay binary (expected null) — the projection below still
      // flips stockStatus, which is their whole availability story.
      return {
        expectedQty: tracked ? 0 : null, confidenceBase: 0.95,
        velocityClass: keepClass, verified: true, verifiedSource: 'seller_toggle',
      };
    case 'seller_toggle_in':
      return {
        expectedQty: tracked ? (qty ?? cfg.bucketSome) : null, confidenceBase: 0.8,
        velocityClass: keepClass, verified: true, verifiedSource: 'seller_toggle',
      };
    case 'rider_reported_missing':
      return {
        expectedQty: tracked ? 0 : null, confidenceBase: 0.15,
        velocityClass: keepClass, verified: true, verifiedSource: 'rider_miss',
      };
    case 'admin_adjust':
      return {
        expectedQty: qty ?? prev.expectedQty, confidenceBase: 0.9,
        velocityClass: keepClass ?? (qty != null ? DEFAULT_TRACKED_CLASS : null), verified: true, verifiedSource: 'admin',
      };
    case 'backfill':
      return {
        expectedQty: qty ?? null, confidenceBase: qty != null ? 0.85 : 0.8,
        velocityClass: qty != null ? (keepClass ?? DEFAULT_TRACKED_CLASS) : keepClass,
        verified: qty != null, verifiedSource: 'backfill',
      };
  }
}

// Which projected statuses each event may write. Toggle/miss events carry an
// explicit availability meaning even for binary items; count/bucket events only
// project for tracked items (binary rows: no opinion, leave stockStatus alone).
function projectedStatus(
  eventType: BeliefEventType,
  next: BeliefState,
  current: 'available' | 'out_of_stock' | 'hidden',
  cfg: InventoryConfig,
  now: Date,
): 'available' | 'out_of_stock' | 'hidden' {
  if (current === 'hidden') return 'hidden'; // merchandising state — never touched
  switch (eventType) {
    case 'seller_toggle_out':
    case 'rider_reported_missing':
      return 'out_of_stock';
    case 'seller_toggle_in':
      return 'available';
    default:
      if (next.expectedQty == null) return current; // binary: no numeric opinion
      return projectStockStatus(current, beliefBand(next, cfg, now));
  }
}

export async function applyInventoryEvent(
  tx: InventoryTx,
  input: ApplyEventInput,
  cfg: InventoryConfig,
  now: Date = new Date(),
): Promise<ApplyEventResult> {
  const prevRow = await tx.inventoryState.findUnique({ where: { productId: input.productId } });
  const prev = {
    expectedQty: prevRow?.expectedQty ?? null,
    reservedQty: prevRow?.reservedQty ?? 0,
    velocityClass: prevRow?.velocityClass ?? null,
    confidenceBase: prevRow ? Number(prevRow.confidenceBase) : 0.8,
  };

  const patch = beliefPatch(input.eventType, prev, input.qty, cfg);
  const next: BeliefState = {
    expectedQty: patch.expectedQty,
    reservedQty: prev.reservedQty,
    velocityClass: patch.velocityClass,
    confidenceBase: patch.confidenceBase,
    lastVerifiedAt: patch.verified ? now : (prevRow?.lastVerifiedAt ?? null),
  };

  const stateData = {
    expectedQty: patch.expectedQty,
    confidenceBase: patch.confidenceBase,
    velocityClass: patch.velocityClass,
    ...(patch.verified
      ? { lastVerifiedAt: now, lastVerifiedSource: patch.verifiedSource, lastVerifiedQty: patch.expectedQty }
      : {}),
  };
  await tx.inventoryState.upsert({
    where: { productId: input.productId },
    update: stateData,
    create: { productId: input.productId, ...stateData },
  });

  // Projection (+ legacy stockQty mirror so seller-app reads stay truthful
  // until the column is dropped).
  const product = await tx.product.findUnique({
    where: { id: input.productId }, select: { stockStatus: true },
  });
  const from = product?.stockStatus ?? 'available';
  const to = projectedStatus(input.eventType, next, from, cfg, now);
  await tx.product.update({
    where: { id: input.productId },
    data: { stockQty: patch.expectedQty, ...(to !== from ? { stockStatus: to } : {}) },
  });

  // Append-only event row with post-state snapshots. createMany+skipDuplicates
  // makes order-linked events (unique on orderItemId+eventType) replay-safe.
  const prevExpected = prev.expectedQty;
  const inserted = await tx.inventoryEvent.createMany({
    data: [{
      productId: input.productId,
      shopId: input.shopId,
      eventType: input.eventType,
      qtyDelta: patch.expectedQty != null && prevExpected != null ? patch.expectedQty - prevExpected : null,
      qtyAfter: patch.expectedQty,
      reservedAfter: prev.reservedQty,
      confidenceAfter: patch.confidenceBase,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      orderId: input.orderId ?? null,
      orderItemId: input.orderItemId ?? null,
      reason: input.reason ?? null,
    }],
    skipDuplicates: true,
  });

  return {
    applied: inserted.count > 0,
    expectedQty: patch.expectedQty,
    confidenceBase: patch.confidenceBase,
    stockStatusChanged: to !== from,
    stockStatusFrom: from,
    stockStatusTo: to,
  };
}

/**
 * Make sure a product has an inventory_state row (binary defaults). Called by
 * the product-create paths so the reservation CAS never misses a row. Idempotent.
 */
export async function ensureInventoryState(tx: InventoryTx, productId: string): Promise<void> {
  await tx.inventoryState.upsert({
    where: { productId },
    update: {},
    create: { productId },
  });
}
