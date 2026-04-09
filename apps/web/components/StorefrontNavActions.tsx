'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import FollowButton from '@/components/FollowButton'

interface Props {
  creatorHandle: string
  initialFollowing: boolean
  isLoggedIn: boolean
  displayName: string | null
  accountHref: string
}

export default function StorefrontNavActions({
  creatorHandle,
  initialFollowing,
  isLoggedIn,
  displayName,
  accountHref,
}: Props) {
  const pathname = usePathname()
  const showFollowButton = pathname !== `/@${creatorHandle}/subscribe`

  return (
    <>
      {showFollowButton && (
        <FollowButton
          creatorHandle={creatorHandle}
          initialFollowing={initialFollowing}
          isLoggedIn={isLoggedIn}
          size="sm"
        />
      )}
      {isLoggedIn && displayName ? (
        <Link
          href={accountHref}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/10 hover:border-white/30 hover:bg-white/5 transition-colors group"
        >
          <span className="w-5 h-5 rounded-full bg-white/20 text-white text-[10px] font-semibold flex items-center justify-center leading-none group-hover:bg-white/30 transition-colors">
            {displayName[0]?.toUpperCase()}
          </span>
          <span className="text-xs text-white/60 group-hover:text-white transition-colors max-w-[100px] truncate hidden sm:inline">
            {displayName}
          </span>
        </Link>
      ) : (
        <Link
          href="/login"
          className="text-xs text-white/40 hover:text-white transition-colors"
        >
          Sign in
        </Link>
      )}
    </>
  )
}
