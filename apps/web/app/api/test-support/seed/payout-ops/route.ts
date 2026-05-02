import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { isE2EAuthEnabled } from '@/lib/e2eAuth'

const CREATOR_ID = 'e2e-creator-payout-ops'
const CREATOR_HANDLE = 'payout-qa-creator'
const SUBSCRIBER_ID = 'e2e-subscriber-payout-ops'
const TIER_ID = 'e2e-tier-payout-ops'
const TRIP_KIT_ID = 'e2e-tripkit-payout-ops'
const LINK_PENDING_ID = 'e2e-link-payout-ops-pending'
const LINK_CONFIRMED_ID = 'e2e-link-payout-ops-confirmed'
const LINK_PAID_ID = 'e2e-link-payout-ops-paid'
const COMMISSION_PENDING_ID = 'e2e-commission-payout-ops-pending'
const COMMISSION_CONFIRMED_ID = 'e2e-commission-payout-ops-confirmed'
const COMMISSION_PAID_ID = 'e2e-commission-payout-ops-paid'

export async function POST(req: Request) {
  if (!isE2EAuthEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const creatorUserId = typeof body.creatorUserId === 'string' && body.creatorUserId.trim()
    ? body.creatorUserId.trim()
    : 'e2e-user-payout-ops-creator'

  await prisma.$transaction(async (tx) => {
    await tx.commission.deleteMany({
      where: {
        id: {
          in: [COMMISSION_PENDING_ID, COMMISSION_CONFIRMED_ID, COMMISSION_PAID_ID],
        },
      },
    })

    await tx.subscription.deleteMany({ where: { subscriberId: SUBSCRIBER_ID, creatorId: CREATOR_ID } })
    await tx.subscriptionTier.deleteMany({ where: { id: TIER_ID } })
    await tx.affiliateLink.deleteMany({
      where: {
        id: {
          in: [LINK_PENDING_ID, LINK_CONFIRMED_ID, LINK_PAID_ID],
        },
      },
    })
    await tx.tripKit.deleteMany({ where: { id: TRIP_KIT_ID } })

    await tx.subscriber.upsert({
      where: { id: SUBSCRIBER_ID },
      update: {
        userId: `${creatorUserId}-subscriber`,
        displayName: 'Payout QA Subscriber',
      },
      create: {
        id: SUBSCRIBER_ID,
        userId: `${creatorUserId}-subscriber`,
        displayName: 'Payout QA Subscriber',
      },
    })

    await tx.creator.upsert({
      where: { id: CREATOR_ID },
      update: {
        userId: creatorUserId,
        handle: CREATOR_HANDLE,
        displayName: 'Payout QA Creator',
        bio: 'Deterministic creator for payout ops E2E coverage.',
        isPublished: true,
        payoutsEnabled: false,
        stripeAccountId: null,
      },
      create: {
        id: CREATOR_ID,
        userId: creatorUserId,
        handle: CREATOR_HANDLE,
        displayName: 'Payout QA Creator',
        bio: 'Deterministic creator for payout ops E2E coverage.',
        isPublished: true,
        payoutsEnabled: false,
      },
    })

    await tx.tripKit.create({
      data: {
        id: TRIP_KIT_ID,
        creatorId: CREATOR_ID,
        title: 'Bangkok Weekend Food Sprint',
        slug: 'bangkok-weekend-food-sprint',
        description: 'Seeded kit for payout ops browser QA.',
        countries: ['Thailand'],
        cities: ['Bangkok'],
        primaryCity: 'Bangkok',
        isPublished: true,
        generatedByAI: true,
      },
    })

    await tx.subscriptionTier.create({
      data: {
        id: TIER_ID,
        creatorId: CREATOR_ID,
        name: 'Subscriber',
        monthlyPrice: 1200,
        yearlyPrice: 12000,
        kitAccess: 'PREMIUM',
      },
    })

    await tx.subscription.create({
      data: {
        subscriberId: SUBSCRIBER_ID,
        creatorId: CREATOR_ID,
        tierId: TIER_ID,
        status: 'ACTIVE',
        billingPeriod: 'MONTHLY',
        currentPeriodStart: new Date('2026-04-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-05-01T00:00:00.000Z'),
      },
    })

    await tx.affiliateLink.createMany({
      data: [
        {
          id: LINK_PENDING_ID,
          creatorId: CREATOR_ID,
          type: 'HOTEL',
          targetName: 'Riverside Hotel Bangkok',
          targetUrl: 'https://example.com/riverside-hotel',
          affiliateUrl: 'https://partners.example.com/riverside-hotel',
          shortCode: 'E2EPAY1',
          provider: 'BOOKING_COM',
          clickCount: 11,
          conversionCount: 1,
          totalEarnings: 0,
        },
        {
          id: LINK_CONFIRMED_ID,
          creatorId: CREATOR_ID,
          type: 'EXPERIENCE_TOUR',
          targetName: 'Street Food Crawl',
          targetUrl: 'https://example.com/street-food-crawl',
          affiliateUrl: 'https://partners.example.com/street-food-crawl',
          shortCode: 'E2EPAY2',
          provider: 'GETYOURGUIDE',
          clickCount: 18,
          conversionCount: 2,
          totalEarnings: 38,
        },
        {
          id: LINK_PAID_ID,
          creatorId: CREATOR_ID,
          type: 'TRANSPORT',
          targetName: 'Airport Transfer',
          targetUrl: 'https://example.com/airport-transfer',
          affiliateUrl: 'https://partners.example.com/airport-transfer',
          shortCode: 'E2EPAY3',
          provider: 'VIATOR',
          clickCount: 9,
          conversionCount: 1,
          totalEarnings: 21,
        },
      ],
    })

    await tx.commission.createMany({
      data: [
        {
          id: COMMISSION_PENDING_ID,
          creatorId: CREATOR_ID,
          affiliateLinkId: LINK_PENDING_ID,
          provider: 'BOOKING_COM',
          externalConversionId: 'e2e-payout-ops-conv-pending',
          grossAmount: 21000,
          commissionAmount: 2800,
          platformFee: 400,
          creatorEarnings: 2400,
          currency: 'USD',
          attributedTripKitId: TRIP_KIT_ID,
          attributionMethod: 'UNIQUE_LINK',
          status: 'PENDING',
          convertedAt: new Date('2026-04-10T00:00:00.000Z'),
        },
        {
          id: COMMISSION_CONFIRMED_ID,
          creatorId: CREATOR_ID,
          affiliateLinkId: LINK_CONFIRMED_ID,
          provider: 'GETYOURGUIDE',
          externalConversionId: 'e2e-payout-ops-conv-confirmed',
          grossAmount: 18000,
          commissionAmount: 2200,
          platformFee: 200,
          creatorEarnings: 2000,
          currency: 'USD',
          attributedTripKitId: TRIP_KIT_ID,
          attributionMethod: 'EXACT_PARTNER_REF',
          status: 'CONFIRMED',
          convertedAt: new Date('2026-04-11T00:00:00.000Z'),
        },
        {
          id: COMMISSION_PAID_ID,
          creatorId: CREATOR_ID,
          affiliateLinkId: LINK_PAID_ID,
          provider: 'VIATOR',
          externalConversionId: 'e2e-payout-ops-conv-paid',
          grossAmount: 12000,
          commissionAmount: 1600,
          platformFee: 100,
          creatorEarnings: 1500,
          currency: 'USD',
          attributedTripKitId: TRIP_KIT_ID,
          attributionMethod: 'UNIQUE_LINK',
          status: 'PAID',
          convertedAt: new Date('2026-04-08T00:00:00.000Z'),
          paidAt: new Date('2026-04-15T00:00:00.000Z'),
        },
      ],
    })
  })

  return NextResponse.json({
    ok: true,
    creatorUserId,
    creatorHandle: CREATOR_HANDLE,
    creatorPayoutsUrl: '/dashboard/payouts',
    adminPayoutOpsUrl: '/dashboard/payout-ops',
  })
}
