import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import WaitlistTable from './WaitlistTable'

export const metadata = { title: 'Waitlist — VlogShopper Dashboard' }

export default async function WaitlistAdminPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/waitlist')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (!creator) redirect('/dashboard')

  const [pending, approved, rejected] = await Promise.all([
    prisma.waitlistRequest.findMany({ where: { status: 'PENDING' },  orderBy: { createdAt: 'desc' } }),
    prisma.waitlistRequest.findMany({ where: { status: 'APPROVED' }, orderBy: { approvedAt: 'desc' } }),
    prisma.waitlistRequest.findMany({ where: { status: 'REJECTED' }, orderBy: { rejectedAt: 'desc' } }),
  ])

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-white">Waitlist</h1>
        <p className="text-white/40 text-sm mt-1">
          {pending.length} pending · {approved.length} approved · {rejected.length} rejected
        </p>
      </div>

      {/* Pending */}
      <section>
        <h2 className="text-sm font-semibold text-white/50 uppercase tracking-wider mb-4">
          Pending ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-white/30 text-sm">No pending requests.</p>
        ) : (
          <WaitlistTable requests={pending} showApprove />
        )}
      </section>

      {/* Approved */}
      {approved.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-white/50 uppercase tracking-wider mb-4">
            Approved ({approved.length})
          </h2>
          <WaitlistTable requests={approved} />
        </section>
      )}

      {/* Rejected */}
      {rejected.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-white/50 uppercase tracking-wider mb-4">
            Rejected ({rejected.length})
          </h2>
          <WaitlistTable requests={rejected} />
        </section>
      )}
    </div>
  )
}
