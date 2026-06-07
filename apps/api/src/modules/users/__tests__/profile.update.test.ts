import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUsersService } from '../users.service';
import { updateProfileSchema } from '../users.schema';

function makePrisma() {
  const sellerUpdate = vi.fn().mockResolvedValue({});
  const riderUpdate  = vi.fn().mockResolvedValue({});
  const customerUpdate = vi.fn().mockResolvedValue({});
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', phone: '9', role: 'seller', referralCode: null, sellerProfile: {} }) },
    sellerProfile:   { update: sellerUpdate },
    riderProfile:    { update: riderUpdate },
    customerProfile: { update: customerUpdate },
  };
  return { prisma, sellerUpdate, riderUpdate };
}

const svc = (p: ReturnType<typeof makePrisma>) => createUsersService(p.prisma as never);

describe('updateProfile — seller/rider details (Phase 1.10)', () => {
  let p: ReturnType<typeof makePrisma>;
  beforeEach(() => { p = makePrisma(); });

  it('updates only the seller fields that were provided', async () => {
    await svc(p).updateProfile('u1', 'seller', { upiId: 'shop@okhdfc', bankIfsc: 'HDFC0001234' });
    expect(p.sellerUpdate).toHaveBeenCalledWith({
      where: { userId: 'u1' }, data: { upiId: 'shop@okhdfc', bankIfsc: 'HDFC0001234' },
    });
  });

  it('updates the rider vehicle number', async () => {
    await svc(p).updateProfile('u1', 'rider', { vehicleNumber: 'RJ18 AB 1234' });
    expect(p.riderUpdate).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { vehicleNumber: 'RJ18 AB 1234' } });
  });

  it('does not write when a seller sends no seller fields', async () => {
    await svc(p).updateProfile('u1', 'seller', {});
    expect(p.sellerUpdate).not.toHaveBeenCalled();
  });
});

describe('updateProfileSchema validation (Phase 1.10)', () => {
  it('accepts a valid UPI id and IFSC', () => {
    expect(updateProfileSchema.safeParse({ upiId: 'name@okaxis', bankIfsc: 'SBIN0000123' }).success).toBe(true);
  });
  it('rejects a malformed UPI id', () => {
    expect(updateProfileSchema.safeParse({ upiId: 'not-a-upi' }).success).toBe(false);
  });
  it('rejects a malformed IFSC', () => {
    expect(updateProfileSchema.safeParse({ bankIfsc: 'BADIFSC' }).success).toBe(false);
  });
  it('rejects a non-numeric bank account', () => {
    expect(updateProfileSchema.safeParse({ bankAccount: '12ab' }).success).toBe(false);
  });
});
