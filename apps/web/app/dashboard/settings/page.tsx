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
      <div className="dashboard-mirror-panel mb-8 p-6">
        <p className="dashboard-mirror-kicker text-xs">Creator identity</p>
        <h1 className="mt-3 text-3xl font-bold text-[#17332d]">Settings</h1>
        <p className="dashboard-mirror-subtle mt-2 text-sm">Manage your profile, channels, storefront theme, and subscription tiers.</p>
      </div>
      <SettingsForm
        userId={user.id}
        email={user.email ?? ''}
        creator={creator as Parameters<typeof SettingsForm>[0]['creator']}
      />
    </div>
  )
}
