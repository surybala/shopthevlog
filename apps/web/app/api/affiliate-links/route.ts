import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

function generateShortCode(): string {
  return Math.random().toString(36).substring(2, 9).toUpperCase()
}

function detectProvider(url: string): string {
  if (url.includes('booking.com'))     return 'BOOKING_COM'
  if (url.includes('getyourguide.'))   return 'GETYOURGUIDE'
  if (url.includes('viator.com'))      return 'VIATOR'
  if (url.includes('amazon.com') || url.includes('amzn.to')) return 'AMAZON'
  if (url.includes('skyscanner.'))     return 'SKYSCANNER'
  if (url.includes('klook.com'))       return 'KLOOK'
  if (url.includes('airbnb.com'))      return 'AIRBNB'
  if (url.includes('expedia.com'))     return 'EXPEDIA'
  if (url.includes('stay22.com'))      return 'STAY22'
  if (url.includes('google.com/travel')) return 'GOOGLE_FLIGHTS'
  return 'CUSTOM'
}

function detectLinkType(provider: string, activityType?: string): string {
  if (activityType === 'ACCOMMODATION' || ['BOOKING_COM', 'EXPEDIA', 'STAY22', 'AIRBNB'].includes(provider))
    return 'HOTEL'
  if (activityType === 'FOOD') return 'RESTAURANT'
  if (activityType === 'TRANSPORT') return 'TRANSPORT'
  if (['GETYOURGUIDE', 'VIATOR', 'KLOOK'].includes(provider)) return 'EXPERIENCE_TOUR'
  if (provider === 'AMAZON') return 'GEAR_PRODUCT'
  if (['SKYSCANNER', 'GOOGLE_FLIGHTS'].includes(provider)) return 'FLIGHT_SEARCH'
  return 'CUSTOM'
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) return NextResponse.json({ error: 'No creator profile' }, { status: 403 })

  const body = await req.json()
  const { targetName, targetUrl, activityType } = body

  if (!targetName || !targetUrl) {
    return NextResponse.json({ error: 'targetName and targetUrl are required' }, { status: 422 })
  }

  // Validate URL format
  try { new URL(targetUrl) } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 422 })
  }

  const provider = detectProvider(targetUrl)
  const type = detectLinkType(provider, activityType)

  // Generate unique shortCode (retry on collision — extremely unlikely)
  let shortCode = generateShortCode()
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await prisma.affiliateLink.findUnique({ where: { shortCode } })
    if (!existing) break
    shortCode = generateShortCode()
  }

  const link = await prisma.affiliateLink.create({
    data: {
      creatorId: creator.id,
      type: type as never,
      targetName,
      targetUrl,
      affiliateUrl: targetUrl,  // provider params injected at redirect time
      shortCode,
      provider: provider as never,
    },
  })

  return NextResponse.json(link, { status: 201 })
}

export async function GET(req: NextRequest) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) return NextResponse.json({ error: 'No creator profile' }, { status: 403 })

  const q = req.nextUrl.searchParams.get('q') ?? ''
  const links = await prisma.affiliateLink.findMany({
    where: {
      creatorId: creator.id,
      isActive: true,
      ...(q && { targetName: { contains: q, mode: 'insensitive' } }),
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, targetName: true, shortCode: true, provider: true, affiliateUrl: true, type: true },
  })

  return NextResponse.json({ links })
}
