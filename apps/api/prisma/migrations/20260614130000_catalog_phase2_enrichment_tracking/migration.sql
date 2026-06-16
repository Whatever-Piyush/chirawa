-- AlterTable
ALTER TABLE "master_catalog" ADD COLUMN     "enrichment_attempted_at" TIMESTAMP(3),
ADD COLUMN     "enrichment_note" TEXT,
ADD COLUMN     "enrichment_status" VARCHAR(20);

-- CreateIndex
CREATE INDEX "master_catalog_enrichment_status_idx" ON "master_catalog"("enrichment_status");
