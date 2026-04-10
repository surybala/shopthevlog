import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import KitEditor from '../KitEditor'

export default async function NewKitPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) redirect('/dashboard')

  return (
    <div className="p-8">
      <div className="dashboard-mirror-panel mb-8 max-w-5xl p-6">
        <p className="dashboard-mirror-kicker text-xs">Trip Kit Studio</p>
        <h1 className="mt-3 text-3xl font-bold text-white">Create a new Trip Kit.</h1>
        <p className="dashboard-mirror-subtle mt-2 text-sm">
          Turn a route, a vibe, and a few memorable stops into a polished guide your audience will want to save.
        </p>
      </div>
      <KitEditor creatorId={creator.id} creatorHandle={creator.handle} kit={null} />
    </div>
  )
}
