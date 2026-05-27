-- CreateTable
CREATE TABLE "search_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "term" TEXT NOT NULL,
    "aliases" TEXT[],
    "language" TEXT NOT NULL DEFAULT 'any',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "search_aliases_term_key" ON "search_aliases"("term");

-- CreateIndex
CREATE INDEX "search_aliases_term_idx" ON "search_aliases"("term");
