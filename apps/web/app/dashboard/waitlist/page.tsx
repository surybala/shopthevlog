import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { isAdminUser } from '@/lib/admin'
import prisma from '@/lib/prisma/client'
import WaitlistTable from './WaitlistTable'

export const metadata = { title: 'Waitlist - VlogShopper Dashboard' }

export default async function WaitlistAdminPage() {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login?next=/dashboard/waitlist')
  if (!isAdminUser(user)) redirect('/dashboard')

  const [pending, approved, rejected] = await Promise.all([
    prisma.waitlistRequest.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' } }),
    prisma.waitlistRequest.findMany({ where: { status: 'APPROVED' }, orderBy: { approvedAt: 'desc' } }),
    prisma.waitlistRequest.findMany({ where: { status: 'REJECTED' }, orderBy: { rejectedAt: 'desc' } }),
  ])

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-6 py-10">
      <div className="dashboard-mirror-panel p-6">
        <p className="dashboard-mirror-kicker text-xs">Access Control</p>
        <h1 className="mt-3 text-3xl font-bold text-white">Manage your private beta queue.</h1>
        <p className="dashboard-mirror-subtle mt-2 text-sm">
          {pending.length} pending · {approved.length} approved · {rejected.length} rejected
        </p>
      </div>

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white/50">Pending ({pending.length})</h2>
        {pending.length === 0 ? (
          <div className="dashboard-mirror-card p-5 text-sm text-[rgba(23,51,45,0.66)]">No pending requests.</div>
        ) : (
          <WaitlistTable requests={pending} showApprove />
        )}
      </section>

      {approved.length > 0 ? (
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white/50">Approved ({approved.length})</h2>
          <WaitlistTable requests={approved} />
        </section>
      ) : null}

      {rejected.length > 0 ? (
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white/50">Rejected ({rejected.length})</h2>
          <WaitlistTable requests={rejected} />
        </section>
      ) : null}
    </div>
  )
}
