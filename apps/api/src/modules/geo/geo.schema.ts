import { z } from 'zod';

// Reverse-geocode request — a single coordinate to resolve. Bounds are the valid
// lat/lng ranges; the handler doesn't restrict to Chirawa (the device may be just
// outside while the user pans), the address form is the gate.
export const reverseGeocodeSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export type ReverseGeocodeInput = z.infer<typeof reverseGeocodeSchema>;

// Place Autocomplete — a query + per-session token (Google billing grouping).
export const autocompleteSchema = z.object({
  q:            z.string().trim().min(1).max(120),
  sessionToken: z.string().trim().min(1).max(120),
});
export type AutocompleteInput = z.infer<typeof autocompleteSchema>;

// Place Details — resolve a chosen prediction to coordinates + a clean address.
export const placeDetailsSchema = z.object({
  placeId:      z.string().trim().min(1).max(400),
  sessionToken: z.string().trim().min(1).max(120),
});
export type PlaceDetailsInput = z.infer<typeof placeDetailsSchema>;
