import { z } from 'zod';

// Reverse-geocode request — a single coordinate to resolve. Bounds are the valid
// lat/lng ranges; the handler doesn't restrict to Chirawa (the device may be just
// outside while the user pans), the address form is the gate.
export const reverseGeocodeSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export type ReverseGeocodeInput = z.infer<typeof reverseGeocodeSchema>;
