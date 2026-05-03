-- CreateTable
CREATE TABLE "IdeaAugmentation" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "rawIdea" TEXT NOT NULL,
    "refinedTitles" JSONB NOT NULL,
    "hookConcepts" JSONB NOT NULL,
    "contentEnhancements" JSONB NOT NULL,
    "audienceConnections" JSONB NOT NULL,
    "nichelearnings" JSONB NOT NULL,
    "overallAssessment" TEXT NOT NULL,
    "confidenceScore" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdeaAugmentation_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "IdeaAugmentation" ADD CONSTRAINT "IdeaAugmentation_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
