import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createSupabaseServer } from '@/lib/supabase/server'
import { isAdminUser } from '@/lib/admin'
import prisma from '@/lib/prisma/client'
import { resolveStorageAssetUrl } from '@/lib/storageAssets'
import DashboardNav from './DashboardNav'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  const admin = isAdminUser(user)

  return (
    <div className="editorial-shell flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-[#17332d]/10 bg-[rgba(255,248,240,0.78)] shadow-[inset_-1px_0_0_rgba(23,51,45,0.06)] backdrop-blur-xl">
        <div className="flex h-16 items-center border-b border-[#17332d]/10 px-6">
          <Link href="/" className="flex items-center gap-2">
              <Image src="/logo.png" alt="VlogShopper" width={28} height={28} className="rounded-md" />
              <span className="text-lg font-bold text-[#17332d]">VlogShopper</span>
            </Link>
        </div>

        <DashboardNav handle={creator?.handle ?? null} isAdmin={admin} />

        <div className="mt-auto border-t border-[#17332d]/10 bg-[rgba(255,255,255,0.36)] p-4">
          <div className="flex items-center gap-3">
            {creator?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resolveStorageAssetUrl(creator.avatarUrl) ?? ''} alt="" className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#17332d]/12 bg-[#17332d]/8 text-xs font-semibold text-[#17332d]/85">
                {creator?.displayName?.[0]?.toUpperCase() ?? user.email?.[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#17332d]">{creator?.displayName ?? user.email}</p>
              <p className="truncate text-xs text-[#17332d]/62">{creator ? `@${creator.handle}` : 'No creator profile'}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
