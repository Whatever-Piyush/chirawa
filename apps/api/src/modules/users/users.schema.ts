import { z } from 'zod';

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName:  z.string().trim().min(1).max(100).optional(),
});

export const createAddressSchema = z.object({
  label:    z.string().trim().max(50).optional(),
  street:   z.string().trim().min(1).max(255),
  landmark: z.string().trim().min(1).max(255),
  locality: z.string().trim().min(1).max(100),
  city:     z.string().trim().max(100).default('Chirawa'),
  pincode:  z.string().trim().regex(/^\d{6}$/, '6-digit pincode required'),
  lat:      z.number().min(-90).max(90),
  lng:      z.number().min(-180).max(180),
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
