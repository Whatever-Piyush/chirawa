-- Catalog Engine Phase 5 — per-line fulfillment tracking for the stale-stock
-- safety net. Additive + defaulted, so existing rows backfill with no breakage.

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "fulfillment_status" VARCHAR(20) NOT NULL DEFAULT 'fulfilled',
ADD COLUMN     "refunded_paise" INTEGER NOT NULL DEFAULT 0;
