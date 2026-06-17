// Feature flags for the customer app.
//
// v1 launch: referral, loyalty and wallet are HIDDEN — the business can't fund
// rewards yet (Phase 1.9 "hide, don't wire"). Flip `growthLoops` to true to
// re-enable the UI post-launch once those flows are funded + tested.
export const FEATURES = {
  growthLoops: false,
  // v1 launch: present Chirawa as ONE unified storefront, not a marketplace of
  // separate stores. Hides the per-shop "store page" entry points (e.g. the
  // "Sold by → Explore shop" row on product detail) so users browse the whole
  // catalog in one place. Flip to true once multiple distinct shops go live.
  shopBrowsing: false,
} as const;
