-- AlterTable
ALTER TABLE "products" ADD COLUMN     "low_stock_at" INTEGER,
ADD COLUMN     "stock_qty" INTEGER NOT NULL DEFAULT 0;
