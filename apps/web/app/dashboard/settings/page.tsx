import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import SettingsForm from './SettingsForm'

export default async function DashboardSettingsPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({
    where: { userId: user.id },
    include: { tiers: { orderBy: { sortOrder: 'asc' } } },
  })

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-white/40 mt-1 text-sm">Manage your profile, channels, and subscription tiers</p>
      </div>
      <SettingsForm
        userId={user.id}
        email={user.email ?? ''}
        creator={creator as Parameters<typeof SettingsForm>[0]['creator']}
      />
    </div>
  )
}
