import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { requireString, requireUrl, optionalString, validationErrorResponse } from '@/lib/validate'
import { rateLimit } from '@/lib/rateLimit'

// ─── Crypto short code (replaces Math.random()) ───────────────────────────────
function generateShortCode(): string {
  // 6 bytes → 8 base64url chars → slice to 7 for readability; collision-safe
  return randomBytes(6).toString('base64url').substring(0, 7).toUpperCase()
}

// ─── Provider / type detection ────────────────────────────────────────────────
function detectProvider(url: string): string {
  if (url.includes('booking.com'))              return 'BOOKING_COM'
  if (url.includes('getyourguide.'))            return 'GETYOURGUIDE'
  if (url.includes('viator.com'))               return 'VIATOR'
  if (url.includes('amazon.com') || url.includes('amzn.to')) return 'AMAZON'
  if (url.includes('skyscanner.'))              return 'SKYSCANNER'
  if (url.includes('klook.com'))                return 'KLOOK'
  if (url.includes('airbnb.com'))               return 'AIRBNB'
  if (url.includes('expedia.com'))              return 'EXPEDIA'
  if (url.includes('stay22.com'))               return 'STAY22'
  if (url.includes('google.com/travel'))        return 'GOOGLE_FLIGHTS'
  return 'CUSTOM'
}

function detectLinkType(provider: string, activityType?: string): string {
  if (activityType === 'ACCOMMODATION' || ['BOOKING_COM', 'EXPEDIA', 'STAY22', 'AIRBNB'].includes(provider))
    return 'HOTEL'
  if (activityType === 'FOOD')     return 'RESTAURANT'
  if (activityType === 'TRANSPORT') return 'TRANSPORT'
  if (['GETYOURGUIDE', 'VIATOR', 'KLOOK'].includes(provider)) return 'EXPERIENCE_TOUR'
  if (provider === 'AMAZON')       return 'GEAR_PRODUCT'
  if (['SKYSCANNER', 'GOOGLE_FLIGHTS'].includes(provider)) return 'FLIGHT_SEARCH'
  return 'CUSTOM'
}

// ─── POST /api/affiliate-links ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) return NextResponse.json({ error: 'No creator profile' }, { status: 403 })

  if (rateLimit(user.id, 'affiliate-links:create', { limit: 60, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let targetName: string, targetUrl: string, activityType: string | null
  try {
    const body = await req.json()
    targetName   = requireString(body.targetName, 'targetName', { max: 200 })
    targetUrl    = requireUrl(body.targetUrl, 'targetUrl')
    activityType = optionalString(body.activityType, 'activityType', { max: 50 })
  } catch (e) {
    const ve = validationErrorResponse(e)
    if (ve) return NextResponse.json(ve, { status: 422 })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const provider = detectProvider(targetUrl)
  const type     = detectLinkType(provider, activityType ?? undefined)

  // Generate collision-free short code
  let shortCode = generateShortCode()
  for (let attempt = 0; attempt < 5; attempt++) {
    const exists = await prisma.affiliateLink.findUnique({ where: { shortCode } })
    if (!exists) break
    shortCode = generateShortCode()
  }

  const link = await prisma.affiliateLink.create({
    data: {
      creatorId: creator.id,
      type: type as never,
      targetName,
      targetUrl,
      affiliateUrl: targetUrl,   // provider params injected at redirect time
      shortCode,
      provider: provider as never,
    },
  })

  return NextResponse.json(link, { status: 201 })
}

// ─── GET /api/affiliate-links ─────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) return NextResponse.json({ error: 'No creator profile' }, { status: 403 })

  // Limit search query length to avoid DB abuse
  const raw = req.nextUrl.searchParams.get('q') ?? ''
  const q = raw.slice(0, 100)

  const links = await prisma.affiliateLink.findMany({
    where: {
      creatorId: creator.id,
      isActive: true,
      ...(q && { targetName: { contains: q, mode: 'insensitive' } }),
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true, targetName: true, shortCode: true,
      provider: true, affiliateUrl: true, type: true,
    },
  })

  return NextResponse.json({ links })
}
