-- Food module launch hardening: refund durability tracking on food_orders.
-- Additive only, food-scoped (no marketplace table touched): refund_status
-- drives the food-reconcile sweep's retry loop + admin visibility so a failed
-- Razorpay refund can never be silently lost.

-- AlterTable (food_orders is a Food-module table introduced in 20260708000000)
ALTER TABLE "food_orders" ADD COLUMN "refund_status" VARCHAR(12) NOT NULL DEFAULT 'none';
ALTER TABLE "food_orders" ADD COLUMN "razorpay_refund_id" VARCHAR(64);

-- CreateIndex
CREATE INDEX "food_orders_refund_status_idx" ON "food_orders"("refund_status");
