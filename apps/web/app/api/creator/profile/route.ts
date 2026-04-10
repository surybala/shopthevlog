import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import {
  optionalUrlArray,
  requireEnum,
  requireHandle,
  requireString,
  optionalString,
  optionalUrl,
  validationErrorResponse,
} from '@/lib/validate'
import { STOREFRONT_THEME_IDS } from '@/lib/storefrontThemes'

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (existing) return NextResponse.json({ error: 'Creator profile already exists' }, { status: 409 })

  let handle: string, displayName: string
  let bio: string | null, location: string | null, websiteUrl: string | null
  let storefrontTheme, storefrontTagline, storefrontIntro, storefrontMoodImageUrl, storefrontGalleryImages
  try {
    const body = await req.json()
    handle      = requireHandle(body.handle)
    displayName = requireString(body.displayName, 'displayName', { max: 80 })
    bio         = optionalString(body.bio, 'bio', { max: 500 })
    location    = optionalString(body.location, 'location', { max: 100 })
    websiteUrl  = optionalUrl(body.websiteUrl, 'websiteUrl')
    storefrontTheme = body.storefrontTheme === undefined
      ? 'CITY_EDITORIAL'
      : requireEnum(body.storefrontTheme, 'storefrontTheme', STOREFRONT_THEME_IDS)
    storefrontTagline = optionalString(body.storefrontTagline, 'storefrontTagline', { max: 120 })
    storefrontIntro = optionalString(body.storefrontIntro, 'storefrontIntro', { max: 400 })
    storefrontMoodImageUrl = optionalUrl(body.storefrontMoodImageUrl, 'storefrontMoodImageUrl')
    storefrontGalleryImages = optionalUrlArray(body.storefrontGalleryImages, 'storefrontGalleryImages', { maxItems: 6 })
  } catch (e) {
    const ve = validationErrorResponse(e)
    if (ve) return NextResponse.json(ve, { status: 422 })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const handleTaken = await prisma.creator.findUnique({ where: { handle } })
  if (handleTaken) return NextResponse.json({ error: 'Handle is already taken' }, { status: 409 })

  const creator = await prisma.creator.create({
    data: {
      userId: user.id,
      handle,
      displayName,
      bio,
      location,
      websiteUrl,
      storefrontTheme,
      storefrontTagline,
      storefrontIntro,
      storefrontMoodImageUrl,
      storefrontGalleryImages,
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

  let patch: Record<string, unknown>
  try {
    const body = await req.json()
    patch = {}
    if (body.handle      !== undefined) patch.handle      = requireHandle(body.handle)
    if (body.displayName !== undefined) patch.displayName = requireString(body.displayName, 'displayName', { max: 80 })
    if (body.bio         !== undefined) patch.bio         = optionalString(body.bio, 'bio', { max: 500 })
    if (body.location    !== undefined) patch.location    = optionalString(body.location, 'location', { max: 100 })
    if (body.websiteUrl  !== undefined) patch.websiteUrl  = optionalUrl(body.websiteUrl, 'websiteUrl')
    if (body.storefrontTheme !== undefined) patch.storefrontTheme = requireEnum(body.storefrontTheme, 'storefrontTheme', STOREFRONT_THEME_IDS)
    if (body.storefrontTagline !== undefined) patch.storefrontTagline = optionalString(body.storefrontTagline, 'storefrontTagline', { max: 120 })
    if (body.storefrontIntro !== undefined) patch.storefrontIntro = optionalString(body.storefrontIntro, 'storefrontIntro', { max: 400 })
    if (body.storefrontMoodImageUrl !== undefined) patch.storefrontMoodImageUrl = optionalUrl(body.storefrontMoodImageUrl, 'storefrontMoodImageUrl')
    if (body.storefrontGalleryImages !== undefined) patch.storefrontGalleryImages = optionalUrlArray(body.storefrontGalleryImages, 'storefrontGalleryImages', { maxItems: 6 })
    // Booleans — no length concern but validate type
    if (body.isPublished !== undefined) {
      if (typeof body.isPublished !== 'boolean') throw new Error('isPublished must be a boolean')
      patch.isPublished = body.isPublished
    }
    // Image URLs
    if (body.avatarUrl     !== undefined) patch.avatarUrl     = optionalUrl(body.avatarUrl, 'avatarUrl')
    if (body.coverImageUrl !== undefined) patch.coverImageUrl = optionalUrl(body.coverImageUrl, 'coverImageUrl')
  } catch (e) {
    const ve = validationErrorResponse(e)
    if (ve) return NextResponse.json(ve, { status: 422 })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid request body' }, { status: 400 })
  }

  if (patch.handle && patch.handle !== creator.handle) {
    const taken = await prisma.creator.findUnique({ where: { handle: patch.handle as string } })
    if (taken) return NextResponse.json({ error: 'Handle is already taken' }, { status: 409 })
  }

  const updated = await prisma.creator.update({ where: { id: creator.id }, data: patch })
  return NextResponse.json(updated)
}
