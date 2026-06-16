import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { reverseGeocodeSchema } from './geo.schema';
import { reverseGeocode } from './geo.service';
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
}
