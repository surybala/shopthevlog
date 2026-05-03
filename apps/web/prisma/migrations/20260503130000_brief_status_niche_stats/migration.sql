-- CreateEnum
CREATE TYPE "BriefStatus" AS ENUM ('IDEA', 'FILMING', 'PUBLISHED');

-- AlterTable: add nicheStats to ChannelInsight
ALTER TABLE "ChannelInsight" ADD COLUMN "nicheStats" JSONB;

-- AlterTable: add briefStatus and publishedVlogId to ContentBrief
ALTER TABLE "ContentBrief" ADD COLUMN "briefStatus" "BriefStatus" NOT NULL DEFAULT 'IDEA';
ALTER TABLE "ContentBrief" ADD COLUMN "publishedVlogId" TEXT;
