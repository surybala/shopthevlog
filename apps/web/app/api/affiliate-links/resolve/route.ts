import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { rateLimit } from '@/lib/rateLimit'
import { requireString, optionalString, validationErrorResponse } from '@/lib/validate'
import { createStay22Link, buildStay22FallbackUrl } from '@/lib/affiliates/stay22'
import { findGYGActivity, buildGYGFallbackUrl } from '@/lib/affiliates/gyg'
import { findViatorProduct, buildViatorFallbackUrl } from '@/lib/affiliates/viator'

// POST /api/affiliate-links/resolve
//
// Resolves a place (hotel, experience, etc.) to an affiliate link by calling
// the appropriate provider API. Creates and returns an AffiliateLink record.
//
// Body:
//   { name, city, country, type, lat?, lng?, kitId?, activityId? }
//
// type: 'accommodation' | 'experience' | 'flight'
//
// If the provider API fails or is unconfigured, falls back to a search URL
// so there's always a clickable link.

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

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) return NextResponse.json({ error: 'No creator profile' }, { status: 403 })

  if (rateLimit(user.id, 'affiliate-links:resolve', { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let name: string, city: string, type: string
  let country: string | null, lat: number | null, lng: number | null
  let kitId: string | null, activityId: string | null

  try {
    const body = await req.json()
    name       = requireString(body.name, 'name', { max: 200 })
    city       = requireString(body.city, 'city', { max: 100 })
    type       = requireString(body.type, 'type', { max: 50 })
    country    = optionalString(body.country, 'country', { max: 100 })
    lat        = typeof body.lat === 'number' ? body.lat : null
    lng        = typeof body.lng === 'number' ? body.lng : null
    kitId      = optionalString(body.kitId, 'kitId', { max: 50 })
    activityId = optionalString(body.activityId, 'activityId', { max: 50 })
  } catch (e) {
    const ve = validationErrorResponse(e)
    if (ve) return NextResponse.json(ve, { status: 422 })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const normalizedType = type.toLowerCase()

  let provider: string
  let linkType: string
  let affiliateUrl: string
  let providerProductId: string | null = null
  let resolvedName = name
  let priceFrom: string | undefined

  if (normalizedType === 'accommodation') {
    provider = 'STAY22'
    linkType = 'HOTEL'

    const result = await createStay22Link({
      name, city, country: country ?? '', lat: lat ?? undefined, lng: lng ?? undefined,
    })

    if (result) {
      affiliateUrl = result.affiliateUrl
      providerProductId = result.providerProductId
      resolvedName = result.hotelName
    } else {
      // Fallback: Stay22 search URL
      affiliateUrl = buildStay22FallbackUrl({ name, city, country: country ?? '' })
    }
  } else if (normalizedType === 'experience' || normalizedType === 'tour') {
    // Try GYG first, fall back to Viator
    const gyg = await findGYGActivity(name, city)
    if (gyg) {
      provider = 'GETYOURGUIDE'
      linkType = 'EXPERIENCE_TOUR'
      affiliateUrl = gyg.affiliateUrl
      providerProductId = gyg.providerProductId
      resolvedName = gyg.title
    } else {
      const viator = await findViatorProduct(name, city)
      if (viator) {
        provider = 'VIATOR'
        linkType = 'EXPERIENCE_TOUR'
        affiliateUrl = viator.affiliateUrl
        providerProductId = viator.providerProductId
        resolvedName = viator.title
        priceFrom = viator.priceFrom
      } else {
        // Fallback: GYG search URL
        provider = 'GETYOURGUIDE'
        linkType = 'EXPERIENCE_TOUR'
        affiliateUrl = buildGYGFallbackUrl(name, city)
      }
    }
  } else if (normalizedType === 'flight') {
    const skyscannerId = process.env.SKYSCANNER_AFFILIATE_ID ?? ''
    provider = 'SKYSCANNER'
    linkType = 'FLIGHT_SEARCH'
    const q = encodeURIComponent(`flights to ${city}`)
    affiliateUrl = `https://www.skyscanner.com/flights?query=${q}&associateId=${skyscannerId}`
  } else {
    return NextResponse.json({ error: 'type must be accommodation | experience | flight' }, { status: 422 })
  }

  const shortCode = await uniqueShortCode()

  const link = await prisma.affiliateLink.create({
    data: {
      creatorId: creator.id,
      type: linkType as never,
      targetName: resolvedName,
      targetUrl: affiliateUrl,
      affiliateUrl,
      shortCode,
      provider: provider as never,
      providerProductId,
      city,
      country,
      priceFrom,
      ...(kitId && {
        tripKits: { connect: { id: kitId } },
      }),
    },
  })

  // If an activityId was provided, wire the link to that DayActivity
  if (activityId) {
    await prisma.dayActivity.update({
      where: { id: activityId },
      data: { affiliateLinkId: link.id },
    }).catch(() => {
      // Non-fatal: activity may not exist or link already set
    })
  }

  return NextResponse.json(link, { status: 201 })
}
