-- CreateEnum
CREATE TYPE "NicheMomentum" AS ENUM ('RISING', 'STEADY', 'SATURATED');

-- CreateTable
CREATE TABLE "Niche" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keywords" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Niche_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NicheTrend" (
    "id" TEXT NOT NULL,
    "nicheId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "format" TEXT,
    "momentum" "NicheMomentum" NOT NULL DEFAULT 'STEADY',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NicheTrend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NicheBenchmarkCache" (
    "id" TEXT NOT NULL,
    "nicheId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "videosJson" JSONB NOT NULL,
    "peersJson" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NicheBenchmarkCache_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Creator" ADD COLUMN "nicheId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Niche_slug_key" ON "Niche"("slug");

-- CreateIndex
CREATE INDEX "NicheTrend_nicheId_computedAt_idx" ON "NicheTrend"("nicheId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NicheBenchmarkCache_nicheId_key" ON "NicheBenchmarkCache"("nicheId");

-- AddForeignKey
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_nicheId_fkey" FOREIGN KEY ("nicheId") REFERENCES "Niche"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NicheTrend" ADD CONSTRAINT "NicheTrend_nicheId_fkey" FOREIGN KEY ("nicheId") REFERENCES "Niche"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NicheBenchmarkCache" ADD CONSTRAINT "NicheBenchmarkCache_nicheId_fkey" FOREIGN KEY ("nicheId") REFERENCES "Niche"("id") ON DELETE CASCADE ON UPDATE CASCADE;
