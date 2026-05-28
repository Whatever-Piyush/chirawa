-- Adds explicit "seller has accepted this order" marker so the seller-app can
-- tell a fresh order (Accept/Reject pending) from one that has already been
-- accepted (show normal progression buttons), even after the app is reopened.
ALTER TABLE "orders" ADD COLUMN "seller_accepted_at" TIMESTAMP(3);

-- Backfill existing rows that are past the accept stage so they continue to
-- show "Taiyar Karna Shuru" instead of suddenly demanding re-acceptance.
UPDATE "orders"
SET    "seller_accepted_at" = COALESCE("confirmed_at", "created_at")
WHERE  "status" NOT IN ('pending_payment', 'paid')
  AND  "seller_accepted_at" IS NULL;
