// Feature flags for the customer app.
//
// v1 launch: referral, loyalty and wallet are HIDDEN — the business can't fund
// rewards yet (Phase 1.9 "hide, don't wire"). NOTE (Hardening Phase 3, P2-8):
// the backend's dead referral-unlock scaffolding (worker queue + processor +
// no-op enqueue stub) was REMOVED — signup still generates codes and records
// redemptions, so rewards can be honored retroactively. Flipping this flag is
// NOT enough to re-launch referral: rebuild the unlock worker (git history:
// apps/api/src/worker/jobs/referral.job.ts) and wire it on 'delivered' first.
export const FEATURES = {
  growthLoops: false,
  // v1 launch: present Chirawa as ONE unified storefront, not a marketplace of
  // separate stores. Hides the per-shop "store page" entry points (e.g. the
  // "Sold by → Explore shop" row on product detail) so users browse the whole
  // catalog in one place. Flip to true once multiple distinct shops go live.
  shopBrowsing: false,
} as const;
