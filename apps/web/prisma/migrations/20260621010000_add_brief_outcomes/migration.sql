-- AlterTable: outcome-loop columns on ContentBrief
ALTER TABLE "ContentBrief" ADD COLUMN "actualScore" INTEGER;
ALTER TABLE "ContentBrief" ADD COLUMN "outcomeDelta" DOUBLE PRECISION;
ALTER TABLE "ContentBrief" ADD COLUMN "measuredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BriefFeedback" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "action" "FeedbackAction" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BriefFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BriefFeedback_creatorId_createdAt_idx" ON "BriefFeedback"("creatorId", "createdAt");

-- AddForeignKey
ALTER TABLE "BriefFeedback" ADD CONSTRAINT "BriefFeedback_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefFeedback" ADD CONSTRAINT "BriefFeedback_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "ContentBrief"("id") ON DELETE CASCADE ON UPDATE CASCADE;
