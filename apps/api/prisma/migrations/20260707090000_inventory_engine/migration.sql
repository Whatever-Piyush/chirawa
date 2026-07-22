-- Inventory Engine (belief layer): inventory_state + inventory_events +
-- reservations, plus order_items.verification_flag and orders.resolver_trace.
-- products.stock_status stays as the read-side visibility projection.

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "verification_flag" VARCHAR(30);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "resolver_trace" JSONB;

-- CreateTable
CREATE TABLE "inventory_state" (
    "product_id" UUID NOT NULL,
    "expected_qty" INTEGER,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "velocity_class" INTEGER,
    "confidence_base" DECIMAL(4,3) NOT NULL DEFAULT 0.800,
    "last_verified_at" TIMESTAMP(3),
    "last_verified_source" VARCHAR(30),
    "last_verified_qty" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_state_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "inventory_events" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "event_type" VARCHAR(30) NOT NULL,
    "qty_delta" INTEGER,
    "qty_after" INTEGER,
    "reserved_after" INTEGER,
    "confidence_after" DECIMAL(4,3),
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_id" UUID,
    "order_id" UUID,
    "order_item_id" UUID,
    "reason" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'held',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_events_order_item_id_event_type_key" ON "inventory_events"("order_item_id", "event_type");

-- CreateIndex
CREATE INDEX "inventory_events_product_id_created_at_idx" ON "inventory_events"("product_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "inventory_events_shop_id_created_at_idx" ON "inventory_events"("shop_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "inventory_events_event_type_created_at_idx" ON "inventory_events"("event_type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_order_item_id_key" ON "reservations"("order_item_id");

-- CreateIndex
CREATE INDEX "reservations_order_id_idx" ON "reservations"("order_id");

-- CreateIndex
CREATE INDEX "reservations_product_id_status_idx" ON "reservations"("product_id", "status");

-- CreateIndex
CREATE INDEX "reservations_status_expires_at_idx" ON "reservations"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "inventory_state" ADD CONSTRAINT "inventory_state_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
