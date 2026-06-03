-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "batch_id" UUID;

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "zone_id" UUID,
    "rider_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "anchor_lat" DECIMAL(10,8) NOT NULL,
    "anchor_lng" DECIMAL(11,8) NOT NULL,
    "closes_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "batches_status_zone_id_idx" ON "batches"("status", "zone_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
