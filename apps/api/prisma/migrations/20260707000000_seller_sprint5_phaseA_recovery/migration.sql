-- Seller Sprint 5 Phase A — Distributed Recovery / Fulfillment Engine foundation.
-- Additive only: four new tables + two enums for recovery domain models, numbering,
-- the state machine, and the immutable audit event record. No existing table is
-- altered, so Sprint 0–4 behaviour is untouched and the migration backfills nothing.

-- CreateEnum
CREATE TYPE "RecoveryNeedState" AS ENUM ('open', 'searching', 'offered', 'accepted', 'ready', 'picked_up', 'fulfilled', 'exhausted', 'refunded', 'cancelled');

-- CreateEnum
CREATE TYPE "RecoveryOfferOutcome" AS ENUM ('pending', 'accepted', 'rejected', 'timed_out');

-- CreateTable
CREATE TABLE "recovery_needs" (
    "id" UUID NOT NULL,
    "parent_order_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "state" "RecoveryNeedState" NOT NULL DEFAULT 'open',
    "deadline_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_needs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_need_lines" (
    "id" UUID NOT NULL,
    "need_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "recovery_need_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_offers" (
    "id" UUID NOT NULL,
    "need_id" UUID NOT NULL,
    "partner_shop_id" UUID NOT NULL,
    "offered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "outcome" "RecoveryOfferOutcome" NOT NULL DEFAULT 'pending',
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "recovery_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_events" (
    "id" UUID NOT NULL,
    "need_id" UUID NOT NULL,
    "offer_id" UUID,
    "type" VARCHAR(40) NOT NULL,
    "actor_id" UUID,
    "actor_role" VARCHAR(20),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recovery_needs_parent_order_id_idx" ON "recovery_needs"("parent_order_id");

-- CreateIndex
CREATE INDEX "recovery_needs_state_idx" ON "recovery_needs"("state");

-- CreateIndex: one recovery suffix per parent order — closes the numbering race.
CREATE UNIQUE INDEX "recovery_needs_parent_order_id_sequence_key" ON "recovery_needs"("parent_order_id", "sequence");

-- CreateIndex
CREATE INDEX "recovery_need_lines_need_id_idx" ON "recovery_need_lines"("need_id");

-- CreateIndex
CREATE INDEX "recovery_offers_need_id_offered_at_idx" ON "recovery_offers"("need_id", "offered_at");

-- CreateIndex: strictly-sequential dispatch — at most ONE live (pending) offer per
-- need. A partial (filtered) UNIQUE index enforces it at the DB level (Prisma's
-- schema cannot express a filtered index, so it is authored here in raw SQL; the
-- service tolerates the resulting P2002 as a 409 conflict).
CREATE UNIQUE INDEX "recovery_offers_one_pending_per_need" ON "recovery_offers"("need_id") WHERE "outcome" = 'pending';

-- CreateIndex
CREATE INDEX "recovery_events_need_id_created_at_idx" ON "recovery_events"("need_id", "created_at");

-- AddForeignKey
ALTER TABLE "recovery_needs" ADD CONSTRAINT "recovery_needs_parent_order_id_fkey" FOREIGN KEY ("parent_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_need_lines" ADD CONSTRAINT "recovery_need_lines_need_id_fkey" FOREIGN KEY ("need_id") REFERENCES "recovery_needs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_need_lines" ADD CONSTRAINT "recovery_need_lines_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_offers" ADD CONSTRAINT "recovery_offers_need_id_fkey" FOREIGN KEY ("need_id") REFERENCES "recovery_needs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_offers" ADD CONSTRAINT "recovery_offers_partner_shop_id_fkey" FOREIGN KEY ("partner_shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_events" ADD CONSTRAINT "recovery_events_need_id_fkey" FOREIGN KEY ("need_id") REFERENCES "recovery_needs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_events" ADD CONSTRAINT "recovery_events_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "recovery_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
