// Loyalty status (Chunk 7.5) — derived from the existing order-count tier model.
// Informational only; no redemption flow.
export interface LoyaltyResponse {
  tier: string;                 // current tier name (e.g. "bronze")
  tierDescription: string;
  walletBonusPct: number;
  totalOrders: number;
  nextTier: string | null;      // null when already at the top tier
  ordersToNext: number;         // orders remaining to reach nextTier (0 at top)
  progress: number;             // 0..1 toward nextTier (1 at top)
}
