import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

async function getCreatorKit(user: { id: string }, kitId: string) {
  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) return null
  const kit = await prisma.tripKit.findUnique({ where: { id: kitId } })
  if (!kit || kit.creatorId !== creator.id) return null
  return kit
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const kit = await getCreatorKit(user, params.id)
  if (!kit) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const updated = await prisma.tripKit.update({
    where: { id: params.id },
    data: {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.slug !== undefined && { slug: body.slug }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.primaryCity !== undefined && { primaryCity: body.primaryCity }),
      ...(body.countries !== undefined && { countries: body.countries }),
      ...(body.cities !== undefined && { cities: body.cities }),
      ...(body.durationDays !== undefined && { durationDays: body.durationDays }),
      ...(body.estimatedBudgetLow !== undefined && { estimatedBudgetLow: body.estimatedBudgetLow }),
      ...(body.estimatedBudgetHigh !== undefined && { estimatedBudgetHigh: body.estimatedBudgetHigh }),
      ...(body.accessTier !== undefined && { accessTier: body.accessTier }),
      ...(body.isPublished !== undefined && { isPublished: body.isPublished }),
      ...(body.isFeatured !== undefined && { isFeatured: body.isFeatured }),
      ...(body.coverImageUrl !== undefined && { coverImageUrl: body.coverImageUrl }),
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const kit = await getCreatorKit(user, params.id)
  if (!kit) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.tripKit.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
