import { randomBytes } from 'crypto'
import prisma from '@/lib/prisma/client'
import { createStay22Link, buildStay22FallbackUrl } from '@/lib/affiliates/stay22'
import { findGYGActivity, buildGYGFallbackUrl } from '@/lib/affiliates/gyg'
import { findViatorProduct } from '@/lib/affiliates/viator'

export type AffiliateResolveType = 'accommodation' | 'experience' | 'flight'

type ResolveAffiliateLinkInput = {
  creatorId: string
  name: string
  city: string
  country?: string | null
  type: AffiliateResolveType
  lat?: number | null
  lng?: number | null
  kitId?: string | null
  activityId?: string | null
}

function generateShortCode(): string {
  return randomBytes(6).toString('base64url').substring(0, 7).toUpperCase()
}

async function uniqueShortCode(): Promise<string> {
  let code = generateShortCode()
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.affiliateLink.findUnique({ where: { shortCode: code } })
    if (!exists) return code
    code = generateShortCode()
  }
  return code
}

async function attachResolvedLink(linkId: string, input: Pick<ResolveAffiliateLinkInput, 'kitId' | 'activityId'>) {
  if (input.kitId) {
    await prisma.affiliateLink.update({
      where: { id: linkId },
      data: {
        tripKits: {
          connect: { id: input.kitId },
        },
      },
    }).catch(() => {
      // Safe no-op if already connected.
    })
  }

  if (input.activityId) {
    await prisma.dayActivity.update({
      where: { id: input.activityId },
      data: { affiliateLinkId: linkId },
    }).catch(() => {
      // Non-fatal: activity may have been removed or already attached.
    })
  }
}

export async function resolveAffiliateLink(input: ResolveAffiliateLinkInput) {
  let provider: string
  let linkType: string
  let affiliateUrl: string
  let providerProductId: string | null = null
  let resolvedName = input.name
  let priceFrom: string | undefined

  if (input.type === 'accommodation') {
    provider = 'STAY22'
    linkType = 'HOTEL'

    const result = await createStay22Link({
      name: input.name,
      city: input.city,
      country: input.country ?? '',
      lat: input.lat ?? undefined,
      lng: input.lng ?? undefined,
    })

    if (result) {
      affiliateUrl = result.affiliateUrl
      providerProductId = result.providerProductId
      resolvedName = result.hotelName
    } else {
      affiliateUrl = buildStay22FallbackUrl({
        name: input.name,
        city: input.city,
        country: input.country ?? '',
      })
    }
  } else if (input.type === 'experience') {
    const gyg = await findGYGActivity(input.name, input.city)
    if (gyg) {
      provider = 'GETYOURGUIDE'
      linkType = 'EXPERIENCE_TOUR'
      affiliateUrl = gyg.affiliateUrl
      providerProductId = gyg.providerProductId
      resolvedName = gyg.title
    } else {
      const viator = await findViatorProduct(input.name, input.city)
      if (viator) {
        provider = 'VIATOR'
        linkType = 'EXPERIENCE_TOUR'
        affiliateUrl = viator.affiliateUrl
        providerProductId = viator.providerProductId
        resolvedName = viator.title
        priceFrom = viator.priceFrom
      } else {
        provider = 'GETYOURGUIDE'
        linkType = 'EXPERIENCE_TOUR'
        affiliateUrl = buildGYGFallbackUrl(input.name, input.city)
      }
    }
  } else {
    const skyscannerId = process.env.SKYSCANNER_AFFILIATE_ID ?? ''
    provider = 'SKYSCANNER'
    linkType = 'FLIGHT_SEARCH'
    const q = encodeURIComponent(`flights to ${input.city}`)
    affiliateUrl = `https://www.skyscanner.com/flights?query=${q}&associateId=${skyscannerId}`
  }

  const existing = await prisma.affiliateLink.findFirst({
    where: {
      creatorId: input.creatorId,
      provider: provider as never,
      type: linkType as never,
      targetName: resolvedName,
      city: input.city,
      country: input.country ?? null,
      isActive: true,
    },
    select: {
      id: true,
    },
  })

  if (existing) {
    await attachResolvedLink(existing.id, input)
    return await prisma.affiliateLink.findUnique({ where: { id: existing.id } })
  }

  const shortCode = await uniqueShortCode()
  const created = await prisma.affiliateLink.create({
    data: {
      creatorId: input.creatorId,
      type: linkType as never,
      targetName: resolvedName,
      targetUrl: affiliateUrl,
      affiliateUrl,
      shortCode,
      provider: provider as never,
      providerProductId,
      city: input.city,
      country: input.country ?? null,
      priceFrom,
      ...(input.kitId
        ? {
            tripKits: {
              connect: { id: input.kitId },
            },
          }
        : {}),
    },
  })

  await attachResolvedLink(created.id, input)
  return created
}
