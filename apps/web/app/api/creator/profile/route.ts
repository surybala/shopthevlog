import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (existing) return NextResponse.json({ error: 'Creator profile already exists' }, { status: 409 })

  const body = await req.json()
  const { handle, displayName, bio, location, websiteUrl } = body

  if (!handle || !displayName) return NextResponse.json({ error: 'handle and displayName are required' }, { status: 422 })

  const handleTaken = await prisma.creator.findUnique({ where: { handle } })
  if (handleTaken) return NextResponse.json({ error: 'Handle is already taken' }, { status: 409 })

  const creator = await prisma.creator.create({
    data: {
      userId: user.id,
      handle,
      displayName,
      bio: bio || null,
      location: location || null,
      websiteUrl: websiteUrl || null,
    },
  })

  return NextResponse.json(creator, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) return NextResponse.json({ error: 'Creator profile not found' }, { status: 404 })

  const body = await req.json()

  if (body.handle && body.handle !== creator.handle) {
    const taken = await prisma.creator.findUnique({ where: { handle: body.handle } })
    if (taken) return NextResponse.json({ error: 'Handle is already taken' }, { status: 409 })
  }

  const updated = await prisma.creator.update({
    where: { id: creator.id },
    data: {
      ...(body.handle !== undefined && { handle: body.handle }),
      ...(body.displayName !== undefined && { displayName: body.displayName }),
      ...(body.bio !== undefined && { bio: body.bio || null }),
      ...(body.location !== undefined && { location: body.location || null }),
      ...(body.websiteUrl !== undefined && { websiteUrl: body.websiteUrl || null }),
      ...(body.isPublished !== undefined && { isPublished: body.isPublished }),
      ...(body.avatarUrl !== undefined && { avatarUrl: body.avatarUrl }),
      ...(body.coverImageUrl !== undefined && { coverImageUrl: body.coverImageUrl }),
    },
  })

  return NextResponse.json(updated)
}
