import { z } from 'zod';

export const updateProfileSchema = z.object({
  // Customer
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName:  z.string().trim().min(1).max(100).optional(),
  // Seller payout/onboarding details (Phase 1.10) — UPI must be valid so
  // settlements (0.3) can actually pay out.
  ownerName:   z.string().trim().min(1).max(100).optional(),
  upiId:       z.string().trim().regex(/^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/, 'Enter a valid UPI ID (e.g. name@bank)').optional(),
  bankAccount: z.string().trim().regex(/^\d{9,18}$/, 'Enter a valid bank account number').optional(),
  bankIfsc:    z.string().trim().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC code').optional(),
  gstin:       z.string().trim().max(15).optional(),
  // Rider onboarding (Phase 1.10)
  vehicleNumber: z.string().trim().min(1).max(20).optional(),
});

export const createAddressSchema = z.object({
  label:    z.string().trim().max(50).optional(),
  street:   z.string().trim().min(1).max(255),
  landmark: z.string().trim().min(1).max(255),
  locality: z.string().trim().min(1).max(100),
  city:     z.string().trim().max(100).default('Chirawa'),
  pincode:  z.string().trim().regex(/^\d{6}$/, '6-digit pincode required'),
  // Coerce: addresses round-tripped from the API arrive with lat/lng as strings
  // (Prisma serializes Decimal columns to strings), so the edit flow re-sends
  // them as strings. Coercion accepts number or numeric-string, then range-checks.
  lat:      z.coerce.number().min(-90).max(90),
  lng:      z.coerce.number().min(-180).max(180),
  // Receiver / contact details (Address redesign v2)
  contactType:   z.enum(['myself', 'other']).default('myself'),
  receiverName:  z.string().trim().max(100).optional(),
  receiverPhone: z.string().trim().max(20).optional(),
  mapsLink:      z.string().trim().max(2048).optional(),
  isDefault: z.boolean().default(false),
});

export const updateAddressSchema = createAddressSchema.partial();

export type UpdateProfileInput  = z.infer<typeof updateProfileSchema>;
export type CreateAddressInput  = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput  = z.infer<typeof updateAddressSchema>;
