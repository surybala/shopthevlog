import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'

export async function GET() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creator = await prisma.creator.findUnique({
    where: { userId: user.id },
    select: { catalogScanStatus: true, lastCatalogScan: true, _count: { select: { vlogs: true } } },
  })
  if (!creator) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    status: creator.catalogScanStatus,
    lastCatalogScan: creator.lastCatalogScan,
    vlogCount: creator._count.vlogs,
  })
}
