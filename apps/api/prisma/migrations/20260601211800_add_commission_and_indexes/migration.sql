-- DropIndex
DROP INDEX "idx_products_name_trgm";

-- DropIndex
DROP INDEX "idx_shops_name_trgm";

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "commission_rate" DECIMAL(5,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "search_aliases" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "commission_rate" DECIMAL(5,4) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "shops_is_open_idx" ON "shops"("is_open");

-- CreateIndex
CREATE INDEX "shops_is_featured_idx" ON "shops"("is_featured");
