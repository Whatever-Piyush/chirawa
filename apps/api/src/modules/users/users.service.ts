import type { PrismaClient } from '@prisma/client';
import type { UpdateProfileInput, CreateAddressInput, UpdateAddressInput } from './users.schema';
import { NotFoundError, ForbiddenError } from '../../shared/errors/app-errors';

export function createUsersService(prisma: PrismaClient) {

  // ── Get current user profile ───────────────────────────────────────────────
  async function getMe(userId: string, role: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        customerProfile: role === 'customer' ? { select: { id: true, firstName: true, lastName: true, walletBalance: true, loyaltyTier: true, totalOrders: true } } : false,
        sellerProfile:   role === 'seller'   ? { select: { id: true, ownerName: true, upiId: true, gstin: true } } : false,
        riderProfile:    role === 'rider'    ? { select: { id: true, fullName: true, vehicleNumber: true, codBalancePaise: true } } : false,
        referralCode:    { select: { code: true } },
      },
    });

    if (!user) throw new NotFoundError('User');

    return {
      id:           user.id,
      phone:        user.phone,
      role:         user.role,
      referralCode: user.referralCode?.code ?? null,
      profile:      user.customerProfile ?? user.sellerProfile ?? user.riderProfile ?? null,
      createdAt:    user.createdAt,
    };
  }

  // ── Update profile ─────────────────────────────────────────────────────────
  async function updateProfile(
    userId: string,
    role: string,
    data: UpdateProfileInput,
  ) {
    if (role === 'customer') {
      await prisma.customerProfile.update({
        where: { userId },
        data: {
          ...(data.firstName !== undefined && { firstName: data.firstName }),
          ...(data.lastName  !== undefined && { lastName:  data.lastName  }),
        },
      });
    }
    // Seller/rider profile updates handled in their own modules (Step 12/13)
    return getMe(userId, role);
  }

  // ── List addresses ─────────────────────────────────────────────────────────
  async function getAddresses(userId: string) {
    return prisma.address.findMany({
      where:   { userId, isDeleted: false },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, label: true, street: true, landmark: true,
        locality: true, city: true, pincode: true,
        lat: true, lng: true, isDefault: true, createdAt: true,
      },
    });
  }

  // ── Create address ─────────────────────────────────────────────────────────
  async function createAddress(userId: string, data: CreateAddressInput) {
    // One default address at a time
    if (data.isDefault) {
      await prisma.address.updateMany({
        where: { userId, isDefault: true },
        data:  { isDefault: false },
      });
    }

    // First address is always default
    const count = await prisma.address.count({ where: { userId, isDeleted: false } });

    return prisma.address.create({
      data: {
        userId,
        label:     data.label,
        street:    data.street,
        landmark:  data.landmark,
        locality:  data.locality,
        city:      data.city,
        pincode:   data.pincode,
        lat:       data.lat,
        lng:       data.lng,
        isDefault: data.isDefault || count === 0,
      },
    });
  }

  // ── Update address ─────────────────────────────────────────────────────────
  async function updateAddress(
    userId: string,
    addressId: string,
    data: UpdateAddressInput,
  ) {
    const address = await prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.isDeleted) throw new NotFoundError('Address');
    if (address.userId !== userId) throw new ForbiddenError('Not your address');

    if (data.isDefault) {
      await prisma.address.updateMany({
        where: { userId, isDefault: true },
        data:  { isDefault: false },
      });
    }

    return prisma.address.update({
      where: { id: addressId },
      data,
    });
  }

  // ── Delete address (soft) ──────────────────────────────────────────────────
  async function deleteAddress(userId: string, addressId: string) {
    const address = await prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.isDeleted) throw new NotFoundError('Address');
    if (address.userId !== userId) throw new ForbiddenError('Not your address');

    await prisma.address.update({
      where: { id: addressId },
      data:  { isDeleted: true, isDefault: false },
    });

    // If deleted address was default, make the newest one default
    if (address.isDefault) {
      const next = await prisma.address.findFirst({
        where:   { userId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
      });
      if (next) {
        await prisma.address.update({
          where: { id: next.id },
          data:  { isDefault: true },
        });
      }
    }
  }

  // ── Set default address ────────────────────────────────────────────────────
  async function setDefaultAddress(userId: string, addressId: string) {
    const address = await prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.isDeleted) throw new NotFoundError('Address');
    if (address.userId !== userId) throw new ForbiddenError('Not your address');

    await prisma.address.updateMany({
      where: { userId, isDefault: true },
      data:  { isDefault: false },
    });

    await prisma.address.update({
      where: { id: addressId },
      data:  { isDefault: true },
    });
  }

  return {
    getMe, updateProfile,
    getAddresses, createAddress, updateAddress,
    deleteAddress, setDefaultAddress,
  };
}
