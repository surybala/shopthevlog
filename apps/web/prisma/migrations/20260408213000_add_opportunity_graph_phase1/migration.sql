-- Phase 1: evidence-backed opportunity graph backbone

ALTER TYPE "ProcessingStatus" ADD VALUE IF NOT EXISTS 'INGESTED';
ALTER TYPE "ProcessingStatus" ADD VALUE IF NOT EXISTS 'PREPROCESSING';
ALTER TYPE "ProcessingStatus" ADD VALUE IF NOT EXISTS 'TRANSCRIPT_DONE';
ALTER TYPE "ProcessingStatus" ADD VALUE IF NOT EXISTS 'VISION_DONE';
ALTER TYPE "ProcessingStatus" ADD VALUE IF NOT EXISTS 'FUSED';
ALTER TYPE "ProcessingStatus" ADD VALUE IF NOT EXISTS 'RESOLVED';
ALTER TYPE "ProcessingStatus" ADD VALUE IF NOT EXISTS 'RANKED';
ALTER TYPE "ProcessingStatus" ADD VALUE IF NOT EXISTS 'REVIEW_PENDING';
ALTER TYPE "ProcessingStatus" ADD VALUE IF NOT EXISTS 'PUBLISHED';

CREATE TYPE "EvidenceSourceType" AS ENUM (
  'TRANSCRIPT',
  'OCR',
  'SCENE_SUMMARY',
  'OBJECT_DETECTION',
  'LOGO_DETECTION',
  'LLM_CLAIM',
  'CLIP_SUMMARY'
);

CREATE TYPE "ClaimType" AS ENUM (
  'STAYED_AT',
  'VISITED',
  'ATE_AT',
  'DRANK_AT',
  'PACKED',
  'USED',
  'RECOMMENDS',
  'PURCHASED',
  'ITINERARY_STEP'
);

CREATE TYPE "CandidateEntityType" AS ENUM ('PLACE', 'PRODUCT', 'EXPERIENCE', 'BRAND');
CREATE TYPE "CandidateEntityStatus" AS ENUM ('NEW', 'RESOLVED', 'APPROVED', 'REJECTED');
CREATE TYPE "OpportunityType" AS ENUM (
  'ITINERARY',
  'CITY_GUIDE',
  'PACKING_LIST',
  'HOTEL',
  'RESTAURANT',
  'CAFE',
  'ATTRACTION',
  'ACTIVITY',
  'TRAVEL_PRODUCT',
  'PACKING_ITEM'
);
CREATE TYPE "OpportunityPublishState" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPPRESSED');
CREATE TYPE "OpportunityReviewState" AS ENUM ('UNREVIEWED', 'APPROVED', 'EDITED', 'REJECTED', 'AUTO_APPROVED');
CREATE TYPE "ResolverType" AS ENUM ('PLACE_MATCHER', 'PRODUCT_MATCHER');
CREATE TYPE "ResolutionMatchType" AS ENUM ('EXACT', 'LIKELY', 'SIMILAR', 'UNRESOLVED');
CREATE TYPE "CreatorMemoryType" AS ENUM (
  'ACCEPTED_PRODUCT',
  'REJECTED_PRODUCT',
  'ACCEPTED_PLACE',
  'NAMING_PREFERENCE',
  'DISALLOWED_CATEGORY',
  'RECURRING_ITEM'
);
CREATE TYPE "FeedbackAction" AS ENUM ('APPROVED', 'EDITED', 'REJECTED');

ALTER TABLE "Vlog"
  ADD COLUMN IF NOT EXISTS "pipelineError" TEXT,
  ADD COLUMN IF NOT EXISTS "lastPipelineRunAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewReadyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "publishedFromGraphAt" TIMESTAMP(3);

CREATE TABLE "TranscriptSegment" (
  "id" TEXT NOT NULL,
  "vlogId" TEXT NOT NULL,
  "startSec" DOUBLE PRECISION NOT NULL,
  "endSec" DOUBLE PRECISION NOT NULL,
  "text" TEXT NOT NULL,
  "speaker" TEXT,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SceneSegment" (
  "id" TEXT NOT NULL,
  "vlogId" TEXT NOT NULL,
  "startSec" DOUBLE PRECISION NOT NULL,
  "endSec" DOUBLE PRECISION NOT NULL,
  "sceneType" TEXT,
  "summary" TEXT,
  "samplingStrategy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SceneSegment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FrameAsset" (
  "id" TEXT NOT NULL,
  "vlogId" TEXT NOT NULL,
  "sceneSegmentId" TEXT,
  "timestampSec" DOUBLE PRECISION NOT NULL,
  "imageUri" TEXT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FrameAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Evidence" (
  "id" TEXT NOT NULL,
  "vlogId" TEXT NOT NULL,
  "sourceType" "EvidenceSourceType" NOT NULL,
  "claimType" "ClaimType",
  "startSec" DOUBLE PRECISION NOT NULL,
  "endSec" DOUBLE PRECISION NOT NULL,
  "transcriptSegmentId" TEXT,
  "frameAssetId" TEXT,
  "confidence" DOUBLE PRECISION,
  "payloadJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CandidateEntity" (
  "id" TEXT NOT NULL,
  "vlogId" TEXT NOT NULL,
  "entityType" "CandidateEntityType" NOT NULL,
  "subtype" TEXT,
  "canonicalLabel" TEXT,
  "rawLabel" TEXT NOT NULL,
  "startSec" DOUBLE PRECISION NOT NULL,
  "endSec" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "status" "CandidateEntityStatus" NOT NULL DEFAULT 'NEW',
  "evidenceBundleJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CandidateEntity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResolvedEntity" (
  "id" TEXT NOT NULL,
  "candidateEntityId" TEXT NOT NULL,
  "resolverType" "ResolverType" NOT NULL,
  "provider" TEXT NOT NULL,
  "externalId" TEXT,
  "resolvedName" TEXT NOT NULL,
  "matchType" "ResolutionMatchType" NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "metadataJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResolvedEntity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Opportunity" (
  "id" TEXT NOT NULL,
  "vlogId" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "opportunityType" "OpportunityType" NOT NULL,
  "candidateEntityId" TEXT,
  "resolvedEntityId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "rankScore" DOUBLE PRECISION,
  "confidence" DOUBLE PRECISION NOT NULL,
  "publishState" "OpportunityPublishState" NOT NULL DEFAULT 'DRAFT',
  "reviewState" "OpportunityReviewState" NOT NULL DEFAULT 'UNREVIEWED',
  "storefrontModule" TEXT,
  "metadataJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OpportunityEvidence" (
  "opportunityId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  CONSTRAINT "OpportunityEvidence_pkey" PRIMARY KEY ("opportunityId","evidenceId")
);

CREATE TABLE "OpportunityFeedback" (
  "id" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "action" "FeedbackAction" NOT NULL,
  "editedFieldsJson" JSONB,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpportunityFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorMemory" (
  "id" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "memoryType" "CreatorMemoryType" NOT NULL,
  "key" TEXT NOT NULL,
  "valueJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreatorMemory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreatorMemory_creatorId_memoryType_key_key" ON "CreatorMemory"("creatorId", "memoryType", "key");

CREATE INDEX "TranscriptSegment_vlogId_startSec_idx" ON "TranscriptSegment"("vlogId", "startSec");
CREATE INDEX "SceneSegment_vlogId_startSec_idx" ON "SceneSegment"("vlogId", "startSec");
CREATE INDEX "FrameAsset_vlogId_timestampSec_idx" ON "FrameAsset"("vlogId", "timestampSec");
CREATE INDEX "Evidence_vlogId_sourceType_idx" ON "Evidence"("vlogId", "sourceType");
CREATE INDEX "Evidence_vlogId_startSec_idx" ON "Evidence"("vlogId", "startSec");
CREATE INDEX "CandidateEntity_vlogId_entityType_idx" ON "CandidateEntity"("vlogId", "entityType");
CREATE INDEX "Opportunity_vlogId_opportunityType_idx" ON "Opportunity"("vlogId", "opportunityType");
CREATE INDEX "Opportunity_creatorId_reviewState_idx" ON "Opportunity"("creatorId", "reviewState");
CREATE INDEX "OpportunityFeedback_creatorId_createdAt_idx" ON "OpportunityFeedback"("creatorId", "createdAt");

ALTER TABLE "TranscriptSegment"
  ADD CONSTRAINT "TranscriptSegment_vlogId_fkey"
  FOREIGN KEY ("vlogId") REFERENCES "Vlog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SceneSegment"
  ADD CONSTRAINT "SceneSegment_vlogId_fkey"
  FOREIGN KEY ("vlogId") REFERENCES "Vlog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FrameAsset"
  ADD CONSTRAINT "FrameAsset_vlogId_fkey"
  FOREIGN KEY ("vlogId") REFERENCES "Vlog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FrameAsset"
  ADD CONSTRAINT "FrameAsset_sceneSegmentId_fkey"
  FOREIGN KEY ("sceneSegmentId") REFERENCES "SceneSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Evidence"
  ADD CONSTRAINT "Evidence_vlogId_fkey"
  FOREIGN KEY ("vlogId") REFERENCES "Vlog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Evidence"
  ADD CONSTRAINT "Evidence_transcriptSegmentId_fkey"
  FOREIGN KEY ("transcriptSegmentId") REFERENCES "TranscriptSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Evidence"
  ADD CONSTRAINT "Evidence_frameAssetId_fkey"
  FOREIGN KEY ("frameAssetId") REFERENCES "FrameAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CandidateEntity"
  ADD CONSTRAINT "CandidateEntity_vlogId_fkey"
  FOREIGN KEY ("vlogId") REFERENCES "Vlog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResolvedEntity"
  ADD CONSTRAINT "ResolvedEntity_candidateEntityId_fkey"
  FOREIGN KEY ("candidateEntityId") REFERENCES "CandidateEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Opportunity"
  ADD CONSTRAINT "Opportunity_vlogId_fkey"
  FOREIGN KEY ("vlogId") REFERENCES "Vlog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Opportunity"
  ADD CONSTRAINT "Opportunity_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Opportunity"
  ADD CONSTRAINT "Opportunity_candidateEntityId_fkey"
  FOREIGN KEY ("candidateEntityId") REFERENCES "CandidateEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Opportunity"
  ADD CONSTRAINT "Opportunity_resolvedEntityId_fkey"
  FOREIGN KEY ("resolvedEntityId") REFERENCES "ResolvedEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OpportunityEvidence"
  ADD CONSTRAINT "OpportunityEvidence_opportunityId_fkey"
  FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpportunityEvidence"
  ADD CONSTRAINT "OpportunityEvidence_evidenceId_fkey"
  FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpportunityFeedback"
  ADD CONSTRAINT "OpportunityFeedback_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpportunityFeedback"
  ADD CONSTRAINT "OpportunityFeedback_opportunityId_fkey"
  FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CreatorMemory"
  ADD CONSTRAINT "CreatorMemory_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
