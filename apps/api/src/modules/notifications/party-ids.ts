import type { PrismaClient } from '@prisma/client';

// P1-3 fix — the ONE place seller/rider notification identities come from.
//
// FCM tokens (fcm:token:{userId}) and socket rooms (seller:{userId} /
// rider:{userId}) are keyed by **User.id**, but the order row stores
// Order.riderId = RiderProfile.id and knows the seller only via
// shop → SellerProfile. Before this fix, emit sites were trusted to bridge
// that gap themselves and half of them passed '' or a profile id — so rider
// cancellation pushes and seller cancel/delivered pushes silently vanished.
//
// Consumers now resolve party User.ids from the order id at consumption time.
// Emit sites cannot get this wrong anymore: the status-changed payload no
// longer carries seller/rider ids at all.

export interface OrderPartyUserIds {
  sellerUserId: string | null;
  riderUserId:  string | null;
}

export async function resolveOrderPartyUserIds(
  prisma: PrismaClient,
  orderId: string,
): Promise<OrderPartyUserIds> {
  const order = await prisma.order.findUnique({
    where:  { id: orderId },
    select: {
      riderId: true, // RiderProfile.id — translated below, never returned as-is
      shop: { select: { seller: { select: { userId: true } } } },
    },
  });
  if (!order) return { sellerUserId: null, riderUserId: null };

  let riderUserId: string | null = null;
  if (order.riderId) {
    const rider = await prisma.riderProfile.findUnique({
      where:  { id: order.riderId },
      select: { userId: true },
    });
    riderUserId = rider?.userId ?? null;
  }

  return { sellerUserId: order.shop.seller.userId, riderUserId };
}
