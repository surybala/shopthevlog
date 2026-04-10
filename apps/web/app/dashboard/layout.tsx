import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createSupabaseServer } from '@/lib/supabase/server'
import { isAdminUser } from '@/lib/admin'
import prisma from '@/lib/prisma/client'
import DashboardNav from './DashboardNav'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  const admin = isAdminUser(user)

  return (
    <div className="min-h-screen bg-black flex">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-white/10 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-white/10">
          <Link href="/" className="flex items-center gap-2">
              <Image src="/logo.png" alt="VlogShopper" width={28} height={28} className="rounded-md" />
              <span className="text-lg font-bold text-white">VlogShopper</span>
            </Link>
        </div>

        <DashboardNav handle={creator?.handle ?? null} isAdmin={admin} />

        <div className="p-4 border-t border-white/10 mt-auto">
          <div className="flex items-center gap-3">
            {creator?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={creator.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs text-white/60">
                {creator?.displayName?.[0]?.toUpperCase() ?? user.email?.[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{creator?.displayName ?? user.email}</p>
              <p className="text-xs text-white/40 truncate">{creator ? `@${creator.handle}` : 'No creator profile'}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
