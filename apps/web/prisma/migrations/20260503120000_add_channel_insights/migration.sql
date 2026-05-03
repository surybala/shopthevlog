-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'QUEUED', 'ANALYZING', 'COMPLETE', 'FAILED');

-- CreateTable
CREATE TABLE "ChannelInsight" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "channelNiche" TEXT,
    "topPatterns" JSONB,
    "audienceDemands" JSONB,
    "analyzedVideoCount" INTEGER NOT NULL DEFAULT 0,
    "usedBenchmarks" BOOLEAN NOT NULL DEFAULT false,
    "benchmarkVideoCount" INTEGER NOT NULL DEFAULT 0,
    "analyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentBrief" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hookIdeas" JSONB NOT NULL,
    "contentOutline" JSONB NOT NULL,
    "trendSignal" TEXT,
    "audienceSignal" TEXT,
    "estimatedScore" INTEGER NOT NULL DEFAULT 50,
    "reasoning" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentBrief_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelInsight_creatorId_key" ON "ChannelInsight"("creatorId");

-- AddForeignKey
ALTER TABLE "ChannelInsight" ADD CONSTRAINT "ChannelInsight_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentBrief" ADD CONSTRAINT "ContentBrief_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "ChannelInsight"("id") ON DELETE CASCADE ON UPDATE CASCADE;
