import Link from 'next/link'

export const metadata = { title: 'Early Access — VlogShopper' }

export default function WaitlistPage() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md text-center space-y-6">
        {/* Logo / Brand */}
        <Link href="/" className="inline-block text-2xl font-bold text-white mb-2">
          VlogShopper
        </Link>

        {/* Icon */}
        <div className="text-6xl">🔒</div>

        {/* Heading */}
        <div>
          <h1 className="text-3xl font-bold text-white mb-3">
            Early access only
          </h1>
          <p className="text-white/50 leading-relaxed">
            VlogShopper is currently in private beta. We're rolling out access
            in waves — your email isn't on the current list yet.
          </p>
        </div>

        {/* Divider */}
        <div className="border-t border-white/10" />

        {/* What to do */}
        <div className="glass-card p-6 text-left space-y-4">
          <p className="text-sm font-medium text-white">What you can do:</p>
          <ul className="space-y-3 text-sm text-white/60">
            <li className="flex items-start gap-3">
              <span className="text-white/30 mt-0.5">→</span>
              <span>
                <strong className="text-white/80">Already have an invite?</strong>
                {' '}Make sure you're signing in with the exact email address that
                was invited.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-white/30 mt-0.5">→</span>
              <span>
                <strong className="text-white/80">Want early access?</strong>
                {' '}Email us at{' '}
                <a
                  href="mailto:hello@vlogshopper.com"
                  className="text-white underline underline-offset-2 hover:text-white/70"
                >
                  hello@vlogshopper.com
                </a>
                {' '}and we'll add you to the next wave.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-white/30 mt-0.5">→</span>
              <span>
                <strong className="text-white/80">Just browsing?</strong>
                {' '}You can still explore public creator storefronts — no account needed.
              </span>
            </li>
          </ul>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/discover" className="btn-primary text-sm px-6 py-2.5">
            Browse storefronts
          </Link>
          <Link href="/login" className="btn-ghost text-sm px-6 py-2.5">
            Try a different account
          </Link>
        </div>

        <p className="text-white/20 text-xs">
          © 2025 VlogShopper · Private beta
        </p>
      </div>
    </div>
  )
}
