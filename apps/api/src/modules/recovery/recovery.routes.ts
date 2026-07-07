import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { createRecoveryService, type RecoveryActor } from './recovery.service';
import {
  openNeedSchema, transitionNeedSchema, recordOfferSchema, setOfferOutcomeSchema, listNeedsQuerySchema,
} from './recovery.schema';
import { authenticate, requireRole } from '../../shared/middleware/auth.middleware';
import { ValidationError } from '../../shared/errors/app-errors';

// ─── Seller Sprint 5 Phase A — internal recovery API ──────────────────────────
// Thin admin-only surface over the recovery foundation service. There is NO
// seller/customer/rider-facing recovery endpoint in Phase A — the seller intake,
// partner offers, and customer status are later phases (S5.6, S5.9, S5.10). All
// business logic lives in recovery.service; these handlers only parse + delegate.

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) throw new ValidationError(result.error.errors[0]?.message ?? 'Invalid input');
  return result.data;
}

export default async function recoveryRoutes(app: FastifyInstance): Promise<void> {
  const recovery = createRecoveryService(app.prisma);

  // Internal foundation surface — admin only. Ownership of orders/offers by seller
  // partners is enforced in later phases when those actors get their endpoints.
  const adminGuard = { preHandler: [authenticate, requireRole('admin')] };
  const actorOf = (request: FastifyRequest): RecoveryActor => ({
    userId: request.auth!.userId,
    role: request.auth!.role,
  });

  // POST /api/v1/recovery/needs — open a recovery need for a set of missing lines.
  app.post('/needs', adminGuard, async (request, reply) => {
    const input = parse(openNeedSchema, request.body);
    return reply.status(201).send(await recovery.openNeed(input, actorOf(request)));
  });

  // GET /api/v1/recovery/needs?parentOrderId=&state= — list needs (filterable).
  app.get('/needs', adminGuard, async (request, reply) => {
    const query = parse(listNeedsQuerySchema, request.query);
    return reply.send(await recovery.listNeeds(query));
  });

  // GET /api/v1/recovery/needs/:id — one need with its lines, offers, and events.
  app.get('/needs/:id', adminGuard, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    return reply.send(await recovery.getNeed(request.params.id));
  });

  // POST /api/v1/recovery/needs/:id/transition — guarded state-machine transition.
  app.post('/needs/:id/transition', adminGuard, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const input = parse(transitionNeedSchema, request.body);
    return reply.send(await recovery.transitionNeed(request.params.id, input.to, actorOf(request)));
  });

  // POST /api/v1/recovery/needs/:id/offers — dispatch an offer (searching → offered).
  app.post('/needs/:id/offers', adminGuard, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const input = parse(recordOfferSchema, request.body);
    return reply.status(201).send(await recovery.recordOffer(request.params.id, input, actorOf(request)));
  });

  // POST /api/v1/recovery/offers/:id/outcome — resolve the live offer (write-once).
  app.post('/offers/:id/outcome', adminGuard, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const input = parse(setOfferOutcomeSchema, request.body);
    return reply.send(await recovery.setOfferOutcome(request.params.id, input.outcome, actorOf(request)));
  });
}
