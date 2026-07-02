// Realtime socket helpers — extracted from realtime.plugin.ts so the
// authorization decision and the broadcast shape are unit-testable without
// booting Socket.IO / Redis / env. Type-only socket.io import (erased at build).
import type { Server as SocketIOServer } from 'socket.io';

// The minimal order shape needed to authorize an order-room subscription.
// Mirrors the `select` used by the order:subscribe handler.
export interface OrderAuthzView {
  customerId: string;
  riderId: string | null;                  // RiderProfile.id (Order.riderId is denormalized)
  shop: { seller: { userId: string } };    // shop → seller (SellerProfile) → owning user
}

export interface SocketViewer {
  userId:    string;   // JWT sub (User.id)
  role:      string;   // UserRole
  profileId: string;   // role's profile id; for riders this is RiderProfile.id
}

/**
 * IDOR guard for `order:subscribe`. Returns true only when the authenticated
 * viewer is allowed to watch this order's room. Mirrors the REST authorization
 * in orders.service.getOrder() exactly:
 *   • admin                         → any order
 *   • customer who owns the order   → order.customerId === userId
 *   • assigned rider               → order.riderId === profileId (RiderProfile.id)
 *   • seller who owns the shop      → order.shop.seller.userId === userId
 * Fail-closed: a missing order (null) or any other role/identity → false.
 */
export function isAuthorizedForOrderRoom(viewer: SocketViewer, order: OrderAuthzView | null): boolean {
  if (!order) return false;
  const { userId, role, profileId } = viewer;
  return (
    role === 'admin' ||
    (role === 'customer' && order.customerId === userId) ||
    (role === 'rider'    && order.riderId !== null && order.riderId === profileId) ||
    (role === 'seller'   && order.shop.seller.userId === userId)
  );
}

/**
 * Broadcast an order-scoped event to the order room AND the customer's personal
 * room in a SINGLE emit. Socket.IO performs a union across rooms, so a socket in
 * BOTH (a customer watching their own order) receives the event exactly once —
 * fixing the duplicate-delivery bug — while a socket in only one of the rooms
 * still receives it. See socket.io v4 docs, "Broadcast to multiple rooms".
 */
export function emitToOrderAndUser(
  io: SocketIOServer,
  orderId: string,
  customerId: string,
  event: string,
  body: unknown,
): void {
  io.to(`order:${orderId}`).to(`user:${customerId}`).emit(event, body);
}

// ── rider:location payload validation (audit P0-5) ───────────────────────────

export interface RiderLocationPayload {
  orderId:   string;
  lat:       number;
  lng:       number;
  timestamp: number;
}

/**
 * Validate an untrusted `rider:location` socket payload. Returns the parsed
 * payload or null to drop the event. Bounds lat/lng to real coordinates
 * (lat 0 / lng 0 are valid — the old `!data.lat` check rejected them) and
 * falls back to server time when the client timestamp is missing/garbage.
 */
export function parseRiderLocation(data: unknown): RiderLocationPayload | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  const { orderId, lat, lng } = d;
  if (typeof orderId !== 'string' || orderId.length === 0 || orderId.length > 64) return null;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  const timestamp =
    typeof d['timestamp'] === 'number' && Number.isFinite(d['timestamp'])
      ? (d['timestamp'] as number)
      : Date.now();
  return { orderId, lat, lng, timestamp };
}
