import { describe, it, expect, vi } from 'vitest';
import { isAuthorizedForOrderRoom, emitToOrderAndUser, type OrderAuthzView } from '../realtime.helpers';

// Distinct ids so a profile-vs-user mixup (the rider IDOR class) is observable.
const CUST_USER     = 'cust_user_1';
const SELLER_USER   = 'seller_user_1';
const RIDER_USER    = 'rider_user_1';
const RIDER_PROFILE = 'rider_profile_1';   // Order.riderId stores this

const order: OrderAuthzView = {
  customerId: CUST_USER,
  riderId:    RIDER_PROFILE,
  shop:       { seller: { userId: SELLER_USER } },
};

describe('isAuthorizedForOrderRoom — order:subscribe IDOR guard', () => {
  // ── Allowed ────────────────────────────────────────────────────────────────
  it('allows the order customer', () => {
    expect(isAuthorizedForOrderRoom({ userId: CUST_USER, role: 'customer', profileId: 'cp' }, order)).toBe(true);
  });

  it('allows the owning seller', () => {
    expect(isAuthorizedForOrderRoom({ userId: SELLER_USER, role: 'seller', profileId: 'sp' }, order)).toBe(true);
  });

  it('allows the assigned rider (profileId === Order.riderId)', () => {
    expect(isAuthorizedForOrderRoom({ userId: RIDER_USER, role: 'rider', profileId: RIDER_PROFILE }, order)).toBe(true);
  });

  it('allows any admin', () => {
    expect(isAuthorizedForOrderRoom({ userId: 'someone_else', role: 'admin', profileId: 'ap' }, order)).toBe(true);
  });

  // ── Denied (the IDOR cases) ──────────────────────────────────────────────────
  it('DENIES a different customer (core IDOR)', () => {
    expect(isAuthorizedForOrderRoom({ userId: 'cust_user_2', role: 'customer', profileId: 'cp2' }, order)).toBe(false);
  });

  it('DENIES a different seller', () => {
    expect(isAuthorizedForOrderRoom({ userId: 'seller_user_2', role: 'seller', profileId: 'sp2' }, order)).toBe(false);
  });

  it('DENIES a different / unassigned rider', () => {
    expect(isAuthorizedForOrderRoom({ userId: 'rider_user_2', role: 'rider', profileId: 'rider_profile_2' }, order)).toBe(false);
  });

  it('DENIES the assigned rider when handed their User.id instead of RiderProfile.id (BUG-1 class)', () => {
    expect(isAuthorizedForOrderRoom({ userId: RIDER_USER, role: 'rider', profileId: RIDER_USER }, order)).toBe(false);
  });

  it('DENIES a rider on an unassigned order (riderId null, even if profileId is empty)', () => {
    expect(isAuthorizedForOrderRoom({ userId: RIDER_USER, role: 'rider', profileId: '' }, { ...order, riderId: null })).toBe(false);
  });

  it('DENIES an unknown role', () => {
    expect(isAuthorizedForOrderRoom({ userId: CUST_USER, role: 'guest', profileId: 'x' }, order)).toBe(false);
  });

  // ── Fail-closed ──────────────────────────────────────────────────────────────
  it('DENIES when the order does not exist (null) — even for the right customer', () => {
    expect(isAuthorizedForOrderRoom({ userId: CUST_USER, role: 'customer', profileId: 'cp' }, null)).toBe(false);
  });
});

describe('emitToOrderAndUser — single union emit (duplicate-emission fix)', () => {
  function mockIo() {
    const emit = vi.fn();
    const chain = { to: vi.fn((): typeof chain => chain), emit };
    const io = { to: vi.fn((): typeof chain => chain) };
    return { io, chain, emit };
  }

  it('emits EXACTLY ONCE targeting both the order room and the user room', () => {
    const { io, chain, emit } = mockIo();
    const body = { orderId: 'o1', status: 'preparing', timestamp: 't' };

    emitToOrderAndUser(io as never, 'o1', 'c1', 'order:status', body);

    // one union emit (not two separate emits → no duplicate for a both-rooms socket)
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('order:status', body);
    // both rooms targeted in the single chain: io.to('order:o1').to('user:c1').emit(...)
    expect(io.to).toHaveBeenCalledWith('order:o1');
    expect(chain.to).toHaveBeenCalledWith('user:c1');
  });

  it('uses the same single-emit shape for order:eta', () => {
    const { io, emit } = mockIo();
    emitToOrderAndUser(io as never, 'o2', 'c2', 'order:eta', { secondsRemaining: 300 });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('order:eta', { secondsRemaining: 300 });
  });
});
