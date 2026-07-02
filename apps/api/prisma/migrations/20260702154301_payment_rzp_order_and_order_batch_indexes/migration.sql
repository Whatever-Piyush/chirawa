-- Hot-path indexes (audit P1-2):
--  * payments.razorpay_order_id — every Razorpay webhook / client verify runs
--    findMany/updateMany filtered on it (was a sequential scan).
--  * orders.batch_id — batch→orders loads and releaseOrderAssignment's
--    live-order count filter on it.

-- CreateIndex
CREATE INDEX "orders_batch_id_idx" ON "orders"("batch_id");

-- CreateIndex
CREATE INDEX "payments_razorpay_order_id_idx" ON "payments"("razorpay_order_id");
