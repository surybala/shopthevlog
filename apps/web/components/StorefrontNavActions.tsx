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
          className="creator portal-account-pill group"
        >
          <span className="creator portal-account-avatar">
            {displayName[0]?.toUpperCase()}
          </span>
          <span className="max-w-[100px] truncate text-xs hidden sm:inline">
            {displayName}
          </span>
        </Link>
      ) : (
        <Link
          href="/login"
          className="creator portal-muted text-xs transition-colors hover:text-[var(--creator portal-text)]"
        >
          Sign in
        </Link>
      )}
    </>
  )
}
