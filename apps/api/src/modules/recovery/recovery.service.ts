import { Prisma } from '@prisma/client';
import type { PrismaClient, RecoveryNeedState, RecoveryOfferOutcome } from '@prisma/client';
import { NotFoundError, ConflictError, ValidationError } from '../../shared/errors/app-errors';
import {
  canTransitionNeed,
  OFFER_OUTCOME_TO_NEED_STATE,
  OFFER_OUTCOME_EVENT,
  RecoveryEventType,
} from './recovery.constants';

// ─── Seller Sprint 5 Phase A — recovery orchestration primitives ──────────────
// Durable domain foundation for Recovery Orders: open a need, assign its stable
// recovery number, drive the state machine, record immutable offers, and emit the
// audit event record — each write atomic (Architecture §10–§12, §17, §21).
//
// This is the FOUNDATION, not the orchestrator: no queues, no offer-timeout
// scheduling, no partner selection, no reservations, no settlement, no
// notifications, no order/inventory mutation. Those are later phases (S5.1+).

// Actor performing a recovery action — stamped on every audit event (§17). Null
// for system-initiated events (e.g. a future timeout sweep).
export interface RecoveryActor {
  userId: string | null;
  role: string | null;
}

export interface OpenNeedInput {
  parentOrderId: string;
  lines: Array<{ orderItemId: string; quantity: number }>;
}

export interface RecordOfferInput {
  partnerShopId: string;
  windowSeconds: number;
}

// Retry budget for the (parentOrderId, sequence) numbering race (Architecture §11).
const MAX_SEQUENCE_RETRIES = 5;

export function createRecoveryService(prisma: PrismaClient) {
  // Human display base for a parent order's recovery numbers. The platform has no
  // human order number today (orders are UUID-only), so Phase A uses the parent
  // order id's short prefix as a provisional base — the recovery SUFFIX is the
  // authoritative, spec-mandated part (Architecture §11). Swap this one function
  // for the real order number when an order-numbering scheme exists.
  const displayBase = (orderId: string): string => orderId.slice(0, 8);

  // Open a recovery need for a set of missing lines (Architecture §11–§12). Assigns
  // the next 1-based recovery suffix for the parent order — race-safe via the
  // (parentOrderId, sequence) unique index + P2002 re-count/retry — records the
  // claimed lines, and emits one line_claimed event per line plus need_opened.
  // Starts in `open`. Does NOT mutate the order or its items (that is S5.6 intake).
  async function openNeed(input: OpenNeedInput, actor: RecoveryActor) {
    if (input.lines.length === 0) {
      throw new ValidationError('A recovery need must claim at least one line');
    }

    for (let attempt = 0; ; attempt++) {
      // Read the current suffix outside the txn; the unique index is the real guard.
      const prior = await prisma.recoveryNeed.count({ where: { parentOrderId: input.parentOrderId } });
      const sequence = prior + 1;
      const number = `${displayBase(input.parentOrderId)}-${sequence}`;
      try {
        return await prisma.$transaction(async (tx) => {
          const need = await tx.recoveryNeed.create({
            data: {
              parentOrderId: input.parentOrderId,
              sequence,
              number,
              lines: { create: input.lines.map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity })) },
            },
            include: { lines: true },
          });
          for (const line of need.lines) {
            await tx.recoveryEvent.create({
              data: {
                needId: need.id,
                type: RecoveryEventType.LineClaimed,
                actorId: actor.userId,
                actorRole: actor.role,
                metadata: { orderItemId: line.orderItemId, quantity: line.quantity },
              },
            });
          }
          await tx.recoveryEvent.create({
            data: {
              needId: need.id,
              type: RecoveryEventType.NeedOpened,
              actorId: actor.userId,
              actorRole: actor.role,
              metadata: { number, sequence, lineCount: need.lines.length },
            },
          });
          return need;
        });
      } catch (err) {
        // Lost the numbering race — a concurrent need took this suffix. Re-count
        // and retry; any other error (or an exhausted budget) propagates.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          attempt < MAX_SEQUENCE_RETRIES
        ) {
          continue;
        }
        throw err;
      }
    }
  }

  // Guarded Need state transition (Architecture §12). Throws 409 on an illegal
  // transition; emits state_changed. Offer-driven states (offered/accepted/searching
  // on outcome) go through recordOffer / setOfferOutcome; this handles the operator-
  // or orchestrator-driven ones (searching, exhausted, refunded, ready, picked_up,
  // fulfilled, cancelled).
  async function transitionNeed(needId: string, to: RecoveryNeedState, actor: RecoveryActor) {
    return prisma.$transaction(async (tx) => {
      const need = await tx.recoveryNeed.findUnique({ where: { id: needId } });
      if (!need) throw new NotFoundError('Recovery need');
      if (!canTransitionNeed(need.state, to)) {
        throw new ConflictError(`Illegal recovery transition ${need.state} → ${to}`);
      }
      const updated = await tx.recoveryNeed.update({ where: { id: needId }, data: { state: to } });
      await tx.recoveryEvent.create({
        data: {
          needId,
          type: RecoveryEventType.StateChanged,
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { from: need.state, to },
        },
      });
      return updated;
    });
  }

  // Dispatch a recovery offer to a partner (Architecture §12: Searching → Offered).
  // Requires the need in `searching`, creates a pending offer with a TTL window,
  // sets the need deadline, transitions the need to `offered`, and emits offer_sent
  // + state_changed. The partial unique index guarantees at most one live offer per
  // need; a concurrent second offer surfaces as a 409 (strictly-sequential dispatch).
  async function recordOffer(needId: string, input: RecordOfferInput, actor: RecoveryActor) {
    if (input.windowSeconds <= 0) throw new ValidationError('Offer window must be positive');
    return prisma.$transaction(async (tx) => {
      const need = await tx.recoveryNeed.findUnique({ where: { id: needId } });
      if (!need) throw new NotFoundError('Recovery need');
      if (need.state !== 'searching') {
        throw new ConflictError(`Cannot make an offer from state ${need.state}`);
      }
      const now = new Date();
      const expiresAt = new Date(now.getTime() + input.windowSeconds * 1000);

      const offer = await tx.recoveryOffer
        .create({ data: { needId, partnerShopId: input.partnerShopId, offeredAt: now, expiresAt } })
        .catch((err: unknown): never => {
          // A live offer already exists for this need — the one-pending-per-need
          // partial unique index rejected the insert. Sequential dispatch violated.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new ConflictError('An offer is already outstanding for this need');
          }
          throw err;
        });

      await tx.recoveryNeed.update({ where: { id: needId }, data: { state: 'offered', deadlineAt: expiresAt } });
      await tx.recoveryEvent.create({
        data: {
          needId, offerId: offer.id, type: RecoveryEventType.OfferSent,
          actorId: actor.userId, actorRole: actor.role,
          metadata: { partnerShopId: input.partnerShopId, expiresAt },
        },
      });
      await tx.recoveryEvent.create({
        data: {
          needId, offerId: offer.id, type: RecoveryEventType.StateChanged,
          actorId: actor.userId, actorRole: actor.role,
          metadata: { from: need.state, to: 'offered' },
        },
      });
      return offer;
    });
  }

  // Resolve the live offer (Architecture §12). Write-once outcome (pending →
  // accepted | rejected | timed_out) — a second resolution throws 409, so a lost
  // timeout can never override an acceptance (single-winner). Drives the coupled
  // need transition (accepted → accepted; rejected/timed_out → searching), clears
  // the need deadline, and emits the offer_* + state_changed events.
  async function setOfferOutcome(
    offerId: string,
    outcome: Exclude<RecoveryOfferOutcome, 'pending'>,
    actor: RecoveryActor,
  ) {
    return prisma.$transaction(async (tx) => {
      const offer = await tx.recoveryOffer.findUnique({ where: { id: offerId } });
      if (!offer) throw new NotFoundError('Recovery offer');
      if (offer.outcome !== 'pending') throw new ConflictError(`Offer already ${offer.outcome}`);

      const need = await tx.recoveryNeed.findUnique({ where: { id: offer.needId } });
      if (!need) throw new NotFoundError('Recovery need');

      const nextState = OFFER_OUTCOME_TO_NEED_STATE[outcome];
      if (!canTransitionNeed(need.state, nextState)) {
        throw new ConflictError(`Illegal recovery transition ${need.state} → ${nextState}`);
      }

      const now = new Date();
      const updatedOffer = await tx.recoveryOffer.update({
        where: { id: offerId },
        data: { outcome, decidedAt: now },
      });
      await tx.recoveryNeed.update({ where: { id: offer.needId }, data: { state: nextState, deadlineAt: null } });
      await tx.recoveryEvent.create({
        data: {
          needId: offer.needId, offerId, type: OFFER_OUTCOME_EVENT[outcome],
          actorId: actor.userId, actorRole: actor.role,
          metadata: { partnerShopId: offer.partnerShopId },
        },
      });
      await tx.recoveryEvent.create({
        data: {
          needId: offer.needId, offerId, type: RecoveryEventType.StateChanged,
          actorId: actor.userId, actorRole: actor.role,
          metadata: { from: need.state, to: nextState },
        },
      });
      return updatedOffer;
    });
  }

  async function getNeed(needId: string) {
    const need = await prisma.recoveryNeed.findUnique({
      where: { id: needId },
      include: {
        lines: true,
        offers: { orderBy: { offeredAt: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!need) throw new NotFoundError('Recovery need');
    return need;
  }

  // `| undefined` on the optional filters keeps zod's .optional() output
  // assignable under exactOptionalPropertyTypes (the body already guards).
  async function listNeeds(filter: { parentOrderId?: string | undefined; state?: RecoveryNeedState | undefined }) {
    // Build the where clause conditionally — exactOptionalPropertyTypes forbids
    // passing an explicit `undefined` to Prisma's optional filter fields.
    const where: Prisma.RecoveryNeedWhereInput = {};
    if (filter.parentOrderId !== undefined) where.parentOrderId = filter.parentOrderId;
    if (filter.state !== undefined) where.state = filter.state;
    return prisma.recoveryNeed.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { lines: true, offers: true },
    });
  }

  // Partners already asked for a need — derived from its offers (single source of
  // truth), so the planner (S5.4) never re-asks a partner (Architecture §14).
  async function askedPartnerShopIds(needId: string): Promise<string[]> {
    const offers = await prisma.recoveryOffer.findMany({ where: { needId }, select: { partnerShopId: true } });
    return [...new Set(offers.map((o) => o.partnerShopId))];
  }

  return { openNeed, transitionNeed, recordOffer, setOfferOutcome, getNeed, listNeeds, askedPartnerShopIds };
}
