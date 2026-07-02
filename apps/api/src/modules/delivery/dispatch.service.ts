import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { NotFoundError, ForbiddenError, BusinessRuleError } from '../../shared/errors/app-errors';
import {
  pointInPolygon, polygonCentroid, haversineMeters, type LatLng,
} from '../../shared/utils/geo';
import { emitOrderAssignedToRider, emitOrderStatusChanged } from '../../shared/events/event-bus';
import { computeAndPersistEta } from '../orders/eta.service';
import { transitionOrderStatus } from '../orders/order-status';

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
      riderUserId:      best.userId,
      shopName:         shop?.name ?? 'Dukaan',
      shopAddress:      '',
      deliveryLocality: order.deliveryLocality,
      totalAmount:      order.totalAmount,
      paymentMethod:    order.paymentMethod,
    });

    // Recompute the milestone ETA now that a rider is on the order (ETA MVP Phase 1).
    await computeAndPersistEta(prisma, orderId);
    return { assigned: true as const, riderId: best.riderProfileId, zone: zone?.name ?? null };
  }

  // ── Rider active delivery / batch (Task 5.5) ───────────────────────────────

  // The rider's current trip: every order on an active assignment, grouped as a
  // batch with distinct pickup shops and per-order dropoffs.
  async function getActiveDelivery(userId: string) {
    const rider = await prisma.riderProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!rider) throw new NotFoundError('Rider profile');

    const assignments = await prisma.deliveryAssignment.findMany({
      where:   { riderId: rider.id, isActive: true },
      orderBy: { assignedAt: 'asc' },
      select:  { orderId: true },
    });
    if (assignments.length === 0) return null;

    const orders = await prisma.order.findMany({
      where:  { id: { in: assignments.map((a) => a.orderId) } },
      select: {
        id: true, status: true, paymentMethod: true, totalAmount: true, batchId: true,
        deliveryStreet: true, deliveryLandmark: true, deliveryLocality: true,
        deliveryLat: true, deliveryLng: true,
        receiverName: true, receiverPhone: true,
        shop:     { select: { name: true, lat: true, lng: true, address: true } },
        customer: { select: { phone: true, customerProfile: { select: { firstName: true, lastName: true } } } },
        items:    { select: { productName: true, quantity: true } },
      },
    });

    const stops = orders.map((o) => ({
      id: o.id, status: o.status, paymentMethod: o.paymentMethod, totalAmount: o.totalAmount,
      shop: { name: o.shop.name, address: o.shop.address ?? '', lat: Number(o.shop.lat), lng: Number(o.shop.lng) },
      items: o.items,
      deliveryStreet: o.deliveryStreet, deliveryLandmark: o.deliveryLandmark, deliveryLocality: o.deliveryLocality,
      deliveryLat: Number(o.deliveryLat), deliveryLng: Number(o.deliveryLng),
      // Who the rider should contact — the receiver if set, else the account owner.
      receiverName:  o.receiverName ??
        [o.customer.customerProfile?.firstName, o.customer.customerProfile?.lastName].filter(Boolean).join(' '),
      receiverPhone: o.receiverPhone ?? o.customer.phone ?? '',
    }));

    const PICKED = ['picked_up', 'out_for_delivery', 'delivered'];
    return {
      batchId:     orders[0]?.batchId ?? null,
      orderCount:  stops.length,
      allPickedUp: stops.every((s) => PICKED.includes(s.status)),
      orders:      stops,
    };
  }

  // Shared status transition for rider actions — verifies the rider owns the
  // order (active assignment) then advances status + logs history + emits.
  async function riderAdvance(userId: string, orderId: string, newStatus: string) {
    const rider = await prisma.riderProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!rider) throw new NotFoundError('Rider profile');
    const assignment = await prisma.deliveryAssignment.findFirst({
      where: { orderId, riderId: rider.id, isActive: true },
    });
    if (!assignment) throw new ForbiddenError('Not your delivery');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    // Can't go out for delivery until every order in the batch is picked up.
    if (newStatus === 'out_for_delivery' && order.batchId) {
      const notPicked = await prisma.order.count({
        where: { batchId: order.batchId, status: { in: ['confirmed', 'preparing', 'ready_for_pickup'] } },
      });
      if (notPicked > 0) throw new BusinessRuleError('Pehle batch ke saare orders pickup karein');
    }

    // Single enforcement point: assertTransition + atomic compare-and-set + history.
    // Rejects a reverse move (e.g. delivered → out_for_delivery / picked_up — V1/V2).
    const moved = await prisma.$transaction(async (tx) =>
      transitionOrderStatus(tx, orderId, order.status, newStatus, { role: 'rider', id: userId }),
    );

    if (moved) {
      // Recompute + persist + emit the milestone ETA BEFORE the status event, so any
      // ORDER_STATUS_CHANGED consumer (e.g. the out_for_delivery push) reads the fresh,
      // persisted ETA rather than the previous phase's value (P2 hardening, review #10).
      await computeAndPersistEta(prisma, orderId);

      emitOrderStatusChanged({
        orderId, status: newStatus, shopId: order.shopId, customerId: order.customerId,
      });
    }
    return { status: newStatus };
  }

  const markPickedUp  = (userId: string, orderId: string) => riderAdvance(userId, orderId, 'picked_up');
  const startDelivery = (userId: string, orderId: string) => riderAdvance(userId, orderId, 'out_for_delivery');

  // Last-known rider location for an order (Chunk 6.3) — used for the initial
  // map paint and the stale fallback. Reads the Redis key the socket layer
  // writes (rider:{userId}:location, 30s TTL). Returns null if unknown/stale.
  async function getRiderLocationForOrder(orderId: string, requesterId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId }, select: { customerId: true, riderId: true },
    });
    if (!order) throw new NotFoundError('Order');
    if (order.customerId !== requesterId) throw new ForbiddenError('Not your order');
    if (!order.riderId) return { location: null as null | { lat: number; lng: number; ageMs: number } };

    const rp = await prisma.riderProfile.findUnique({ where: { id: order.riderId }, select: { userId: true } });
    if (!rp) return { location: null };

    const raw = await redis.get(`rider:${rp.userId}:location`);
    if (!raw) return { location: null };
    try {
      const { lat, lng, ts } = JSON.parse(raw) as { lat: number; lng: number; ts: number };
      return { location: { lat, lng, ageMs: Math.max(0, Date.now() - ts) } };
    } catch {
      return { location: null };
    }
  }

  return { setAvailability, getAvailability, assignOrder, getActiveDelivery, markPickedUp, startDelivery, getRiderLocationForOrder };
}
