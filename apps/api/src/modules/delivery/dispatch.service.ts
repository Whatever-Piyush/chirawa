import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { NotFoundError } from '../../shared/errors/app-errors';
import {
  pointInPolygon, polygonCentroid, haversineMeters, type LatLng,
} from '../../shared/utils/geo';
import { emitOrderAssignedToRider } from '../../shared/events/event-bus';

export type AvailabilityStatus = 'online' | 'offline' | 'on_delivery';

export interface ZoneLite { id: string; name: string; polygon: LatLng[] }
export interface RiderCandidate { riderProfileId: string; userId: string; activeCount: number }

// ── Pure decision helpers (unit-tested) ──────────────────────────────────────

// Pick the zone whose polygon contains the point; if none contains it, fall back
// to the geographically nearest zone (by centroid) so an edge/outside point is
// still served rather than dropped.
export function pickZone(zones: ZoneLite[], point: LatLng): ZoneLite | null {
  if (zones.length === 0) return null;
  const hit = zones.find((z) => pointInPolygon(point, z.polygon));
  if (hit) return hit;
  return [...zones].sort(
    (a, b) =>
      haversineMeters(point, polygonCentroid(a.polygon)) -
      haversineMeters(point, polygonCentroid(b.polygon)),
  )[0] ?? null;
}

// Among available riders, the one with the fewest active deliveries wins
// (load-balancing). Ties resolve to the first — stable order.
export function pickBestRider(candidates: RiderCandidate[]): RiderCandidate | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => a.activeCount - b.activeCount)[0]!;
}

// ── Service ───────────────────────────────────────────────────────────────────

export function createDispatchService(prisma: PrismaClient, redis: Redis) {
  // Rider goes online / offline (Task 5.2). Authoritative state in Postgres,
  // fast-path copy in Redis for the assignment hot path.
  async function setAvailability(
    userId: string, status: AvailabilityStatus, lat?: number, lng?: number,
  ) {
    const rider = await prisma.riderProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!rider) throw new NotFoundError('Rider profile');

    const geo = (lat != null && lng != null) ? { currentLat: lat, currentLng: lng } : {};
    await prisma.riderAvailability.upsert({
      where:  { riderId: rider.id },
      update: { status, lastSeenAt: new Date(), ...geo },
      create: { riderId: rider.id, status, ...geo },
    });

    await redis.set(`rider:${rider.id}:availability`, status);
    if (lat != null && lng != null) {
      await redis.set(`rider:${rider.id}:location`, JSON.stringify({ lat, lng, ts: Date.now() }));
    }
    return { status };
  }

  // Current availability for the rider home screen (defaults to offline).
  async function getAvailability(userId: string): Promise<{ status: AvailabilityStatus }> {
    const rider = await prisma.riderProfile.findUnique({
      where:  { userId },
      select: { availability: { select: { status: true } } },
    });
    if (!rider) throw new NotFoundError('Rider profile');
    return { status: (rider.availability?.status as AvailabilityStatus) ?? 'offline' };
  }

  async function loadActiveZones(): Promise<ZoneLite[]> {
    const zones = await prisma.deliveryZone.findMany({ where: { isActive: true } });
    return zones.map((z) => ({ id: z.id, name: z.name, polygon: (z.polygon as unknown as LatLng[]) ?? [] }));
  }

  // Auto-assign an order to the best available rider (Task 5.3 core). Returns a
  // result object rather than throwing on "no rider" so callers (worker) can retry.
  async function assignOrder(orderId: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order');
    if (order.riderId) return { assigned: false as const, reason: 'already_assigned', riderId: order.riderId };

    const point: LatLng = { lat: Number(order.deliveryLat), lng: Number(order.deliveryLng) };
    const zone = pickZone(await loadActiveZones(), point);

    // All currently-online riders.
    const online = await prisma.riderAvailability.findMany({
      where: { status: 'online' }, select: { riderId: true },
    });
    const onlineIds = new Set(online.map((a) => a.riderId));
    if (onlineIds.size === 0) return { assigned: false as const, reason: 'no_online_rider' };

    // Prefer riders assigned to the order's zone; fall back to any online rider
    // (the "expand to adjacent zones" rule, simplified for a 3 km town).
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

    const best = pickBestRider(candidates);
    if (!best) return { assigned: false as const, reason: 'no_candidate' };

    await prisma.$transaction([
      prisma.deliveryAssignment.create({ data: { orderId, riderId: best.riderProfileId, isActive: true } }),
      prisma.order.update({ where: { id: orderId }, data: { riderId: best.riderProfileId } }),
    ]);

    const shop = await prisma.shop.findUnique({ where: { id: order.shopId }, select: { name: true } });
    emitOrderAssignedToRider({
      orderId,
      riderId:          best.userId,           // user id — notification token lookup
      shopName:         shop?.name ?? 'Dukaan',
      shopAddress:      '',
      deliveryLocality: order.deliveryLocality,
      totalAmount:      order.totalAmount,
      paymentMethod:    order.paymentMethod,
    });

    return { assigned: true as const, riderId: best.riderProfileId, zone: zone?.name ?? null };
  }

  return { setAvailability, getAvailability, assignOrder };
}
