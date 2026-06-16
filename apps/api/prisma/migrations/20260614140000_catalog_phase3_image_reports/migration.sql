-- CreateTable
CREATE TABLE "image_reports" (
    "id" UUID NOT NULL,
    "product_id" UUID,
    "master_id" UUID,
    "reported_by_id" UUID,
    "reason" VARCHAR(255),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "image_reports_master_id_idx" ON "image_reports"("master_id");

-- CreateIndex
CREATE INDEX "image_reports_resolved_at_idx" ON "image_reports"("resolved_at");

-- CreateIndex
CREATE INDEX "image_reports_created_at_idx" ON "image_reports"("created_at");
