import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import { buildCreatorMemoryEntries } from '@/lib/creatorMemory'

async function getOwnedOpportunity(opportunityId: string, userId: string) {
  const creator = await prisma.creator.findUnique({ where: { userId } })
  if (!creator) return null

  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    select: {
      id: true,
      creatorId: true,
      title: true,
      opportunityType: true,
      candidateEntity: {
        select: {
          canonicalLabel: true,
          rawLabel: true,
          entityType: true,
        },
      },
    },
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

  const memoryEntries = buildCreatorMemoryEntries(owned.opportunity, 'EDITED', {
    title,
    description: description || null,
  })
  await Promise.all(
    memoryEntries.map((entry) =>
      prisma.creatorMemory.upsert({
        where: {
          creatorId_memoryType_key: {
            creatorId: owned.creator.id,
            memoryType: entry.memoryType,
            key: entry.key,
          },
        },
        create: {
          creatorId: owned.creator.id,
          memoryType: entry.memoryType,
          key: entry.key,
          valueJson: entry.valueJson,
        },
        update: {
          valueJson: entry.valueJson,
        },
      })
    )
  )

  return NextResponse.json(updated)
}
