import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

async function getOwnedOpportunity(opportunityId: string, userId: string) {
  const creator = await prisma.creator.findUnique({ where: { userId } })
  if (!creator) return null

  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    select: { id: true, creatorId: true },
  })

  if (!opportunity || opportunity.creatorId !== creator.id) return null
  return { creator, opportunity }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const owned = await getOwnedOpportunity(params.id, user.id)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''

  if (!title) {
    return NextResponse.json({ error: 'Title is required' }, { status: 422 })
  }

  const updated = await prisma.opportunity.update({
    where: { id: params.id },
    data: {
      title,
      description: description || null,
      reviewState: 'EDITED',
      publishState: 'DRAFT',
    },
    select: {
      id: true,
      title: true,
      description: true,
      reviewState: true,
      publishState: true,
    },
  })

  await prisma.opportunityFeedback.create({
    data: {
      creatorId: owned.creator.id,
      opportunityId: params.id,
      action: 'EDITED',
      editedFieldsJson: {
        title,
        description: description || null,
      },
      reason: null,
    },
  })

  return NextResponse.json(updated)
}
