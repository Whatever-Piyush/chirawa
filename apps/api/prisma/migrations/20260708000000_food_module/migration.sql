-- Food Delivery Module (Food.md) — completely isolated plug-in.
-- Additive only: eight new tables (restaurants, menu_categories, menu_items,
-- food_carts, food_cart_items, food_orders, food_order_items,
-- food_order_status_history). NO existing table, column, or enum is altered —
-- the marketplace schema is byte-for-byte untouched (Food.md §3, §9).

-- CreateTable
CREATE TABLE "restaurants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "cuisine" VARCHAR(80),
    "logo_url" TEXT,
    "cover_image_url" TEXT,
    "lat" DECIMAL(10,8) NOT NULL,
    "lng" DECIMAL(11,8) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_open" BOOLEAN NOT NULL DEFAULT true,
    "open_time" VARCHAR(5) NOT NULL DEFAULT '11:00',
    "close_time" VARCHAR(5) NOT NULL DEFAULT '22:00',
    "prep_time_minutes" INTEGER NOT NULL DEFAULT 20,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "seller_user_id" UUID,
    "rating_average" DECIMAL(3,2),
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "menu_category_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "price_paise" INTEGER NOT NULL,
    "image_url" TEXT,
    "is_veg" BOOLEAN,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_carts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "restaurant_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_cart_items" (
    "id" UUID NOT NULL,
    "food_cart_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_at_add" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_orders" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "delivery_street" VARCHAR(255) NOT NULL,
    "delivery_landmark" VARCHAR(255) NOT NULL DEFAULT '',
    "delivery_locality" VARCHAR(100) NOT NULL DEFAULT '',
    "delivery_city" VARCHAR(100) NOT NULL DEFAULT '',
    "delivery_pincode" VARCHAR(10) NOT NULL DEFAULT '',
    "delivery_lat" DECIMAL(10,8) NOT NULL,
    "delivery_lng" DECIMAL(11,8) NOT NULL,
    "receiver_name" VARCHAR(100),
    "receiver_phone" VARCHAR(20),
    "items_subtotal_paise" INTEGER NOT NULL,
    "delivery_fee_paise" INTEGER NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending_payment',
    "payment_method" VARCHAR(10) NOT NULL DEFAULT 'upi',
    "razorpay_order_id" VARCHAR(64),
    "razorpay_payment_id" VARCHAR(64),
    "paid_at" TIMESTAMP(3),
    "refunded_paise" INTEGER NOT NULL DEFAULT 0,
    "rider_id" UUID,
    "cancel_reason" VARCHAR(255),
    "confirmed_at" TIMESTAMP(3),
    "preparing_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "picked_up_at" TIMESTAMP(3),
    "out_for_delivery_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_order_items" (
    "id" UUID NOT NULL,
    "food_order_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_order_status_history" (
    "id" UUID NOT NULL,
    "food_order_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "changed_by_role" VARCHAR(20) NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "reason" VARCHAR(255),
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restaurants_is_active_is_open_idx" ON "restaurants"("is_active", "is_open");

-- CreateIndex
CREATE INDEX "restaurants_display_order_idx" ON "restaurants"("display_order");

-- CreateIndex
CREATE INDEX "restaurants_seller_user_id_idx" ON "restaurants"("seller_user_id");

-- CreateIndex
CREATE INDEX "menu_categories_restaurant_id_sort_order_idx" ON "menu_categories"("restaurant_id", "sort_order");

-- CreateIndex
CREATE INDEX "menu_items_restaurant_id_is_available_idx" ON "menu_items"("restaurant_id", "is_available");

-- CreateIndex
CREATE INDEX "menu_items_menu_category_id_sort_order_idx" ON "menu_items"("menu_category_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "food_carts_user_id_key" ON "food_carts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "food_cart_items_food_cart_id_menu_item_id_key" ON "food_cart_items"("food_cart_id", "menu_item_id");

-- CreateIndex
CREATE INDEX "food_orders_customer_id_created_at_idx" ON "food_orders"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "food_orders_restaurant_id_status_created_at_idx" ON "food_orders"("restaurant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "food_orders_rider_id_status_idx" ON "food_orders"("rider_id", "status");

-- CreateIndex
CREATE INDEX "food_orders_status_created_at_idx" ON "food_orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "food_orders_razorpay_order_id_idx" ON "food_orders"("razorpay_order_id");

-- CreateIndex
CREATE INDEX "food_order_items_food_order_id_idx" ON "food_order_items"("food_order_id");

-- CreateIndex
CREATE INDEX "food_order_status_history_food_order_id_changed_at_idx" ON "food_order_status_history"("food_order_id", "changed_at");

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_menu_category_id_fkey" FOREIGN KEY ("menu_category_id") REFERENCES "menu_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_carts" ADD CONSTRAINT "food_carts_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_cart_items" ADD CONSTRAINT "food_cart_items_food_cart_id_fkey" FOREIGN KEY ("food_cart_id") REFERENCES "food_carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_cart_items" ADD CONSTRAINT "food_cart_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_orders" ADD CONSTRAINT "food_orders_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_order_items" ADD CONSTRAINT "food_order_items_food_order_id_fkey" FOREIGN KEY ("food_order_id") REFERENCES "food_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_order_status_history" ADD CONSTRAINT "food_order_status_history_food_order_id_fkey" FOREIGN KEY ("food_order_id") REFERENCES "food_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
