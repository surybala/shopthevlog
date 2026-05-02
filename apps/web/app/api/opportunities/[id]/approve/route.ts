import { NextResponse } from 'next/server'
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

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const owned = await getOwnedOpportunity(params.id, user.id)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updated = await prisma.opportunity.update({
    where: { id: params.id },
    data: {
      reviewState: 'APPROVED',
      publishState: 'DRAFT',
    },
    select: {
      id: true,
      reviewState: true,
      publishState: true,
    },
  })

  await prisma.opportunityFeedback.create({
    data: {
      creatorId: owned.creator.id,
      opportunityId: params.id,
      action: 'APPROVED',
      editedFieldsJson: null,
      reason: null,
    },
  })

  const memoryEntries = buildCreatorMemoryEntries(owned.opportunity, 'APPROVED')
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
