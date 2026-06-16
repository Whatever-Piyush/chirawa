import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import type { CreateRequestInput } from './catalog.schema';
import { isValidEan } from '../../shared/utils/barcode';
import { sendPush } from '../notifications/fcm.service';
import { CustomerNotifications } from '../notifications/notification.templates';

// ─── Request-this-item + restock notify (Catalog Engine Phase 6) ──────────────
// Captures unmet demand (a customer asks for an item we don't stock / is out of
// stock), ranks it for the admin sourcing dashboard, and FCMs the requester when
// the item's master is back in stock. ProductRequest.userId is nullable (anon),
// but the capture route is authenticated so restock-notify always has a target.

// Mirrors the key the notifications layer uses (notifications.routes/plugin); the
// FCM device token is stashed in Redis on app startup with a 90-day TTL.
const fcmTokenKey = (userId: string) => `fcm:token:${userId}`;

export interface DemandGroup {
  key:             string;
  type:            'master' | 'barcode' | 'text';
  label:           string;
  count:           number;
  distinctUsers:   number;
  pincodes:        string[];
  lastRequestedAt: Date;
  sampleText:      string | null;
}

export function createRequestsService(prisma: PrismaClient, redis: Redis) {

  // Create a demand request. A valid barcode that matches a MasterCatalog row is
  // linked so the admin dashboard + restock-notify can group by master.
  async function createRequest(userId: string, input: CreateRequestInput) {
    let masterId = input.masterId ?? null;
    if (!masterId && input.barcode && isValidEan(input.barcode)) {
      const master = await prisma.masterCatalog.findUnique({
        where: { barcode: input.barcode }, select: { id: true },
      });
      if (master) masterId = master.id;
    }

    const created = await prisma.productRequest.create({
      data: {
        userId,
        rawText:         input.rawText ?? null,
        barcode:         input.barcode ?? null,
        masterId,
        pincode:         input.pincode ?? null,
        notifyOnRestock: input.notifyOnRestock ?? false,
      },
      select: { id: true, masterId: true },
    });
    return { id: created.id, masterId: created.masterId, message: 'Request mil gayi — hum jaldi laane ki koshish karenge' };
  }

  // Ranked demand for the admin sourcing dashboard. Groups by master → barcode →
  // normalized text (low launch volume, so grouped in JS rather than SQL), most-
  // requested first.
  async function getDemand(limit = 2000): Promise<DemandGroup[]> {
    const rows = await prisma.productRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take:    limit,
      select:  { userId: true, rawText: true, barcode: true, masterId: true, pincode: true, createdAt: true },
    });

    interface Acc { type: DemandGroup['type']; label: string; count: number; users: Set<string>; pincodes: Set<string>; last: Date; sample: string | null }
    const groups = new Map<string, Acc>();
    for (const r of rows) {
      const key = r.masterId
        ? `m:${r.masterId}`
        : r.barcode
          ? `b:${r.barcode}`
          : `t:${(r.rawText ?? '').trim().toLowerCase()}`;
      const type: DemandGroup['type'] = r.masterId ? 'master' : r.barcode ? 'barcode' : 'text';
      const label = r.barcode ?? r.rawText ?? '(unknown)'; // master label filled in below

      let g = groups.get(key);
      if (!g) { g = { type, label, count: 0, users: new Set(), pincodes: new Set(), last: r.createdAt, sample: r.rawText ?? null }; groups.set(key, g); }
      g.count += 1;
      if (r.userId) g.users.add(r.userId);
      if (r.pincode) g.pincodes.add(r.pincode);
      if (r.createdAt > g.last) g.last = r.createdAt;
      if (!g.sample && r.rawText) g.sample = r.rawText;
    }

    // Resolve canonical names for master-keyed groups in one query.
    const masterIds = [...groups.keys()].filter((k) => k.startsWith('m:')).map((k) => k.slice(2));
    if (masterIds.length) {
      const masters = await prisma.masterCatalog.findMany({
        where: { id: { in: masterIds } }, select: { id: true, name: true },
      });
      const nameById = new Map(masters.map((m) => [m.id, m.name]));
      for (const [k, g] of groups) {
        if (k.startsWith('m:')) g.label = nameById.get(k.slice(2)) ?? g.label;
      }
    }

    return [...groups.entries()]
      .map(([key, g]): DemandGroup => ({
        key, type: g.type, label: g.label, count: g.count,
        distinctUsers: g.users.size, pincodes: [...g.pincodes],
        lastRequestedAt: g.last, sampleText: g.sample,
      }))
      .sort((a, b) => b.count - a.count || b.lastRequestedAt.getTime() - a.lastRequestedAt.getTime());
  }

  // Restock fan-out: FCM every requester who opted in for this master and hasn't
  // been notified yet, then stamp notifiedAt so it stays at-most-once even if the
  // stock toggle re-fires. Token-less requesters are left un-stamped → retried on
  // a later restock (when they may have registered). Best-effort, never throws.
  async function notifyRestock(masterId: string): Promise<{ notified: number }> {
    const reqs = await prisma.productRequest.findMany({
      where:  { masterId, notifyOnRestock: true, notifiedAt: null, userId: { not: null } },
      select: { id: true, userId: true },
    });
    if (reqs.length === 0) return { notified: 0 };

    const master = await prisma.masterCatalog.findUnique({ where: { id: masterId }, select: { name: true } });
    const notif  = CustomerNotifications.restockAvailable(master?.name ?? 'Aapka item');

    let notified = 0;
    for (const r of reqs) {
      if (!r.userId) continue;
      const token = await redis.get(fcmTokenKey(r.userId)).catch(() => null);
      if (!token) continue; // leave notifiedAt null → retry on the next restock
      await sendPush({ token, ...notif, data: { masterId, screen: 'Search' }, channel: 'chirawa_general' }).catch(() => {});
      await prisma.notification.create({
        data: { userId: r.userId, channel: 'fcm', eventType: 'restock_available', title: notif.title, body: notif.body },
      }).catch(() => {});
      await prisma.productRequest.update({ where: { id: r.id }, data: { notifiedAt: new Date() } });
      notified += 1;
    }
    return { notified };
  }

  return { createRequest, getDemand, notifyRestock };
}
