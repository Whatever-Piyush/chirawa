import { z } from 'zod';

// ─── Seller Sprint 5 Phase A — internal recovery API schemas ──────────────────
// Zod request schemas for the admin-only internal recovery endpoints. All ids are
// uuid-validated. Note `open` is never an accepted transition target (it is only
// the initial state), and `offered`/`accepted` are reached exclusively through the
// offer endpoints (they carry an offer + deadline), so they are excluded here to
// keep the raw transition endpoint from producing an inconsistent state.

const uuid = z.string().uuid();

export const openNeedSchema = z.object({
  parentOrderId: uuid,
  lines: z
    .array(z.object({ orderItemId: uuid, quantity: z.number().int().min(1) }))
    .min(1),
});

export const transitionNeedSchema = z.object({
  to: z.enum(['searching', 'ready', 'picked_up', 'fulfilled', 'exhausted', 'refunded', 'cancelled']),
});

export const recordOfferSchema = z.object({
  partnerShopId: uuid,
  windowSeconds: z.number().int().min(1).max(3600),
});

export const setOfferOutcomeSchema = z.object({
  outcome: z.enum(['accepted', 'rejected', 'timed_out']),
});

export const listNeedsQuerySchema = z.object({
  parentOrderId: uuid.optional(),
  state: z
    .enum(['open', 'searching', 'offered', 'accepted', 'ready', 'picked_up', 'fulfilled', 'exhausted', 'refunded', 'cancelled'])
    .optional(),
});

export type OpenNeedBody        = z.infer<typeof openNeedSchema>;
export type TransitionNeedBody  = z.infer<typeof transitionNeedSchema>;
export type RecordOfferBody     = z.infer<typeof recordOfferSchema>;
export type SetOfferOutcomeBody = z.infer<typeof setOfferOutcomeSchema>;
export type ListNeedsQuery      = z.infer<typeof listNeedsQuerySchema>;
