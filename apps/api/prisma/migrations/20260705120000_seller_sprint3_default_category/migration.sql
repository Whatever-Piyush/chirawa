-- Seller Sprint 3 — default category invariant.
-- Marks a shop's default category, which holds products added without an explicit
-- category. It is created lazily by the API on first need and can never be deleted.
-- Existing NULL-category products are moved into a default category by the one-time
-- backfill script (prisma/backfill-category.ts / `db:backfill:category`).

-- AlterTable
ALTER TABLE "categories" ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex: at most ONE default category per shop.
-- A partial (filtered) UNIQUE index — only rows with is_default = true are
-- constrained, so a shop keeps unlimited normal categories but can never hold two
-- defaults. This closes the lazy getOrCreateDefaultCategoryId() create race at the
-- DB level. (Prisma's schema cannot express a filtered index, so it is authored
-- here in raw SQL; the API tolerates the resulting P2002 by re-fetching the winner.)
CREATE UNIQUE INDEX "categories_one_default_per_shop" ON "categories" ("shop_id") WHERE "is_default";
