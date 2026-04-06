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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">New Trip Kit</h1>
        <p className="text-white/40 mt-1 text-sm">Build a shoppable travel itinerary for your audience</p>
      </div>
      <KitEditor creatorId={creator.id} kit={null} />
    </div>
  )
}
