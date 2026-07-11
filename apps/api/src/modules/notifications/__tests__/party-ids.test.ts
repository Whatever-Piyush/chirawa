import { describe, it, expect, vi } from 'vitest';
import { resolveOrderPartyUserIds } from '../party-ids';

// P1-3 regression tests: FCM tokens + socket rooms are keyed by User.id, but
// Order.riderId stores RiderProfile.id and the seller is reachable only via
// shop → SellerProfile. The resolver must always come back with USER ids.

function makePrisma(opts: {
  order?: { riderId: string | null; shop: { seller: { userId: string } } } | null;
  riderProfile?: { userId: string } | null;
}) {
  const orderFindUnique = vi.fn().mockResolvedValue(opts.order ?? null);
  const riderFindUnique = vi.fn().mockResolvedValue(opts.riderProfile ?? null);
  return {
    prisma: {
      order:        { findUnique: orderFindUnique },
      riderProfile: { findUnique: riderFindUnique },
    },
    orderFindUnique,
    riderFindUnique,
  };
}

describe('resolveOrderPartyUserIds (P1-3)', () => {
  it('translates Order.riderId (RiderProfile.id) into the rider User.id', async () => {
    const p = makePrisma({
      order:        { riderId: 'rider-profile-1', shop: { seller: { userId: 'seller-user-1' } } },
      riderProfile: { userId: 'rider-user-1' },
    });

    const ids = await resolveOrderPartyUserIds(p.prisma as never, 'order-1');

    // The old bug: consumers received 'rider-profile-1' and the token lookup
    // fcm:token:rider-profile-1 silently missed. Must be the USER id.
    expect(ids).toEqual({ sellerUserId: 'seller-user-1', riderUserId: 'rider-user-1' });
    expect(p.riderFindUnique).toHaveBeenCalledWith({
      where:  { id: 'rider-profile-1' },
      select: { userId: true },
    });
  });

  it('resolves the seller User.id even when no rider is assigned (the old sellerId was "")', async () => {
    const p = makePrisma({
      order: { riderId: null, shop: { seller: { userId: 'seller-user-1' } } },
    });

    const ids = await resolveOrderPartyUserIds(p.prisma as never, 'order-1');

    expect(ids).toEqual({ sellerUserId: 'seller-user-1', riderUserId: null });
    expect(p.riderFindUnique).not.toHaveBeenCalled(); // no pointless lookup
  });

  it('returns nulls for a missing order instead of throwing (notifications are best-effort)', async () => {
    const p = makePrisma({ order: null });
    const ids = await resolveOrderPartyUserIds(p.prisma as never, 'gone');
    expect(ids).toEqual({ sellerUserId: null, riderUserId: null });
  });

  it('returns null riderUserId for a dangling rider profile id (no FK on Order.riderId)', async () => {
    const p = makePrisma({
      order:        { riderId: 'rider-profile-gone', shop: { seller: { userId: 'seller-user-1' } } },
      riderProfile: null,
    });
    const ids = await resolveOrderPartyUserIds(p.prisma as never, 'order-1');
    expect(ids).toEqual({ sellerUserId: 'seller-user-1', riderUserId: null });
  });
});
