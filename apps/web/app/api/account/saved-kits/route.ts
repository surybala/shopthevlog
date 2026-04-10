import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { getOrCreateSubscriber } from '@/lib/subscriber'
import { requireString, validationErrorResponse } from '@/lib/validate'
import { rateLimit } from '@/lib/rateLimit'
import { recordApiObservation } from '@/lib/observability'

// POST /api/account/saved-kits
// Body: { kitId: string }
export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const record = (status: number, detail?: string) => {
    recordApiObservation('/api/account/saved-kits', status, Date.now() - startedAt, detail)
  }

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    record(401, 'unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (rateLimit(user.id, 'saved-kits:create', { limit: 60, windowMs: 60_000 })) {
    record(429, 'rate_limited')
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let kitId: string
  try {
    const body = await req.json()
    kitId = requireString(body.kitId, 'kitId', { max: 50 })
  } catch (e) {
    const ve = validationErrorResponse(e)
    if (ve) {
      record(422, 'validation_error')
      return NextResponse.json(ve, { status: 422 })
    }
    record(400, 'invalid_request_body')
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const kit = await prisma.tripKit.findUnique({
    where: { id: kitId },
    select: { id: true, isPublished: true },
  })
  if (!kit || !kit.isPublished) {
    record(404, 'kit_missing')
    return NextResponse.json({ error: 'Kit not found' }, { status: 404 })
  }

  const subscriber = await getOrCreateSubscriber(user)

  await prisma.savedKit.upsert({
    where: { subscriberId_tripKitId: { subscriberId: subscriber.id, tripKitId: kitId } },
    update: {},
    create: { subscriberId: subscriber.id, tripKitId: kitId },
  })

  // Increment kit's saveCount (fire-and-forget)
  void prisma.tripKit.update({
    where: { id: kitId },
    data: { saveCount: { increment: 1 } },
  }).catch(() => {})

  record(200, 'saved_created')
  return NextResponse.json({ saved: true })
}

// DELETE /api/account/saved-kits?kitId=...
export async function DELETE(req: NextRequest) {
  const startedAt = Date.now()
  const record = (status: number, detail?: string) => {
    recordApiObservation('/api/account/saved-kits', status, Date.now() - startedAt, detail)
  }

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    record(401, 'unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const kitId = req.nextUrl.searchParams.get('kitId')
  if (!kitId?.trim()) {
    record(422, 'kit_id_required')
    return NextResponse.json({ error: 'kitId is required' }, { status: 422 })
  }

  const subscriber = await prisma.subscriber.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!subscriber) {
    record(200, 'subscriber_missing')
    return NextResponse.json({ saved: false })
  }

  await prisma.savedKit.deleteMany({
    where: { subscriberId: subscriber.id, tripKitId: kitId },
  })

  record(200, 'saved_removed')
  return NextResponse.json({ saved: false })
}

// GET /api/account/saved-kits
// Returns the list of kits saved by the current user.
export async function GET(req: NextRequest) {
  const startedAt = Date.now()
  const record = (status: number, detail?: string) => {
    recordApiObservation('/api/account/saved-kits', status, Date.now() - startedAt, detail)
  }

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    record(401, 'unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const subscriber = await prisma.subscriber.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!subscriber) {
    record(200, 'subscriber_missing')
    return NextResponse.json({ savedKits: [] })
  }

  const saved = await prisma.savedKit.findMany({
    where: { subscriberId: subscriber.id },
    orderBy: { savedAt: 'desc' },
    take: 50,
    include: {
      tripKit: {
        select: {
          id: true, title: true, slug: true, coverImageUrl: true,
          primaryCity: true, countries: true, durationDays: true,
          accessTier: true, estimatedBudgetLow: true,
          creator: { select: { handle: true, displayName: true, avatarUrl: true } },
        },
      },
    },
  })

  record(200, 'saved_list')
  return NextResponse.json({ savedKits: saved.map(s => ({ ...s.tripKit, savedAt: s.savedAt })) })
}
