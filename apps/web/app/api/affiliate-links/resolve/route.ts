import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { rateLimit } from '@/lib/rateLimit'
import { requireString, optionalString, validationErrorResponse } from '@/lib/validate'
import { resolveAffiliateLink } from '@/lib/affiliateLinkResolver'

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
  if (!['accommodation', 'experience', 'tour', 'flight'].includes(normalizedType)) {
    return NextResponse.json({ error: 'type must be accommodation | experience | flight' }, { status: 422 })
  }

  const link = await resolveAffiliateLink({
    creatorId: creator.id,
    name,
    city,
    country,
    type: normalizedType === 'tour' ? 'experience' : normalizedType as 'accommodation' | 'experience' | 'flight',
    lat,
    lng,
    kitId,
    activityId,
  })

  return NextResponse.json(link, { status: 201 })
}
