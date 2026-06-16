import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { reverseGeocodeSchema, autocompleteSchema, placeDetailsSchema } from './geo.schema';
import { reverseGeocode, autocompletePlaces, placeDetails } from './geo.service';
import { ValidationError } from '../../shared/errors/app-errors';

export default async function geoRoutes(app: FastifyInstance): Promise<void> {

  // POST /api/v1/geo/reverse — coordinates → cleaned address. Auth-gated so it
  // can't be used as an open geocoding relay; the Google key stays server-side.
  // `request.body` is parsed via zod (unknown in → validated out).
  app.post(
    '/reverse',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const parsed = reverseGeocodeSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid coordinates');
      }
      const result = await reverseGeocode(parsed.data);
      return reply.send(result);
    },
  );

  // POST /api/v1/geo/autocomplete — place search, hard-restricted to Chirawa.
  // Auth-gated + key server-side (same secure-proxy pattern as /reverse).
  app.post(
    '/autocomplete',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const parsed = autocompleteSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid query');
      }
      const result = await autocompletePlaces(parsed.data);
      return reply.send(result);
    },
  );

  // POST /api/v1/geo/place — resolve a chosen prediction → coords + clean address.
  app.post(
    '/place',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const parsed = placeDetailsSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid place');
      }
      const result = await placeDetails(parsed.data);
      return reply.send(result);
    },
  );
}
