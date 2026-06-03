import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { NotFoundError } from '../../shared/errors/app-errors';
import { haversineMeters, type LatLng } from '../../shared/utils/geo';
import { pickZone, pickBestRider, type ZoneLite, type RiderCandidate } from './dispatch.service';
import { emitOrderAssignedToRider } from '../../shared/events/event-bus';

// Orders within this radius of the batch anchor may join the same batch (Task 5.4).
export const BATCH_RADIUS_M = 800;
export const BATCH_MAX_SIZE = 3;

export interface OpenBatch {
  id: string;
  zoneId: string | null;
  anchor: LatLng;
  closesAt: Date;
  orderCount: number;
}

// Pure: can `point` join this open batch right now? Same zone, within radius,
// still inside its window, and not already full.
export function isBatchEligible(
  batch: OpenBatch, point: LatLng, zoneId: string | null, now: Date,
): boolean {
  if (batch.zoneId !== zoneId) return false;
  if (batch.orderCount >= BATCH_MAX_SIZE) return false;
  if (batch.closesAt.getTime() <= now.getTime()) return false;
  return haversineMeters(batch.anchor, point) <= BATCH_RADIUS_M;
}

export function createBatchingService(prisma: PrismaClient, redis: Redis) {
  async function loadActiveZones(): Promise<ZoneLite[]> {
    const zones = await prisma.deliveryZone.findMany({ where: { isActive: true } });
    return zones.map((z) => ({ id: z.id, name: z.name, polygon: (z.polygon as unknown as LatLng[]) ?? [] }));
  }

  // Add a freshly-confirmed order to an open batch (joining a nearby one or
  // opening a new one). Returns what the caller should do next.
  async function addConfirmedOrderToBatch(
    orderId: string, windowMs: number,
  ): Promise<{ batchId: string; action: 'new' | 'joined' | 'assign-now' | 'none' }> {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order');
    if (order.batchId) return { batchId: order.batchId, action: 'none' };

    const point: LatLng = { lat: Number(order.deliveryLat), lng: Number(order.deliveryLng) };
    const zone = pickZone(await loadActiveZones(), point);
    const zoneId = zone?.id ?? null;
    const now = new Date();

    // Candidate open batches in the same zone, still open.
    const openBatches = await prisma.batch.findMany({
      where:  { status: 'open', zoneId, closesAt: { gt: now } },
      select: { id: true, zoneId: true, anchorLat: true, anchorLng: true, closesAt: true, _count: { select: { orders: true } } },
    });

    const eligible = openBatches
      .map((b): OpenBatch => ({
        id: b.id, zoneId: b.zoneId,
        anchor: { lat: Number(b.anchorLat), lng: Number(b.anchorLng) },
        closesAt: b.closesAt, orderCount: b._count.orders,
      }))
      .find((b) => isBatchEligible(b, point, zoneId, now));

    if (eligible) {
      await prisma.order.update({ where: { id: orderId }, data: { batchId: eligible.id } });
      const full = eligible.orderCount + 1 >= BATCH_MAX_SIZE;
      return { batchId: eligible.id, action: full ? 'assign-now' : 'joined' };
    }

    const batch = await prisma.batch.create({
      data: {
        zoneId, status: 'open',
        anchorLat: point.lat, anchorLng: point.lng,
        closesAt: new Date(now.getTime() + windowMs),
      },
    });
    await prisma.order.update({ where: { id: orderId }, data: { batchId: batch.id } });
    return { batchId: batch.id, action: 'new' };
  }

  // Pick the best available rider for a delivery point (online, in-zone preferred,
  // fewest active deliveries). Shared shape with single-order assignment.
  async function findBestRiderForPoint(point: LatLng): Promise<RiderCandidate | null> {
    const zone = pickZone(await loadActiveZones(), point);
    const online = await prisma.riderAvailability.findMany({ where: { status: 'online' }, select: { riderId: true } });
    const onlineIds = new Set(online.map((a) => a.riderId));
    if (onlineIds.size === 0) return null;

    let riderIds: string[] = [];
    if (zone) {
      const inZone = await prisma.riderZone.findMany({ where: { zoneId: zone.id }, select: { riderId: true } });
      riderIds = inZone.map((r) => r.riderId).filter((id) => onlineIds.has(id));
    }
    if (riderIds.length === 0) riderIds = [...onlineIds];

    const candidates: RiderCandidate[] = [];
    for (const rid of riderIds) {
      const [profile, activeCount] = await Promise.all([
        prisma.riderProfile.findUnique({ where: { id: rid }, select: { userId: true } }),
        prisma.deliveryAssignment.count({ where: { riderId: rid, isActive: true } }),
      ]);
      if (profile) candidates.push({ riderProfileId: rid, userId: profile.userId, activeCount });
    }
    return pickBestRider(candidates);
  }

  // Close an open batch and assign all its orders to one rider (Task 5.4).
  // Returns assigned=false (no rider) so the worker can retry/escalate.
  async function assignBatch(batchId: string): Promise<{ assigned: boolean; reason?: string; riderId?: string; orderCount?: number }> {
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: { orders: { select: { id: true, shopId: true, totalAmount: true, paymentMethod: true, deliveryLocality: true } } },
    });
    if (!batch) return { assigned: false, reason: 'not_found' };
    if (batch.status !== 'open') return { assigned: false, reason: 'already_handled' };
    if (batch.orders.length === 0) {
      await prisma.batch.update({ where: { id: batchId }, data: { status: 'cancelled' } });
      return { assigned: false, reason: 'empty' };
    }

    const rider = await findBestRiderForPoint({ lat: Number(batch.anchorLat), lng: Number(batch.anchorLng) });
    if (!rider) return { assigned: false, reason: 'no_rider' };

    await prisma.$transaction([
      ...batch.orders.map((o) =>
        prisma.deliveryAssignment.create({ data: { orderId: o.id, riderId: rider.riderProfileId, isActive: true } })),
      prisma.order.updateMany({ where: { batchId }, data: { riderId: rider.riderProfileId } }),
      prisma.batch.update({ where: { id: batchId }, data: { status: 'assigned', riderId: rider.riderProfileId } }),
    ]);

    // One push to the rider for the whole batch (the batch delivery screen lists
    // every stop). Use the anchor order for the headline.
    const anchor = batch.orders[0]!;
    const shop = await prisma.shop.findUnique({ where: { id: anchor.shopId }, select: { name: true } });
    const totalAmount = batch.orders.reduce((s, o) => s + o.totalAmount, 0);
    emitOrderAssignedToRider({
      orderId:          anchor.id,
      riderId:          rider.userId,
      shopName:         batch.orders.length > 1 ? `${shop?.name ?? 'Dukaan'} +${batch.orders.length - 1}` : (shop?.name ?? 'Dukaan'),
      shopAddress:      '',
      deliveryLocality: anchor.deliveryLocality,
      totalAmount,
      paymentMethod:    anchor.paymentMethod,
    });

    return { assigned: true, riderId: rider.riderProfileId, orderCount: batch.orders.length };
  }

  return { addConfirmedOrderToBatch, assignBatch, findBestRiderForPoint };
}
