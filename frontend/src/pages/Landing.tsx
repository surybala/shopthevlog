import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import GlassCard from '../components/ui/GlassCard'
import GlassButton from '../components/ui/GlassButton'

const features = [
  {
    icon: '🎬',
    title: 'Connect your feeds',
    desc: 'Link your YouTube and Instagram accounts to pull travel vlogs you already love.',
  },
  {
    icon: '🗺️',
    title: 'AI builds your itinerary',
    desc: 'Claude transcribes the vlog and extracts a day-by-day shoppable travel plan.',
  },
  {
    icon: '✈️',
    title: 'Book the whole trip',
    desc: 'Flights, hotels, and experiences — all booked in one place via Duffel.',
  },
]

export default function Landing() {
  return (
    <div className="min-h-screen overflow-hidden">
      {/* Ambient blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-brand-500/20 blur-[120px] animate-float" />
        <div className="absolute top-1/3 -right-40 w-80 h-80 rounded-full bg-violet-500/15 blur-[120px] animate-float" style={{ animationDelay: '2s' }} />
        <div className="absolute bottom-0 left-1/3 w-96 h-96 rounded-full bg-blue-500/10 blur-[120px] animate-float" style={{ animationDelay: '4s' }} />
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-5">
        <span className="text-2xl font-bold text-gradient">shopthevlog</span>
        <div className="flex items-center gap-3">
          <Link to="/login"><GlassButton variant="ghost">Sign in</GlassButton></Link>
          <Link to="/signup"><GlassButton>Get started free</GlassButton></Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-5xl mx-auto px-8 pt-20 pb-24 text-center">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <span className="badge text-sm mb-6 inline-block">✨ Now in early access</span>
          <h1 className="text-5xl sm:text-7xl font-bold leading-tight mb-6">
            Watch a vlog.
            <br />
            <span className="text-gradient">Book the trip.</span>
          </h1>
          <p className="text-xl text-white/60 max-w-2xl mx-auto mb-10 leading-relaxed">
            shopthevlog turns any travel vlog into a complete, shoppable itinerary —
            with flights, hotels, and experiences ready to book in seconds.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/signup">
              <GlassButton size="lg">Start for free →</GlassButton>
            </Link>
            <Link to="/login">
              <GlassButton variant="glass" size="lg">Sign in</GlassButton>
            </Link>
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section className="relative z-10 max-w-5xl mx-auto px-8 pb-24">
        <div className="grid sm:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.12, duration: 0.5 }}
            >
              <GlassCard className="h-full">
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className="font-semibold text-white text-lg mb-2">{f.title}</h3>
                <p className="text-white/60 text-sm leading-relaxed">{f.desc}</p>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 max-w-3xl mx-auto px-8 pb-32 text-center">
        <GlassCard className="py-12">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to plan your next adventure?</h2>
          <p className="text-white/60 mb-8">Connect your accounts and get a personalised vlog feed in minutes.</p>
          <Link to="/signup">
            <GlassButton size="lg">Create your account →</GlassButton>
          </Link>
        </GlassCard>
      </section>
    </div>
  )
}
