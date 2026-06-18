-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "estimated_delivery_at" TIMESTAMP(3),
ADD COLUMN     "eta_computed_at" TIMESTAMP(3),
ADD COLUMN     "eta_source" VARCHAR(20),
ADD COLUMN     "eta_spread_seconds" INTEGER,
ADD COLUMN     "out_for_delivery_at" TIMESTAMP(3),
ADD COLUMN     "preparing_at" TIMESTAMP(3),
ADD COLUMN     "ready_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "prep_time_minutes" INTEGER NOT NULL DEFAULT 8;

-- CreateIndex
CREATE INDEX "orders_status_estimated_delivery_at_idx" ON "orders"("status", "estimated_delivery_at");
