-- AlterTable
ALTER TABLE "products" ALTER COLUMN "stock_qty" DROP NOT NULL,
ALTER COLUMN "stock_qty" DROP DEFAULT;

-- Numeric stock is opt-in: the previous migration defaulted every existing
-- product to 0, which would make them all "tracked, 0 in stock" (unorderable).
-- Reset to NULL = "not tracked" so only products a seller explicitly stocks are
-- enforced. Safe: nothing read stock_qty between the two migrations.
UPDATE "products" SET "stock_qty" = NULL;
