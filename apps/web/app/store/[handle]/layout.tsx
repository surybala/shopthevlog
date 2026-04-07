import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import prisma from '@/lib/prisma/client'
import { createSupabaseServer } from '@/lib/supabase/server'
import FollowButton from '@/components/FollowButton'

export default async function StorefrontLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { handle: string }
}) {
  const creator = await prisma.creator.findUnique({
    where: { handle: params.handle },
    select: { id: true, handle: true, displayName: true, avatarUrl: true, isPublished: true },
  })

  if (!creator) notFound()

  // Auth check — needed for preview gating + follow state
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  // If unpublished, only the creator themselves can preview it
  let isPreview = false
  if (!creator.isPublished) {
    if (!user) notFound()
    const ownCreator = await prisma.creator.findUnique({
      where: { userId: user.id },
      select: { id: true },
    })
    if (!ownCreator || ownCreator.id !== creator.id) notFound()
    isPreview = true
  }

  // Check current follow state for the nav button
  let initialFollowing = false
  if (user) {
    const subscriber = await prisma.subscriber.findUnique({
      where: { userId: user.id },
      select: { id: true },
    })
    if (subscriber) {
      const follow = await prisma.follow.findUnique({
        where: { subscriberId_creatorId: { subscriberId: subscriber.id, creatorId: creator.id } },
        select: { id: true },
      })
      initialFollowing = !!follow
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Preview banner */}
      {isPreview && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-6 py-2.5 flex items-center justify-between">
          <p className="text-xs text-yellow-400">
            Preview mode — this storefront is not yet published. Only you can see it.
          </p>
          <Link
            href="/dashboard/settings"
            className="text-xs text-yellow-400 hover:text-yellow-300 underline underline-offset-2"
          >
            Publish in Settings →
          </Link>
        </div>
      )}
      {/* Top nav */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur" style={isPreview ? { top: '41px' } : undefined}>
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-1.5 group">
            <Image src="/logo.png" alt="VlogShopper" width={24} height={24} className="rounded-md opacity-60 group-hover:opacity-100 transition-opacity" />
            <span className="text-sm font-semibold text-white/50 group-hover:text-white transition-colors">VlogShopper</span>
          </Link>
          <div className="flex items-center gap-2 text-sm text-white/50">
            <span>by</span>
            <Link href={`/@${creator.handle}`} className="font-medium text-white">
              {creator.displayName}
            </Link>
          </div>
          <div className="flex items-center gap-3">
            {!isPreview && (
              <FollowButton
                creatorHandle={creator.handle}
                initialFollowing={initialFollowing}
                isLoggedIn={!!user}
                size="sm"
              />
            )}
          </div>
        </div>
      </nav>
      <div className={isPreview ? 'pt-[97px]' : 'pt-14'}>{children}</div>
    </div>
  )
}
