import {
  beliefBand, projectStockStatus,
  type BeliefState, type InventoryConfig,
} from './belief';

// ─── Reservation engine (Inventory Engine) ────────────────────────────────────
// Stock lifecycle: RESERVE at placement (soft hold, CAS-guarded) → seller bags at
// `preparing` (physical, no software) → COMMIT at rider pickup (expected −= qty,
// the rider-witnessed shelf departure) → RELEASE on cancel/reject/line-miss,
// EXPIRE when a prepaid hold outlives its TTL unpaid.
//
// Concurrency is one single-statement conditional UPDATE (§6.2): the check and
// the mutation are atomic, so there is no gap for two checkouts to race in. No
// SELECT FOR UPDATE, no Redis locks, no SERIALIZABLE. Callers must reserve lines
// in ascending productId order (deadlock rule §9.2).
//
// This file and apply-event.ts are the only writers of inventory_state.

export class ReservationConflictError extends Error {
  constructor(public readonly productId: string) {
    super(`Insufficient stock for product ${productId}`);
    this.name = 'ReservationConflictError';
  }
}

export interface ReserveLineInput {
  productId: string;
  shopId: string;
  orderId: string;
  orderItemId: string;
  qty: number;
}

interface StateSnapshot {
  expectedQty: number | null;
  reservedQty: number;
}

interface CommitSnapshot extends StateSnapshot {
  oldExpected: number | null;
  velocityClass: number | null;
  confidenceBase: unknown; // Prisma Decimal
  lastVerifiedAt: Date | null;
}

interface ClaimedReservation {
  id: string;
  productId: string;
  orderItemId: string;
  qty: number;
  shopId?: string; // resolved via join where the flow needs it for events
}

// Loose transaction slice: raw SQL plus the models the flows touch. Kept wide
// open on the raw methods so both Prisma.TransactionClient and unit-test fakes fit.
export interface ReservationTx {
  $queryRaw: <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  reservation: {
    create: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  inventoryEvent: { createMany: (args: unknown) => Promise<{ count: number }> };
  product: {
    findUnique: (args: unknown) => Promise<{ stockStatus: 'available' | 'out_of_stock' | 'hidden'; shopId: string } | null>;
    update: (args: unknown) => Promise<unknown>;
  };
}

export interface ActorRef {
  role: string; // seller | rider | customer | system | admin
  id: string | null; // User.id
}

// Re-project products.stockStatus for a TRACKED item after a counter change
// (commit can exhaust it; release can revive it). Binary rows: no opinion here.
async function reprojectTracked(
  tx: ReservationTx,
  productId: string,
  state: BeliefState,
  cfg: InventoryConfig,
  now: Date,
): Promise<void> {
  if (state.expectedQty == null) return;
  const product = await tx.product.findUnique({ where: { id: productId }, select: { stockStatus: true, shopId: true } });
  if (!product || product.stockStatus === 'hidden') return;
  const next = projectStockStatus(product.stockStatus, beliefBand(state, cfg, now));
  if (next !== product.stockStatus) {
    await tx.product.update({ where: { id: productId }, data: { stockStatus: next } });
  }
}

/**
 * Reserve one order line. Returns 'reserved' | 'insufficient'.
 *
 * The WHERE clause is the whole oversell story:
 *   tracked → expected − reserved must cover the qty (raw arithmetic — buffers
 *             and confidence gates belong to the RESOLVER, this is the last-line
 *             arithmetic guard);
 *   binary  → products.stockStatus must be 'available'.
 */
// The single-statement CAS (§6.2). Returns the post-increment snapshot, or null
// when the guard fails (insufficient tracked stock / binary item not available).
async function casIncrementReserved(
  tx: ReservationTx,
  productId: string,
  qty: number,
): Promise<StateSnapshot | null> {
  const rows = await tx.$queryRaw<StateSnapshot[]>`
    UPDATE inventory_state
    SET reserved_qty = reserved_qty + ${qty}, updated_at = now()
    WHERE product_id = ${productId}::uuid
      AND ( (expected_qty IS NOT NULL AND expected_qty - reserved_qty >= ${qty})
         OR (expected_qty IS NULL AND EXISTS (
               SELECT 1 FROM products p
               WHERE p.id = ${productId}::uuid AND p.stock_status = 'available')) )
    RETURNING expected_qty AS "expectedQty", reserved_qty AS "reservedQty"`;
  return rows[0] ?? null;
}

export async function reserveLine(
  tx: ReservationTx,
  input: ReserveLineInput,
  actor: ActorRef,
  expiresAt: Date | null,
): Promise<'reserved' | 'insufficient'> {
  const snap = await casIncrementReserved(tx, input.productId, input.qty);
  if (!snap) return 'insufficient';

  await tx.reservation.create({
    data: {
      orderId: input.orderId, orderItemId: input.orderItemId,
      productId: input.productId, qty: input.qty,
      status: 'held', expiresAt,
    },
  });
  await tx.inventoryEvent.createMany({
    data: [{
      productId: input.productId, shopId: input.shopId, eventType: 'order_reserved',
      qtyDelta: null, qtyAfter: snap.expectedQty, reservedAfter: snap.reservedQty,
      actorType: actor.role, actorId: actor.id,
      orderId: input.orderId, orderItemId: input.orderItemId, reason: null,
    }],
    skipDuplicates: true,
  });
  return 'reserved';
}

/**
 * Reserve every line of a (child) order, sorted by productId (deadlock rule).
 * Throws ReservationConflictError with the losing productId so the placement
 * retry loop can exclude that product and re-resolve.
 */
export async function reserveOrderLines(
  tx: ReservationTx,
  lines: ReserveLineInput[],
  actor: ActorRef,
  expiresAt: Date | null,
): Promise<void> {
  const sorted = [...lines].sort((a, b) => a.productId.localeCompare(b.productId));
  for (const line of sorted) {
    const res = await reserveLine(tx, line, actor, expiresAt);
    if (res === 'insufficient') throw new ReservationConflictError(line.productId);
  }
}

/**
 * COMMIT at pickup — rides the ready_for_pickup → picked_up transition (hooked
 * in transitionOrderStatus, same transaction). Commits every line still
 * `fulfilled` (misses were already released by riderReportItemUnavailable):
 * expected −= qty (floored at 0, anomaly-logged), reserved −= qty, weak
 * confidence reinforcement, verification clock reset (a pickup IS a
 * verification — the rider witnessed the units). Idempotent: the held→committed
 * claim no-ops on replay.
 */
export async function commitReservationsForOrder(
  tx: ReservationTx,
  orderId: string,
  actor: ActorRef,
  cfg: InventoryConfig,
  now: Date = new Date(),
): Promise<number> {
  const claimed = await tx.$queryRaw<ClaimedReservation[]>`
    UPDATE reservations r
    SET status = 'committed', resolved_at = now()
    FROM order_items oi
    WHERE r.order_id = ${orderId}::uuid
      AND r.status = 'held'
      AND oi.id = r.order_item_id
      AND oi.fulfillment_status = 'fulfilled'
    RETURNING r.id, r.product_id AS "productId", r.order_item_id AS "orderItemId", r.qty,
              (SELECT p.shop_id FROM products p WHERE p.id = r.product_id) AS "shopId"`;

  for (const line of claimed) {
    const rows = await tx.$queryRaw<CommitSnapshot[]>`
      WITH old AS (
        SELECT expected_qty FROM inventory_state
        WHERE product_id = ${line.productId}::uuid FOR UPDATE
      )
      UPDATE inventory_state s SET
        reserved_qty    = GREATEST(0, s.reserved_qty - ${line.qty}),
        expected_qty    = CASE WHEN s.expected_qty IS NULL THEN NULL
                               ELSE GREATEST(0, s.expected_qty - ${line.qty}) END,
        confidence_base = LEAST(s.confidence_base + 0.05, 0.95),
        last_verified_at     = now(),
        last_verified_source = 'rider_pickup',
        last_verified_qty    = CASE WHEN s.expected_qty IS NULL THEN NULL
                                    ELSE GREATEST(0, s.expected_qty - ${line.qty}) END,
        updated_at = now()
      WHERE s.product_id = ${line.productId}::uuid
      RETURNING s.expected_qty AS "expectedQty", s.reserved_qty AS "reservedQty",
                s.velocity_class AS "velocityClass", s.confidence_base AS "confidenceBase",
                s.last_verified_at AS "lastVerifiedAt",
                (SELECT expected_qty FROM old) AS "oldExpected"`;
    const snap = rows[0];
    if (!snap) continue; // state row missing — reconciler will recreate + flag

    const floored = snap.oldExpected != null && snap.oldExpected < line.qty;
    const shopId = line.shopId ?? '';
    await tx.inventoryEvent.createMany({
      data: [
        {
          productId: line.productId, shopId, eventType: 'pickup_committed',
          qtyDelta: -line.qty, qtyAfter: snap.expectedQty, reservedAfter: snap.reservedQty,
          confidenceAfter: floored ? 0.2 : Number(snap.confidenceBase),
          actorType: actor.role, actorId: actor.id,
          orderId, orderItemId: line.orderItemId, reason: null,
        },
        ...(floored
          ? [{
              productId: line.productId, shopId, eventType: 'anomaly_negative_floor',
              qtyDelta: null, qtyAfter: snap.expectedQty, reservedAfter: snap.reservedQty,
              confidenceAfter: 0.2,
              actorType: 'system', actorId: null,
              orderId, orderItemId: line.orderItemId,
              reason: `commit qty ${line.qty} exceeded believed ${snap.oldExpected}`,
            }]
          : []),
      ],
      skipDuplicates: true,
    });
    if (floored) {
      // Drift bigger than believed — an anomaly is information: distrust the belief.
      await tx.$executeRaw`
        UPDATE inventory_state SET confidence_base = 0.200, updated_at = now()
        WHERE product_id = ${line.productId}::uuid`;
    }

    // Mirror the belief into the legacy column + re-project availability.
    if (snap.expectedQty != null) {
      await tx.product.update({ where: { id: line.productId }, data: { stockQty: snap.expectedQty } });
    }
    await reprojectTracked(tx, line.productId, {
      expectedQty: snap.expectedQty, reservedQty: snap.reservedQty,
      velocityClass: snap.velocityClass,
      confidenceBase: floored ? 0.2 : Number(snap.confidenceBase),
      lastVerifiedAt: now,
    }, cfg, now);
  }
  return claimed.length;
}

type ReleaseKind = 'reservation_released' | 'reservation_expired';

async function releaseClaimed(
  tx: ReservationTx,
  claimed: ClaimedReservation[],
  eventType: ReleaseKind,
  actor: ActorRef,
  cfg: InventoryConfig,
  now: Date,
  reason: string | null,
): Promise<void> {
  for (const line of claimed) {
    const rows = await tx.$queryRaw<Array<StateSnapshot & {
      velocityClass: number | null; confidenceBase: unknown; lastVerifiedAt: Date | null; shopIdResolved: string;
    }>>`
      UPDATE inventory_state s SET
        reserved_qty = GREATEST(0, s.reserved_qty - ${line.qty}),
        updated_at = now()
      FROM products p
      WHERE s.product_id = ${line.productId}::uuid AND p.id = s.product_id
      RETURNING s.expected_qty AS "expectedQty", s.reserved_qty AS "reservedQty",
                s.velocity_class AS "velocityClass", s.confidence_base AS "confidenceBase",
                s.last_verified_at AS "lastVerifiedAt", p.shop_id AS "shopIdResolved"`;
    const snap = rows[0];
    if (!snap) continue;

    await tx.inventoryEvent.createMany({
      data: [{
        productId: line.productId, shopId: snap.shopIdResolved, eventType,
        qtyDelta: null, qtyAfter: snap.expectedQty, reservedAfter: snap.reservedQty,
        actorType: actor.role, actorId: actor.id,
        orderId: null, orderItemId: line.orderItemId, reason,
      }],
      skipDuplicates: true,
    });

    // Releasing raises effective qty — a fully-reserved tracked item may come
    // back to 'available'.
    await reprojectTracked(tx, line.productId, {
      expectedQty: snap.expectedQty, reservedQty: snap.reservedQty,
      velocityClass: snap.velocityClass, confidenceBase: Number(snap.confidenceBase),
      lastVerifiedAt: snap.lastVerifiedAt,
    }, cfg, now);
  }
}

/**
 * RELEASE all held reservations of an order — rides every `→ cancelled`
 * transition (hooked in transitionOrderStatus, same transaction), so no cancel
 * path can ever forget to give the stock back. Post-pickup cancels are
 * naturally a no-op: those reservations are already `committed` (the goods
 * physically left with the rider; returns are a manual admin flow).
 */
export async function releaseReservationsForOrder(
  tx: ReservationTx,
  orderId: string,
  actor: ActorRef,
  cfg: InventoryConfig,
  now: Date = new Date(),
  reason: string | null = null,
): Promise<number> {
  const claimed = await tx.$queryRaw<ClaimedReservation[]>`
    UPDATE reservations
    SET status = 'released', resolved_at = now()
    WHERE order_id = ${orderId}::uuid AND status = 'held'
    RETURNING id, product_id AS "productId", order_item_id AS "orderItemId", qty`;
  await releaseClaimed(tx, claimed, 'reservation_released', actor, cfg, now, reason);
  return claimed.length;
}

/** RELEASE one line's hold (rider miss / seller "नहीं" chip). Idempotent. */
export async function releaseReservationForOrderItem(
  tx: ReservationTx,
  orderItemId: string,
  actor: ActorRef,
  cfg: InventoryConfig,
  now: Date = new Date(),
  reason: string | null = null,
): Promise<boolean> {
  const claimed = await tx.$queryRaw<ClaimedReservation[]>`
    UPDATE reservations
    SET status = 'released', resolved_at = now()
    WHERE order_item_id = ${orderItemId}::uuid AND status = 'held'
    RETURNING id, product_id AS "productId", order_item_id AS "orderItemId", qty`;
  await releaseClaimed(tx, claimed, 'reservation_released', actor, cfg, now, reason);
  return claimed.length > 0;
}

/**
 * Shrink one line's hold from its current qty to `newQty` (seller chip
 * "सिर्फ n"). The freed units go back to the pool; the reservation row keeps
 * the reduced qty so the eventual pickup commit decrements exactly what leaves.
 * No event/projection here — the caller follows with a `seller_count` belief
 * event (applyInventoryEvent), which snapshots and re-projects.
 */
export async function shrinkReservationForOrderItem(
  tx: ReservationTx,
  orderItemId: string,
  newQty: number,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ productId: string; freed: number }>>`
    WITH old AS (
      SELECT id, qty, product_id FROM reservations
      WHERE order_item_id = ${orderItemId}::uuid AND status = 'held' AND qty > ${newQty}
      FOR UPDATE
    )
    UPDATE reservations r
    SET qty = ${newQty}
    FROM old
    WHERE r.id = old.id
    RETURNING old.product_id AS "productId", old.qty - ${newQty} AS "freed"`;
  const row = rows[0];
  if (!row) return false;
  await tx.$executeRaw`
    UPDATE inventory_state SET reserved_qty = GREATEST(0, reserved_qty - ${row.freed}), updated_at = now()
    WHERE product_id = ${row.productId}::uuid`;
  return true;
}

// ─── Process-level flows (each row in its own transaction) ────────────────────

export interface ReservationPrisma {
  $transaction: <T>(fn: (tx: ReservationTx) => Promise<T>) => Promise<T>;
  reservation: {
    findMany: (args: unknown) => Promise<Array<{
      id: string; orderId: string; orderItemId: string; productId: string; qty: number;
    }>>;
  };
  orderItem: { updateMany: (args: unknown) => Promise<{ count: number }> };
}

/**
 * Expiry sweeper (60s repeatable job): a prepaid hold whose payment never landed
 * within the TTL goes `held → expired` and returns its units to the pool. Each
 * reservation is processed in its own transaction with a `WHERE status='held'`
 * claim, so a crashed/rerun sweep is harmless.
 */
export async function sweepExpiredReservations(
  prisma: ReservationPrisma,
  cfg: InventoryConfig,
  now: Date = new Date(),
): Promise<number> {
  const due = await prisma.reservation.findMany({
    where: { status: 'held', expiresAt: { lt: now } },
    select: { id: true, orderId: true, orderItemId: true, productId: true, qty: true },
    take: 200,
  });
  let swept = 0;
  for (const r of due) {
    try {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.$queryRaw<ClaimedReservation[]>`
          UPDATE reservations
          SET status = 'expired', resolved_at = now()
          WHERE id = ${r.id}::uuid AND status = 'held'
          RETURNING id, product_id AS "productId", order_item_id AS "orderItemId", qty`;
        if (claimed.length === 0) return; // lost the claim (paid/cancelled meanwhile)
        await releaseClaimed(
          tx, claimed, 'reservation_expired',
          { role: 'system', id: null }, cfg, now, 'prepaid hold TTL elapsed',
        );
        swept += 1;
      });
    } catch (err) {
      console.error(`[inventory] expiry sweep failed for reservation ${r.id}:`, err);
    }
  }
  return swept;
}

/**
 * A payment landed AFTER the hold expired (webhook delay / reconciliation):
 * try to take the stock back. A line whose CAS now fails is NOT blocked — the
 * order proceeds and the line is flagged for the seller accept screen
 * (`verificationFlag = accept_verify_requested`), which is exactly the
 * accept-time verification flow. Returns the flagged orderItemIds.
 */
export async function reclaimExpiredReservations(
  prisma: ReservationPrisma,
  orderId: string,
): Promise<string[]> {
  const expired = await prisma.reservation.findMany({
    where: { orderId, status: 'expired' },
    select: { id: true, orderId: true, orderItemId: true, productId: true, qty: true },
  });
  const flagged: string[] = [];
  for (const r of expired) {
    try {
      await prisma.$transaction(async (tx) => {
        const claim = await tx.reservation.updateMany({
          where: { id: r.id, status: 'expired' },
          data: { status: 'held', expiresAt: null, resolvedAt: null },
        });
        if (claim.count === 0) return; // someone else already handled it
        const snap = await casIncrementReserved(tx, r.productId, r.qty);
        if (!snap) throw new ReservationConflictError(r.productId);
      });
    } catch (err) {
      if (err instanceof ReservationConflictError) {
        flagged.push(r.orderItemId);
      } else {
        console.error(`[inventory] re-reserve failed for reservation ${r.id}:`, err);
        flagged.push(r.orderItemId);
      }
    }
  }
  if (flagged.length > 0) {
    await prisma.orderItem.updateMany({
      where: { id: { in: flagged } },
      data: { verificationFlag: 'accept_verify_requested' },
    }).catch(() => {}); // flagging is best-effort; the chip is a safety net, not a gate
  }
  return flagged;
}
