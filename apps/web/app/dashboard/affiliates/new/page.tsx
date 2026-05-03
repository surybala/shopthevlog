import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import AffiliateLinkComposer from './AffiliateLinkComposer'

export default async function NewAffiliateLinkPage() {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) redirect('/dashboard')

  return (
    <div className="p-8">
      <div className="dashboard-mirror-panel mb-8 p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="dashboard-mirror-kicker text-xs">New affiliate link</p>
            <h1 className="mt-3 text-3xl font-bold text-[#17332d]">Add a monetized link to your creator portal.</h1>
            <p className="dashboard-mirror-subtle mt-2 max-w-2xl text-sm">
              Paste a partner URL you already have or let TripKits resolve a stay, experience, or flight into an affiliate-ready link.
            </p>
          </div>
          <Link href="/dashboard/affiliates" className="dashboard-action-chip text-sm">
            Back to affiliates
          </Link>
        </div>
      </div>

      <AffiliateLinkComposer />
    </div>
  )
}
