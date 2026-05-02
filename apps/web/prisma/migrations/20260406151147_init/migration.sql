-- CreateEnum
CREATE TYPE "CreatorPlan" AS ENUM ('FREE', 'PRO', 'STUDIO');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'QUEUED', 'SCANNING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('YOUTUBE', 'TIKTOK', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'QUEUED', 'TRANSCRIBING', 'EXTRACTING', 'EMBEDDING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "PlaceType" AS ENUM ('HOTEL', 'HOSTEL', 'RESTAURANT', 'CAFE', 'EXPERIENCE', 'ATTRACTION', 'NEIGHBORHOOD', 'TRANSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('GEAR', 'CLOTHING', 'ELECTRONICS', 'LUGGAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('ACCOMMODATION', 'FOOD', 'TOUR', 'ADVENTURE', 'CULTURAL', 'WELLNESS', 'NIGHTLIFE', 'TRANSPORT', 'ATTRACTION', 'OTHER');

-- CreateEnum
CREATE TYPE "TravelStyle" AS ENUM ('BUDGET', 'MID', 'LUXURY', 'BACKPACKER', 'FAMILY', 'SOLO', 'COUPLE');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MODERATE', 'CHALLENGING');

-- CreateEnum
CREATE TYPE "AccessTier" AS ENUM ('FREE', 'FOLLOWER', 'PREMIUM');

-- CreateEnum
CREATE TYPE "SectionType" AS ENUM ('ACCOMMODATION', 'TRANSPORT', 'FOOD', 'GEAR_AND_PACKING', 'BUDGET_BREAKDOWN', 'VISA_AND_ENTRY', 'HEALTH_AND_SAFETY', 'TIPS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MerchandiseType" AS ENUM ('PHYSICAL', 'DIGITAL', 'AFFILIATE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'TRIALING', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "AffiliateLinkType" AS ENUM ('HOTEL', 'HOSTEL', 'AIRBNB', 'EXPERIENCE_TOUR', 'RESTAURANT', 'TRANSPORT', 'FLIGHT_SEARCH', 'GEAR_PRODUCT', 'CLOTHING', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AffiliateProvider" AS ENUM ('STAY22', 'BOOKING_COM', 'EXPEDIA', 'AIRBNB', 'GETYOURGUIDE', 'VIATOR', 'KLOOK', 'AMAZON', 'SKYSCANNER', 'GOOGLE_FLIGHTS', 'KIWI', 'PRINTFUL', 'PRINTIFY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('CPA', 'CPL', 'CPC');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PAID', 'REVERSED');

-- CreateEnum
CREATE TYPE "WishlistItemType" AS ENUM ('TRIP_KIT', 'MERCHANDISE', 'AFFILIATE_LINK');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('MOBILE', 'DESKTOP', 'TABLET');

-- CreateTable
CREATE TABLE "Creator" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "coverImageUrl" TEXT,
    "location" TEXT,
    "websiteUrl" TEXT,
    "country" TEXT,
    "youtubeChannelId" TEXT,
    "youtubeHandle" TEXT,
    "tiktokUserId" TEXT,
    "tiktokHandle" TEXT,
    "instagramHandle" TEXT,
    "subscriberCount" INTEGER NOT NULL DEFAULT 0,
    "freeTierEnabled" BOOLEAN NOT NULL DEFAULT true,
    "stripeAccountId" TEXT,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "plan" "CreatorPlan" NOT NULL DEFAULT 'FREE',
    "catalogScanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "lastCatalogScan" TIMESTAMP(3),
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorChannelToken" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiry" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorChannelToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscriber" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "location" TEXT,
    "preferredCurrency" TEXT NOT NULL DEFAULT 'USD',
    "travelStyles" "TravelStyle"[],
    "emailNotifs" BOOLEAN NOT NULL DEFAULT true,
    "pushNotifs" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "followedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedKit" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "tripKitId" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WishlistItem" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "itemType" "WishlistItemType" NOT NULL,
    "tripKitId" TEXT,
    "merchandiseId" TEXT,
    "affiliateLinkId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vlog" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "viewCount" INTEGER DEFAULT 0,
    "likeCount" INTEGER DEFAULT 0,
    "transcriptRaw" TEXT,
    "transcriptClean" TEXT,
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "embeddingId" TEXT,
    "tags" TEXT[],
    "countries" TEXT[],
    "cities" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vlog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedPlace" (
    "id" TEXT NOT NULL,
    "vlogId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PlaceType" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "timestampStart" INTEGER,
    "timestampEnd" INTEGER,
    "transcriptExcerpt" TEXT,
    "googlePlaceId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractedPlace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedProduct" (
    "id" TEXT NOT NULL,
    "vlogId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "brand" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "timestampStart" INTEGER,
    "transcriptExcerpt" TEXT,
    "asin" TEXT,
    "affiliateUrl" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedActivity" (
    "id" TEXT NOT NULL,
    "vlogId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "timestampStart" INTEGER,
    "transcriptExcerpt" TEXT,
    "gygProductId" TEXT,
    "viatorProductId" TEXT,
    "affiliateUrl" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractedActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripKit" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "coverImageUrl" TEXT,
    "heroVideoUrl" TEXT,
    "countries" TEXT[],
    "cities" TEXT[],
    "primaryCity" TEXT,
    "durationDays" INTEGER,
    "estimatedBudgetLow" INTEGER,
    "estimatedBudgetHigh" INTEGER,
    "bestMonths" INTEGER[],
    "travelStyle" "TravelStyle"[],
    "difficulty" "Difficulty",
    "accessTier" "AccessTier" NOT NULL DEFAULT 'FREE',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "totalLinkCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedEarnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "saveCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "conversionCount" INTEGER NOT NULL DEFAULT 0,
    "generatedByAI" BOOLEAN NOT NULL DEFAULT false,
    "aiVersion" TEXT,
    "lastAIRegen" TIMESTAMP(3),
    "manuallyEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripKitsOnVlogs" (
    "tripKitId" TEXT NOT NULL,
    "vlogId" TEXT NOT NULL,

    CONSTRAINT "TripKitsOnVlogs_pkey" PRIMARY KEY ("tripKitId","vlogId")
);

-- CreateTable
CREATE TABLE "ItineraryDay" (
    "id" TEXT NOT NULL,
    "tripKitId" TEXT NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "city" TEXT,
    "country" TEXT,
    "tips" TEXT[],

    CONSTRAINT "ItineraryDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayActivity" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "time" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "ActivityType" NOT NULL,
    "affiliateLinkId" TEXT,
    "imageUrl" TEXT,
    "videoTimestamp" INTEGER,
    "googlePlaceId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,

    CONSTRAINT "DayActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitSection" (
    "id" TEXT NOT NULL,
    "tripKitId" TEXT NOT NULL,
    "type" "SectionType" NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "content" JSONB NOT NULL,

    CONSTRAINT "KitSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingItem" (
    "id" TEXT NOT NULL,
    "tripKitId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "essential" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "affiliateLinkId" TEXT,

    CONSTRAINT "PackingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchandise" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "coverImageUrl" TEXT NOT NULL,
    "imageUrls" TEXT[],
    "type" "MerchandiseType" NOT NULL,
    "printProvider" TEXT,
    "printProductId" TEXT,
    "digitalFileUrl" TEXT,
    "digitalFileSize" INTEGER,
    "affiliateLinkId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "price" INTEGER,
    "compareAtPrice" INTEGER,
    "accessTier" "AccessTier" NOT NULL DEFAULT 'FREE',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "destinationTags" TEXT[],
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "purchaseCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchandise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchVariant" (
    "id" TEXT NOT NULL,
    "merchandiseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "price" INTEGER NOT NULL,
    "stock" INTEGER,
    "printVariantId" TEXT,

    CONSTRAINT "MerchVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "coverImageUrl" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionTier" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPrice" INTEGER NOT NULL DEFAULT 0,
    "yearlyPrice" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "stripePriceId" TEXT,
    "stripePriceIdYearly" TEXT,
    "perks" TEXT[],
    "kitAccess" "AccessTier" NOT NULL DEFAULT 'FREE',
    "earlyAccess" BOOLEAN NOT NULL DEFAULT false,
    "brandDiscount" BOOLEAN NOT NULL DEFAULT false,
    "communityAccess" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "billingPeriod" "BillingPeriod" NOT NULL DEFAULT 'MONTHLY',
    "stripeSubId" TEXT,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "trialEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateLink" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "type" "AffiliateLinkType" NOT NULL,
    "targetName" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "affiliateUrl" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "provider" "AffiliateProvider" NOT NULL,
    "providerProductId" TEXT,
    "city" TEXT,
    "country" TEXT,
    "googlePlaceId" TEXT,
    "imageUrl" TEXT,
    "description" TEXT,
    "priceFrom" TEXT,
    "estimatedCommissionPct" DOUBLE PRECISION,
    "commissionType" "CommissionType" NOT NULL DEFAULT 'CPA',
    "extractedPlaceId" TEXT,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "conversionCount" INTEGER NOT NULL DEFAULT 0,
    "totalEarnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "affiliateLinkId" TEXT NOT NULL,
    "provider" "AffiliateProvider" NOT NULL,
    "externalConversionId" TEXT NOT NULL,
    "grossAmount" INTEGER NOT NULL,
    "commissionAmount" INTEGER NOT NULL,
    "platformFee" INTEGER NOT NULL,
    "creatorEarnings" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "convertedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClickEvent" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "subscriberId" TEXT,
    "sessionId" TEXT NOT NULL,
    "tripKitId" TEXT,
    "referrer" TEXT,
    "userAgent" TEXT,
    "country" TEXT,
    "device" "DeviceType" NOT NULL DEFAULT 'MOBILE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClickEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "merchandiseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "stripePaymentIntentId" TEXT,
    "printfulOrderId" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "downloadUrl" TEXT,
    "downloadExpiry" TIMESTAMP(3),
    "shippingName" TEXT,
    "shippingAddress" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AffiliateLinkToTripKit" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AffiliateLinkToTripKit_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_AffiliateLinkToKitSection" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AffiliateLinkToKitSection_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Creator_userId_key" ON "Creator"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_handle_key" ON "Creator"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_youtubeChannelId_key" ON "Creator"("youtubeChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_tiktokUserId_key" ON "Creator"("tiktokUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorChannelToken_creatorId_platform_key" ON "CreatorChannelToken"("creatorId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_userId_key" ON "Subscriber"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_subscriberId_creatorId_key" ON "Follow"("subscriberId", "creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedKit_subscriberId_tripKitId_key" ON "SavedKit"("subscriberId", "tripKitId");

-- CreateIndex
CREATE UNIQUE INDEX "Vlog_platform_externalId_key" ON "Vlog"("platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "TripKit_creatorId_slug_key" ON "TripKit"("creatorId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ItineraryDay_tripKitId_dayNumber_key" ON "ItineraryDay"("tripKitId", "dayNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Merchandise_creatorId_slug_key" ON "Merchandise"("creatorId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_creatorId_slug_key" ON "Collection"("creatorId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubId_key" ON "Subscription"("stripeSubId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_subscriberId_creatorId_key" ON "Subscription"("subscriberId", "creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateLink_shortCode_key" ON "AffiliateLink"("shortCode");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_externalConversionId_key" ON "Commission"("externalConversionId");

-- CreateIndex
CREATE INDEX "ClickEvent_creatorId_createdAt_idx" ON "ClickEvent"("creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "ClickEvent_linkId_createdAt_idx" ON "ClickEvent"("linkId", "createdAt");

-- CreateIndex
CREATE INDEX "_AffiliateLinkToTripKit_B_index" ON "_AffiliateLinkToTripKit"("B");

-- CreateIndex
CREATE INDEX "_AffiliateLinkToKitSection_B_index" ON "_AffiliateLinkToKitSection"("B");

-- AddForeignKey
ALTER TABLE "CreatorChannelToken" ADD CONSTRAINT "CreatorChannelToken_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedKit" ADD CONSTRAINT "SavedKit_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedKit" ADD CONSTRAINT "SavedKit_tripKitId_fkey" FOREIGN KEY ("tripKitId") REFERENCES "TripKit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vlog" ADD CONSTRAINT "Vlog_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedPlace" ADD CONSTRAINT "ExtractedPlace_vlogId_fkey" FOREIGN KEY ("vlogId") REFERENCES "Vlog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedProduct" ADD CONSTRAINT "ExtractedProduct_vlogId_fkey" FOREIGN KEY ("vlogId") REFERENCES "Vlog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedActivity" ADD CONSTRAINT "ExtractedActivity_vlogId_fkey" FOREIGN KEY ("vlogId") REFERENCES "Vlog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripKit" ADD CONSTRAINT "TripKit_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripKitsOnVlogs" ADD CONSTRAINT "TripKitsOnVlogs_tripKitId_fkey" FOREIGN KEY ("tripKitId") REFERENCES "TripKit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripKitsOnVlogs" ADD CONSTRAINT "TripKitsOnVlogs_vlogId_fkey" FOREIGN KEY ("vlogId") REFERENCES "Vlog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryDay" ADD CONSTRAINT "ItineraryDay_tripKitId_fkey" FOREIGN KEY ("tripKitId") REFERENCES "TripKit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayActivity" ADD CONSTRAINT "DayActivity_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "ItineraryDay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayActivity" ADD CONSTRAINT "DayActivity_affiliateLinkId_fkey" FOREIGN KEY ("affiliateLinkId") REFERENCES "AffiliateLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitSection" ADD CONSTRAINT "KitSection_tripKitId_fkey" FOREIGN KEY ("tripKitId") REFERENCES "TripKit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingItem" ADD CONSTRAINT "PackingItem_tripKitId_fkey" FOREIGN KEY ("tripKitId") REFERENCES "TripKit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingItem" ADD CONSTRAINT "PackingItem_affiliateLinkId_fkey" FOREIGN KEY ("affiliateLinkId") REFERENCES "AffiliateLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Merchandise" ADD CONSTRAINT "Merchandise_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Merchandise" ADD CONSTRAINT "Merchandise_affiliateLinkId_fkey" FOREIGN KEY ("affiliateLinkId") REFERENCES "AffiliateLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchVariant" ADD CONSTRAINT "MerchVariant_merchandiseId_fkey" FOREIGN KEY ("merchandiseId") REFERENCES "Merchandise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionTier" ADD CONSTRAINT "SubscriptionTier_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "SubscriptionTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_extractedPlaceId_fkey" FOREIGN KEY ("extractedPlaceId") REFERENCES "ExtractedPlace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_affiliateLinkId_fkey" FOREIGN KEY ("affiliateLinkId") REFERENCES "AffiliateLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickEvent" ADD CONSTRAINT "ClickEvent_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "AffiliateLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickEvent" ADD CONSTRAINT "ClickEvent_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickEvent" ADD CONSTRAINT "ClickEvent_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickEvent" ADD CONSTRAINT "ClickEvent_tripKitId_fkey" FOREIGN KEY ("tripKitId") REFERENCES "TripKit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_merchandiseId_fkey" FOREIGN KEY ("merchandiseId") REFERENCES "Merchandise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AffiliateLinkToTripKit" ADD CONSTRAINT "_AffiliateLinkToTripKit_A_fkey" FOREIGN KEY ("A") REFERENCES "AffiliateLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AffiliateLinkToTripKit" ADD CONSTRAINT "_AffiliateLinkToTripKit_B_fkey" FOREIGN KEY ("B") REFERENCES "TripKit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AffiliateLinkToKitSection" ADD CONSTRAINT "_AffiliateLinkToKitSection_A_fkey" FOREIGN KEY ("A") REFERENCES "AffiliateLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AffiliateLinkToKitSection" ADD CONSTRAINT "_AffiliateLinkToKitSection_B_fkey" FOREIGN KEY ("B") REFERENCES "KitSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
