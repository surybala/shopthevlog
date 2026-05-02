import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { getOrCreateSubscriber } from '@/lib/subscriber'
import { requireString, validationErrorResponse } from '@/lib/validate'
import { rateLimit } from '@/lib/rateLimit'
import { recordApiObservation } from '@/lib/observability'

// POST /api/account/follow
// Body: { creatorHandle: string }
export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const record = (status: number, detail?: string) => {
    recordApiObservation('/api/account/follow', status, Date.now() - startedAt, detail)
  }

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    record(401, 'unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (rateLimit(user.id, 'follow:create', { limit: 30, windowMs: 60_000 })) {
    record(429, 'rate_limited')
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let creatorHandle: string
  try {
    const body = await req.json()
    creatorHandle = requireString(body.creatorHandle, 'creatorHandle', { max: 30 })
  } catch (e) {
    const ve = validationErrorResponse(e)
    if (ve) {
      record(422, 'validation_error')
      return NextResponse.json(ve, { status: 422 })
    }
    record(400, 'invalid_request_body')
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const creator = await prisma.creator.findUnique({
    where: { handle: creatorHandle },
    select: { id: true, isPublished: true },
  })
  if (!creator || !creator.isPublished) {
    record(404, 'creator_missing')
    return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
  }

  // Prevent self-follow
  const ownCreator = await prisma.creator.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (ownCreator?.id === creator.id) {
    record(422, 'self_follow_blocked')
    return NextResponse.json({ error: 'Cannot follow yourself' }, { status: 422 })
  }

  const subscriber = await getOrCreateSubscriber(user)

  await prisma.follow.upsert({
    where: { subscriberId_creatorId: { subscriberId: subscriber.id, creatorId: creator.id } },
    update: {},
    create: { subscriberId: subscriber.id, creatorId: creator.id },
  })

  record(200, 'following_created')
  return NextResponse.json({ following: true })
}

// DELETE /api/account/follow?creatorHandle=...
export async function DELETE(req: NextRequest) {
  const startedAt = Date.now()
  const record = (status: number, detail?: string) => {
    recordApiObservation('/api/account/follow', status, Date.now() - startedAt, detail)
  }

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    record(401, 'unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const creatorHandle = req.nextUrl.searchParams.get('creatorHandle')
  if (!creatorHandle?.trim()) {
    record(422, 'creator_handle_required')
    return NextResponse.json({ error: 'creatorHandle is required' }, { status: 422 })
  }

  const creator = await prisma.creator.findUnique({
    where: { handle: creatorHandle },
    select: { id: true },
  })
  if (!creator) {
    record(404, 'creator_missing')
    return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
  }

  const subscriber = await prisma.subscriber.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!subscriber) {
    record(200, 'subscriber_missing')
    return NextResponse.json({ following: false })
  }

  await prisma.follow.deleteMany({
    where: { subscriberId: subscriber.id, creatorId: creator.id },
  })

  record(200, 'following_removed')
  return NextResponse.json({ following: false })
}

// GET /api/account/follow?creatorHandle=...
export async function GET(req: NextRequest) {
  const startedAt = Date.now()
  const record = (status: number, detail?: string) => {
    recordApiObservation('/api/account/follow', status, Date.now() - startedAt, detail)
  }

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    record(401, 'unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const creatorHandle = req.nextUrl.searchParams.get('creatorHandle')
  if (!creatorHandle?.trim()) {
    record(422, 'creator_handle_required')
    return NextResponse.json({ error: 'creatorHandle is required' }, { status: 422 })
  }

  const creator = await prisma.creator.findUnique({
    where: { handle: creatorHandle },
    select: { id: true },
  })
  if (!creator) {
    record(200, 'creator_missing')
    return NextResponse.json({ following: false })
  }

  const subscriber = await prisma.subscriber.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!subscriber) {
    record(200, 'subscriber_missing')
    return NextResponse.json({ following: false })
  }

  const follow = await prisma.follow.findUnique({
    where: { subscriberId_creatorId: { subscriberId: subscriber.id, creatorId: creator.id } },
    select: { id: true },
  })

  record(200, follow ? 'following_true' : 'following_false')
  return NextResponse.json({ following: !!follow })
}
