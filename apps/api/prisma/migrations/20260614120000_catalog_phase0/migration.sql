-- Catalog Engine Phase 0 — additive, nullable, reversible.
-- Adds the MasterCatalog dictionary, the barcode/master join key on products,
-- ProductImage provenance, ProductRequest demand capture, and OrderGroup. No
-- existing column is altered or dropped, so this is non-breaking; every existing
-- row keeps working with the new fields left NULL.

-- CreateEnum
CREATE TYPE "MasterStatus" AS ENUM ('needs_review', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "barcode" VARCHAR(14),
ADD COLUMN     "master_id" UUID;

-- AlterTable
ALTER TABLE "product_images" ADD COLUMN     "attribution" TEXT,
ADD COLUMN     "license" VARCHAR(50),
ADD COLUMN     "source" VARCHAR(50);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "group_id" UUID;

-- CreateTable
CREATE TABLE "master_catalog" (
    "id" UUID NOT NULL,
    "barcode" VARCHAR(14) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "brand" VARCHAR(120),
    "unit" VARCHAR(50),
    "mrp_paise" INTEGER,
    "category_name" TEXT,
    "image_url" TEXT,
    "image_source" TEXT,
    "image_license" TEXT,
    "image_attribution" TEXT,
    "status" "MasterStatus" NOT NULL DEFAULT 'needs_review',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "raw_text" TEXT,
    "barcode" VARCHAR(14),
    "master_id" UUID,
    "pincode" VARCHAR(10),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_groups" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_catalog_barcode_key" ON "master_catalog"("barcode");

-- CreateIndex
CREATE INDEX "master_catalog_name_idx" ON "master_catalog"("name");

-- CreateIndex
CREATE INDEX "master_catalog_status_idx" ON "master_catalog"("status");

-- CreateIndex
CREATE INDEX "product_requests_master_id_idx" ON "product_requests"("master_id");

-- CreateIndex
CREATE INDEX "product_requests_created_at_idx" ON "product_requests"("created_at");

-- CreateIndex
CREATE INDEX "products_barcode_idx" ON "products"("barcode");

-- CreateIndex
CREATE INDEX "products_master_id_stock_status_is_active_idx" ON "products"("master_id", "stock_status", "is_active");

-- CreateIndex
CREATE INDEX "orders_group_id_idx" ON "orders"("group_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "master_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "order_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
