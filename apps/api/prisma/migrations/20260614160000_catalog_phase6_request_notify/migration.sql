-- Catalog Engine Phase 6 — restock "notify me" on product requests. Additive +
-- defaulted, so existing rows backfill with no breakage.

-- AlterTable
ALTER TABLE "product_requests" ADD COLUMN     "notified_at" TIMESTAMP(3),
ADD COLUMN     "notify_on_restock" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "product_requests_barcode_idx" ON "product_requests"("barcode");
