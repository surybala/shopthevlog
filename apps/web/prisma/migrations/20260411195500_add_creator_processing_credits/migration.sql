ALTER TABLE "Creator"
ADD COLUMN "processingCreditsUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "processingCreditsResetAt" TIMESTAMP(3);

ALTER TABLE "Vlog"
ADD COLUMN "processingCreditsConsumed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "processingCreditsConsumedAt" TIMESTAMP(3);
