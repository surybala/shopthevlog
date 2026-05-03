import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import prisma from '@/lib/prisma/client'
import { createSupabaseServer } from '@/lib/supabase/server'
import StorefrontNavActions from '@/components/StorefrontNavActions'
import { getStorefrontTheme } from '@/lib/storefrontThemes'
import { resolveStorageAssetUrl } from '@/lib/storageAssets'

function navDisplayName(user: Awaited<ReturnType<ReturnType<typeof createSupabaseServer>['auth']['getUser']>>['data']['user']) {
  if (!user) return null
  return (
    user.user_metadata?.display_name ??
    user.user_metadata?.full_name ??
    user.user_metadata?.name ??
    user.email?.split('@')[0] ??
    'Account'
  )
}

export default async function StorefrontLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { handle: string }
}) {
  const creator = await prisma.creator.findUnique({
    where: { handle: params.handle },
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarUrl: true,
      isPublished: true,
      storefrontTheme: true,
    },
  })

  if (!creator) notFound()

  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()

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

  let initialFollowing = false
  let viewerIsCreator = false

  if (user) {
    const [subscriber, viewerCreator] = await Promise.all([
      prisma.subscriber.findUnique({ where: { userId: user.id }, select: { id: true } }),
      prisma.creator.findUnique({ where: { userId: user.id }, select: { id: true } }),
    ])

    viewerIsCreator = !!viewerCreator

    if (subscriber) {
      const follow = await prisma.follow.findUnique({
        where: { subscriberId_creatorId: { subscriberId: subscriber.id, creatorId: creator.id } },
        select: { id: true },
      })
      initialFollowing = !!follow
    }
  }

  const displayName = navDisplayName(user)
  const accountHref = viewerIsCreator ? '/dashboard' : '/account'
  const theme = getStorefrontTheme(creator.storefrontTheme)

  return (
    <div className="min-h-screen text-[var(--storefront-text)]" style={theme.cssVars}>
      {isPreview && (
        <div
          className="flex items-center justify-between border-b px-6 py-2.5"
          style={{ borderColor: 'var(--storefront-border)', background: 'var(--storefront-soft-bg)' }}
        >
          <p className="storefront-subtle text-xs">
            Preview mode - this storefront is not yet published. Only you can see it.
          </p>
          <Link
            href="/dashboard/settings"
            className="storefront-heading text-xs underline underline-offset-2"
          >
            Publish in Settings -&gt;
          </Link>
        </div>
      )}

      <nav
        className="fixed inset-x-0 top-0 z-50 border-b backdrop-blur"
        style={{
          ...(isPreview ? { top: '41px' } : undefined),
          borderColor: 'var(--storefront-border)',
          background: 'var(--storefront-nav-bg)',
        }}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="group flex items-center gap-1.5">
            <Image
              src="/logo.png"
              alt="VlogShopper"
              width={24}
              height={24}
              className="rounded-md opacity-60 transition-opacity group-hover:opacity-100"
            />
            <span className="storefront-muted text-sm font-semibold transition-colors group-hover:text-[var(--storefront-text)]">
              VlogShopper
            </span>
          </Link>

          <div className="storefront-muted flex items-center gap-2 text-sm">
            <span>by</span>
            <Link href={`/@${creator.handle}`} className="storefront-heading font-medium">
              {creator.displayName}
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <StorefrontNavActions
              creatorHandle={creator.handle}
              initialFollowing={!isPreview && initialFollowing}
              isLoggedIn={!!user}
              displayName={displayName}
              accountHref={accountHref}
            />
          </div>
        </div>
      </nav>

      <div className={isPreview ? 'pt-[97px]' : 'pt-14'}>{children}</div>
    </div>
  )
}
