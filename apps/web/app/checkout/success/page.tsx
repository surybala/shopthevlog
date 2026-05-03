import Link from 'next/link'
import { Suspense } from 'react'

export const metadata = {
  title: 'Subscription Confirmed — TripKits',
}

function SuccessContent({
  searchParams,
}: {
  searchParams: { creator?: string; session_id?: string }
}) {
  const creatorHandle = searchParams.creator

  return (
    <div className="editorial-shell min-h-screen flex items-center justify-center px-6 text-[#17332d]">
      <div className="editorial-card max-w-md w-full p-10 text-center">
        {/* Checkmark */}
        <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-8 h-8 text-green-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="mb-3 text-2xl font-bold text-[#17332d]">You&apos;re subscribed!</h1>
        <p className="editorial-subtle mb-8 text-sm leading-relaxed">
          Your subscription is active. You now have access to all premium Trip Kits and exclusive
          content. A receipt has been sent to your email.
        </p>

        <div className="space-y-3">
          {creatorHandle && (
            <Link
              href={`/@${creatorHandle}/kits`}
              className="btn-primary w-full inline-flex justify-center"
            >
              Browse {creatorHandle}&apos;s Trip Kits
            </Link>
          )}
          <Link
            href="/account?tab=subscriptions"
            className="btn-ghost w-full inline-flex justify-center"
          >
            Manage subscriptions
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: { creator?: string; session_id?: string }
}) {
  return (
    <Suspense fallback={null}>
      <SuccessContent searchParams={searchParams} />
    </Suspense>
  )
}
