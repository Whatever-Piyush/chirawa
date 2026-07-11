import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { previewPromo, validatePromo, FIRST_ORDER_CODE } from '../promotions.service';

// ─── previewPromo — preview must mirror order creation (A3 parity fix) ────────
// Order creation (orders.service.placeOrder) applies a promo at the whole-cart
// subtotal for ANY shop count: typed code → validatePromo (hard), no code →
// resolveAutoPromo. previewPromo is the preview-side twin: same inputs, same
// discounts, with typed-code failures soft-wrapped into promoError so the bill
// still renders. These tests pin that behavioral parity.

const CTX = { userId: 'cust_1', cartSubtotalPaise: 25000, deliveryFeePaise: 1000 };

type PromoRow = {
  id: string; code: string; type: string; valuePaise: number; minCartPaise: number;
  maxUsesTotal: number | null; maxUsesPerUser: number; currentUses: number;
  isActive: boolean; expiresAt: Date | null;
};

const promoRow = (over: Partial<PromoRow> = {}): PromoRow => ({
  id: 'promo_1', code: 'SAVE30', type: 'flat', valuePaise: 3000, minCartPaise: 0,
  maxUsesTotal: null, maxUsesPerUser: 1, currentUses: 0, isActive: true, expiresAt: null,
  ...over,
});

// Prisma double: promoCode.findUnique keyed by code, redemption/order counts fixed.
function makePrisma(opts: {
  promos?: PromoRow[];
  redemptions?: number;
  priorOrders?: number;
} = {}): PrismaClient {
  const promos = opts.promos ?? [];
  return {
    promoCode: {
      findUnique: vi.fn(({ where }: { where: { code: string } }) =>
        Promise.resolve(promos.find((p) => p.code === where.code) ?? null)),
    },
    promoRedemption: {
      count: vi.fn(() => Promise.resolve(opts.redemptions ?? 0)),
    },
    order: {
      count: vi.fn(() => Promise.resolve(opts.priorOrders ?? 0)),
    },
  } as unknown as PrismaClient;
}

describe('previewPromo — typed code', () => {
  it('returns the exact discount validatePromo (creation path) computes', async () => {
    const prisma = makePrisma({ promos: [promoRow()], priorOrders: 3 });
    const preview = await previewPromo(prisma, { promoCode: 'SAVE30', ...CTX });
    const creation = await validatePromo(prisma, { code: 'SAVE30', ...CTX });

    expect(preview.discount).toBe(creation.discountPaise);
    expect(preview.appliedPromoCode).toBe(creation.code);
    expect(preview.promoError).toBeNull();
  });

  it('soft-fails an invalid code into promoError (bill still renders)', async () => {
    const prisma = makePrisma({ promos: [] });
    const preview = await previewPromo(prisma, { promoCode: 'NOPE', ...CTX });

    expect(preview.discount).toBe(0);
    expect(preview.appliedPromoCode).toBeNull();
    expect(preview.promoError).toMatch(/valid nahi/);
  });

  it('soft-fails min-cart shortfall with the amount in the message', async () => {
    const prisma = makePrisma({ promos: [promoRow({ minCartPaise: 50000 })] });
    const preview = await previewPromo(prisma, { promoCode: 'SAVE30', ...CTX });

    expect(preview.discount).toBe(0);
    expect(preview.promoError).toContain('₹500');
  });

  it('soft-fails an expired code', async () => {
    const prisma = makePrisma({
      promos: [promoRow({ expiresAt: new Date(Date.now() - 1000) })],
    });
    const preview = await previewPromo(prisma, { promoCode: 'SAVE30', ...CTX });

    expect(preview.discount).toBe(0);
    expect(preview.promoError).toMatch(/expire/);
  });

  it('soft-fails a code the user already redeemed', async () => {
    const prisma = makePrisma({ promos: [promoRow()], redemptions: 1 });
    const preview = await previewPromo(prisma, { promoCode: 'SAVE30', ...CTX });

    expect(preview.discount).toBe(0);
    expect(preview.promoError).toMatch(/use kar chuke/);
  });
});

describe('previewPromo — auto FIRSTORDER (no code typed)', () => {
  const firstOrderPromo = promoRow({
    id: 'promo_first', code: FIRST_ORDER_CODE, type: 'free_delivery', valuePaise: 0,
  });

  it('auto-applies free delivery for a first-time customer', async () => {
    const prisma = makePrisma({ promos: [firstOrderPromo], priorOrders: 0 });
    const preview = await previewPromo(prisma, CTX);

    expect(preview.appliedPromoCode).toBe(FIRST_ORDER_CODE);
    expect(preview.discount).toBe(CTX.deliveryFeePaise);
    expect(preview.promoError).toBeNull();
  });

  it('does not auto-apply for a returning customer', async () => {
    const prisma = makePrisma({ promos: [firstOrderPromo], priorOrders: 2 });
    const preview = await previewPromo(prisma, CTX);

    expect(preview.appliedPromoCode).toBeNull();
    expect(preview.discount).toBe(0);
    expect(preview.promoError).toBeNull();
  });

  it('never blocks checkout when the promo row is missing', async () => {
    const prisma = makePrisma({ promos: [], priorOrders: 0 });
    const preview = await previewPromo(prisma, CTX);

    expect(preview).toEqual({ discount: 0, appliedPromoCode: null, promoError: null });
  });
});

describe('previewPromo — shop-count independence (the old preview bug)', () => {
  it('takes no shop-count input: a cart spanning shops still gets the discount', async () => {
    // The old preview route gated promos behind shopIds.length === 1 while
    // creation applied them for any cart. previewPromo has no shop-count
    // parameter at all — parity by construction; this test documents it.
    const prisma = makePrisma({ promos: [promoRow()], priorOrders: 1 });
    const multiShopSubtotal = { ...CTX, cartSubtotalPaise: 40000 }; // 2 shops' items
    const preview = await previewPromo(prisma, { promoCode: 'SAVE30', ...multiShopSubtotal });

    expect(preview.discount).toBe(3000);
    expect(preview.appliedPromoCode).toBe('SAVE30');
  });
});
