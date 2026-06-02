-- AlterTable
ALTER TABLE "delivery_zones" ADD COLUMN     "polygon" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "rider_zones" (
    "id" UUID NOT NULL,
    "rider_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,

    CONSTRAINT "rider_zones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rider_zones_zone_id_idx" ON "rider_zones"("zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "rider_zones_rider_id_zone_id_key" ON "rider_zones"("rider_id", "zone_id");

-- AddForeignKey
ALTER TABLE "rider_zones" ADD CONSTRAINT "rider_zones_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "rider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_zones" ADD CONSTRAINT "rider_zones_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "delivery_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
