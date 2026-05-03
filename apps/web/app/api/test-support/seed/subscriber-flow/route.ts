import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { isE2EAuthEnabled } from '@/lib/e2eAuth'

const CREATOR_ID = 'e2e-creator-subscriber-flow'
const CREATOR_HANDLE = 'qa-subscriber-e2e'
const FREE_KIT_ID = 'e2e-kit-subscriber-free'
const FOLLOWER_KIT_ID = 'e2e-kit-subscriber-follower'
const PREMIUM_KIT_ID = 'e2e-kit-subscriber-premium'
const FOLLOWER_TIER_ID = 'e2e-tier-subscriber-follower'
const PREMIUM_TIER_ID = 'e2e-tier-subscriber-premium'

type SeedMode = 'base' | 'premium'

function getMode(raw: unknown): SeedMode {
  return raw === 'premium' ? 'premium' : 'base'
}

export async function POST(req: Request) {
  if (!isE2EAuthEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const userId = typeof body.userId === 'string' && body.userId.trim()
    ? body.userId.trim()
    : 'e2e-user-subscriber-flow'
  const mode = getMode(body.mode)

  await prisma.$transaction(async (tx) => {
    await tx.subscription.deleteMany({ where: { creatorId: CREATOR_ID } })
    await tx.follow.deleteMany({ where: { creatorId: CREATOR_ID } })
    await tx.savedKit.deleteMany({
      where: {
        tripKitId: { in: [FREE_KIT_ID, FOLLOWER_KIT_ID, PREMIUM_KIT_ID] },
      },
    })
    await tx.dayActivity.deleteMany({
      where: {
        day: {
          tripKitId: { in: [FREE_KIT_ID, FOLLOWER_KIT_ID, PREMIUM_KIT_ID] },
        },
      },
    })
    await tx.itineraryDay.deleteMany({
      where: {
        tripKitId: { in: [FREE_KIT_ID, FOLLOWER_KIT_ID, PREMIUM_KIT_ID] },
      },
    })
    await tx.tripKit.deleteMany({
      where: {
        id: { in: [FREE_KIT_ID, FOLLOWER_KIT_ID, PREMIUM_KIT_ID] },
      },
    })
    await tx.subscriptionTier.deleteMany({
      where: {
        id: { in: [FOLLOWER_TIER_ID, PREMIUM_TIER_ID] },
      },
    })

    await tx.creator.upsert({
      where: { id: CREATOR_ID },
      update: {
        userId: 'e2e-creator-owner-subscriber-flow',
        handle: CREATOR_HANDLE,
        displayName: 'Subscriber QA Creator',
        bio: 'Creator account used for subscriber Playwright coverage.',
        isPublished: true,
        isVerified: true,
      },
      create: {
        id: CREATOR_ID,
        userId: 'e2e-creator-owner-subscriber-flow',
        handle: CREATOR_HANDLE,
        displayName: 'Subscriber QA Creator',
        bio: 'Creator account used for subscriber Playwright coverage.',
        isPublished: true,
        isVerified: true,
      },
    })

    const subscriber = await tx.subscriber.upsert({
      where: { userId },
      update: {
        displayName: mode === 'premium' ? 'Premium Subscriber' : 'Follower Subscriber',
      },
      create: {
        userId,
        displayName: mode === 'premium' ? 'Premium Subscriber' : 'Follower Subscriber',
      },
      select: { id: true },
    })

    await tx.subscriptionTier.createMany({
      data: [
        {
          id: FOLLOWER_TIER_ID,
          creatorId: CREATOR_ID,
          name: 'Free Follow',
          description: 'Follower-tier access for subscriber E2E.',
          monthlyPrice: 0,
          kitAccess: 'FOLLOWER',
          perks: ['Follower kits unlocked'],
          isActive: true,
          sortOrder: 0,
        },
        {
          id: PREMIUM_TIER_ID,
          creatorId: CREATOR_ID,
          name: 'Premium Insider',
          description: 'Premium access for subscriber E2E.',
          monthlyPrice: 999,
          kitAccess: 'PREMIUM',
          perks: ['Premium kits unlocked', 'Priority drops'],
          isActive: true,
          sortOrder: 1,
        },
      ],
      skipDuplicates: true,
    })

    await tx.tripKit.createMany({
      data: [
        {
          id: FREE_KIT_ID,
          creatorId: CREATOR_ID,
          title: 'Tokyo Free Starter',
          slug: 'tokyo-free-starter',
          description: 'Free kit for creator portal sanity checks.',
          countries: ['Japan'],
          cities: ['Tokyo'],
          primaryCity: 'Tokyo',
          durationDays: 1,
          accessTier: 'FREE',
          isPublished: true,
          generatedByAI: true,
        },
        {
          id: FOLLOWER_KIT_ID,
          creatorId: CREATOR_ID,
          title: 'Tokyo Follow Unlock',
          slug: 'tokyo-follow-unlock',
          description: 'Follower-only kit for subscriber browser QA.',
          countries: ['Japan'],
          cities: ['Tokyo'],
          primaryCity: 'Tokyo',
          durationDays: 2,
          accessTier: 'FOLLOWER',
          isPublished: true,
          generatedByAI: true,
        },
        {
          id: PREMIUM_KIT_ID,
          creatorId: CREATOR_ID,
          title: 'Tokyo Premium Insider',
          slug: 'tokyo-premium-insider',
          description: 'Premium-only kit for subscriber browser QA.',
          countries: ['Japan'],
          cities: ['Tokyo'],
          primaryCity: 'Tokyo',
          durationDays: 3,
          accessTier: 'PREMIUM',
          isPublished: true,
          generatedByAI: true,
        },
      ],
      skipDuplicates: true,
    })

    await tx.itineraryDay.createMany({
      data: [
        {
          id: 'e2e-day-subscriber-free',
          tripKitId: FREE_KIT_ID,
          dayNumber: 1,
          title: 'Day 1',
          summary: 'Free starter day.',
          city: 'Tokyo',
          country: 'Japan',
          tips: [],
        },
        {
          id: 'e2e-day-subscriber-follower-1',
          tripKitId: FOLLOWER_KIT_ID,
          dayNumber: 1,
          title: 'Day 1',
          summary: 'Follower access day one.',
          city: 'Tokyo',
          country: 'Japan',
          tips: ['Unlocks after following'],
        },
        {
          id: 'e2e-day-subscriber-follower-2',
          tripKitId: FOLLOWER_KIT_ID,
          dayNumber: 2,
          title: 'Day 2',
          summary: 'Second day to prove the full itinerary unlocked.',
          city: 'Tokyo',
          country: 'Japan',
          tips: [],
        },
        {
          id: 'e2e-day-subscriber-premium-1',
          tripKitId: PREMIUM_KIT_ID,
          dayNumber: 1,
          title: 'Day 1',
          summary: 'Premium subscriber day one.',
          city: 'Tokyo',
          country: 'Japan',
          tips: ['Premium active'],
        },
        {
          id: 'e2e-day-subscriber-premium-2',
          tripKitId: PREMIUM_KIT_ID,
          dayNumber: 2,
          title: 'Day 2',
          summary: 'Premium subscriber day two.',
          city: 'Tokyo',
          country: 'Japan',
          tips: [],
        },
        {
          id: 'e2e-day-subscriber-premium-3',
          tripKitId: PREMIUM_KIT_ID,
          dayNumber: 3,
          title: 'Day 3',
          summary: 'Premium subscriber day three.',
          city: 'Tokyo',
          country: 'Japan',
          tips: [],
        },
      ],
      skipDuplicates: true,
    })

    await tx.dayActivity.createMany({
      data: [
        {
          id: 'e2e-act-subscriber-free',
          dayId: 'e2e-day-subscriber-free',
          sortOrder: 0,
          title: 'Shibuya Walk',
          type: 'ATTRACTION',
        },
        {
          id: 'e2e-act-subscriber-follower-1',
          dayId: 'e2e-day-subscriber-follower-1',
          sortOrder: 0,
          title: 'Park Hyatt Tokyo',
          type: 'ACCOMMODATION',
        },
        {
          id: 'e2e-act-subscriber-follower-2',
          dayId: 'e2e-day-subscriber-follower-2',
          sortOrder: 0,
          title: 'Golden Gai',
          type: 'NIGHTLIFE',
        },
        {
          id: 'e2e-act-subscriber-premium-1',
          dayId: 'e2e-day-subscriber-premium-1',
          sortOrder: 0,
          title: 'Tsukiji Breakfast',
          type: 'FOOD',
        },
        {
          id: 'e2e-act-subscriber-premium-2',
          dayId: 'e2e-day-subscriber-premium-2',
          sortOrder: 0,
          title: 'Private Ryokan Transfer',
          type: 'TRANSPORT',
        },
        {
          id: 'e2e-act-subscriber-premium-3',
          dayId: 'e2e-day-subscriber-premium-3',
          sortOrder: 0,
          title: 'Hidden Cocktail Bar',
          type: 'NIGHTLIFE',
        },
      ],
      skipDuplicates: true,
    })

    if (mode === 'premium') {
      await tx.follow.create({
        data: {
          subscriberId: subscriber.id,
          creatorId: CREATOR_ID,
        },
      })
      await tx.subscription.create({
        data: {
          subscriberId: subscriber.id,
          creatorId: CREATOR_ID,
          tierId: PREMIUM_TIER_ID,
          status: 'ACTIVE',
          billingPeriod: 'MONTHLY',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      })
    }
  })

  return NextResponse.json({
    ok: true,
    userId,
    mode,
    creatorHandle: CREATOR_HANDLE,
    followerKitSlug: 'tokyo-follow-unlock',
    premiumKitSlug: 'tokyo-premium-insider',
    subscribeUrl: `/@${CREATOR_HANDLE}/subscribe`,
    accountUrl: '/account',
  })
}
