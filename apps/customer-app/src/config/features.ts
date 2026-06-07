// Feature flags for the customer app.
//
// v1 launch: referral, loyalty and wallet are HIDDEN — the business can't fund
// rewards yet (Phase 1.9 "hide, don't wire"). Flip `growthLoops` to true to
// re-enable the UI post-launch once those flows are funded + tested.
export const FEATURES = {
  growthLoops: false,
} as const;
