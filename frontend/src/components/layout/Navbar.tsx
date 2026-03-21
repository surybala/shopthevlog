import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

const navLinks = [
  { to: '/feed',   label: 'Discover' },
  { to: '/trips',  label: 'My Trips' },
]

export default function Navbar() {
  const { profile, signOut } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-30 backdrop-blur-heavy border-b border-white/10 bg-black/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/feed" className="flex items-center gap-2">
            <span className="text-xl font-bold text-gradient">shopthevlog</span>
          </Link>

          {/* Nav links */}
          <div className="hidden sm:flex items-center gap-1">
            {navLinks.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  pathname.startsWith(to)
                    ? 'bg-white/15 text-white'
                    : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          {/* User menu */}
          <div className="flex items-center gap-3">
            <Link to="/profile" className="flex items-center gap-2 group">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={profile.display_name ?? 'Profile'}
                  className="w-8 h-8 rounded-full border-2 border-white/20 group-hover:border-brand-400 transition-colors"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-brand-500/40 border-2 border-white/20 flex items-center justify-center text-xs font-bold text-white/80 group-hover:border-brand-400 transition-colors">
                  {profile?.display_name?.[0]?.toUpperCase() ?? '?'}
                </div>
              )}
              <span className="hidden sm:block text-sm text-white/70 group-hover:text-white transition-colors">
                {profile?.display_name ?? 'Profile'}
              </span>
            </Link>
            <button onClick={handleSignOut} className="btn-ghost text-sm">
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}
