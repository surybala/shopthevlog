import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import KitEditor from '../KitEditor'

export default async function EditKitPage({ params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) redirect('/dashboard')

  const kit = await prisma.tripKit.findUnique({
    where: { id: params.id },
    include: {
      days: {
        orderBy: { dayNumber: 'asc' },
        include: {
          activities: {
            orderBy: { sortOrder: 'asc' },
            include: { affiliateLink: true },
          },
        },
      },
      sections: { orderBy: { sortOrder: 'asc' } },
      affiliateLinks: { where: { isActive: true } },
    },
  })

  if (!kit || kit.creatorId !== creator.id) notFound()

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Edit Trip Kit</h1>
        <p className="text-white/40 mt-1 text-sm">{kit.title}</p>
      </div>
      <KitEditor
        creatorId={creator.id}
        creatorHandle={creator.handle}
        kit={kit as Parameters<typeof KitEditor>[0]['kit']}
      />
    </div>
  )
}
