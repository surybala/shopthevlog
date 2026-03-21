import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../lib/api'
import GlassCard from '../components/ui/GlassCard'
import GlassButton from '../components/ui/GlassButton'
import toast from 'react-hot-toast'

const TRAVEL_STYLES = ['Adventure', 'Luxury', 'Budget', 'Solo', 'Family', 'Backpacking', 'Cultural', 'Beach', 'City Break']
const DESTINATIONS = ['Japan', 'Italy', 'Southeast Asia', 'USA', 'France', 'New Zealand', 'Morocco', 'India', 'South America', 'Scandinavia']
const DURATIONS = ['Weekend', '1 week', '2 weeks', '3+ weeks']
const BUDGETS = [
  { value: 'budget', label: 'Budget', desc: 'Hostels, street food, local transport' },
  { value: 'mid', label: 'Mid-range', desc: 'Hotels, restaurants, occasional splurge' },
  { value: 'luxury', label: 'Luxury', desc: 'Premium experiences, 5-star stays' },
]

type Step = 'styles' | 'destinations' | 'budget' | 'connect' | 'building'

function ToggleChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
        selected ? 'bg-brand-500 text-white shadow-glow-indigo' : 'glass text-white/60 hover:text-white'
      }`}
    >
      {label}
    </button>
  )
}

export default function Onboarding() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('styles')
  const [styles, setStyles] = useState<string[]>([])
  const [destinations, setDestinations] = useState<string[]>([])
  const [durations, setDurations] = useState<string[]>([])
  const [budget, setBudget] = useState('')
  const [saving, setSaving] = useState(false)

  function toggle<T>(arr: T[], val: T): T[] {
    return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val]
  }

  async function handleFinish() {
    setSaving(true)
    setStep('building')
    try {
      await api.post('/auth/onboarding', {
        travel_styles: styles,
        destinations,
        trip_durations: durations,
        budget_range: budget || null,
      })
      await api.post('/feed/refresh')
      setTimeout(() => navigate('/feed'), 1500)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save preferences')
      setStep('connect')
    } finally {
      setSaving(false)
    }
  }

  async function connectYouTube() {
    try {
      const { data } = await api.get<{ url: string }>('/social/connect/youtube')
      window.open(data.url, '_blank', 'width=500,height=600')
    } catch { toast.error('Failed to initiate YouTube connect') }
  }

  const steps: Step[] = ['styles', 'destinations', 'budget', 'connect', 'building']
  const stepIndex = steps.indexOf(step)

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 w-96 h-96 -translate-x-1/2 rounded-full bg-brand-500/15 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-lg">
        {/* Progress */}
        {step !== 'building' && (
          <div className="flex gap-1.5 mb-8 justify-center">
            {['styles', 'destinations', 'budget', 'connect'].map((s, i) => (
              <div key={s} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= stepIndex ? 'bg-brand-500' : 'bg-white/20'}`} />
            ))}
          </div>
        )}

        <AnimatePresence mode="wait">
          {step === 'styles' && (
            <motion.div key="styles" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <GlassCard>
                <h2 className="text-2xl font-bold text-white mb-1">How do you travel?</h2>
                <p className="text-white/60 text-sm mb-6">Pick all that apply</p>
                <div className="flex flex-wrap gap-2 mb-6">
                  {TRAVEL_STYLES.map((s) => (
                    <ToggleChip key={s} label={s} selected={styles.includes(s)} onClick={() => setStyles(toggle(styles, s))} />
                  ))}
                </div>
                <GlassButton onClick={() => setStep('destinations')} fullWidth disabled={styles.length === 0}>
                  Next →
                </GlassButton>
              </GlassCard>
            </motion.div>
          )}

          {step === 'destinations' && (
            <motion.div key="destinations" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <GlassCard>
                <h2 className="text-2xl font-bold text-white mb-1">Dream destinations</h2>
                <p className="text-white/60 text-sm mb-6">Where do you want to go?</p>
                <div className="flex flex-wrap gap-2 mb-4">
                  {DESTINATIONS.map((d) => (
                    <ToggleChip key={d} label={d} selected={destinations.includes(d)} onClick={() => setDestinations(toggle(destinations, d))} />
                  ))}
                </div>
                <div className="mb-6">
                  <p className="text-white/50 text-xs mb-2">Trip length</p>
                  <div className="flex flex-wrap gap-2">
                    {DURATIONS.map((d) => (
                      <ToggleChip key={d} label={d} selected={durations.includes(d)} onClick={() => setDurations(toggle(durations, d))} />
                    ))}
                  </div>
                </div>
                <GlassButton onClick={() => setStep('budget')} fullWidth>Next →</GlassButton>
              </GlassCard>
            </motion.div>
          )}

          {step === 'budget' && (
            <motion.div key="budget" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <GlassCard>
                <h2 className="text-2xl font-bold text-white mb-1">Your travel budget</h2>
                <p className="text-white/60 text-sm mb-6">This shapes the vlogs we surface</p>
                <div className="space-y-3 mb-6">
                  {BUDGETS.map((b) => (
                    <button
                      key={b.value}
                      onClick={() => setBudget(b.value)}
                      className={`w-full p-4 rounded-xl text-left transition-all duration-200 ${
                        budget === b.value ? 'bg-brand-500/30 border border-brand-400/50' : 'glass hover:bg-white/15'
                      }`}
                    >
                      <div className="font-medium text-white">{b.label}</div>
                      <div className="text-white/50 text-sm">{b.desc}</div>
                    </button>
                  ))}
                </div>
                <GlassButton onClick={() => setStep('connect')} fullWidth>Next →</GlassButton>
              </GlassCard>
            </motion.div>
          )}

          {step === 'connect' && (
            <motion.div key="connect" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <GlassCard>
                <h2 className="text-2xl font-bold text-white mb-1">Connect your accounts</h2>
                <p className="text-white/60 text-sm mb-6">We pull vlogs from creators you already follow</p>
                <div className="space-y-3 mb-6">
                  <button onClick={connectYouTube} className="w-full glass-hover p-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M23.495 6.205a3.007 3.007 0 0 0-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 0 0 .527 6.205a31.247 31.247 0 0 0-.522 5.805 31.247 31.247 0 0 0 .522 5.783 3.007 3.007 0 0 0 2.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 0 0 2.088-2.088 31.247 31.247 0 0 0 .5-5.783 31.247 31.247 0 0 0-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/>
                      </svg>
                    </div>
                    <div className="text-left">
                      <div className="font-medium text-white">Connect YouTube</div>
                      <div className="text-white/50 text-sm">Import vlogs from channels you subscribe to</div>
                    </div>
                    <svg className="w-5 h-5 text-white/30 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>

                  <div className="w-full glass p-4 flex items-center gap-4 opacity-60">
                    <div className="w-10 h-10 rounded-full bg-pink-500/20 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-pink-400" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
                      </svg>
                    </div>
                    <div className="text-left">
                      <div className="font-medium text-white">Connect Instagram</div>
                      <div className="text-white/50 text-sm">Coming soon — import travel Reels</div>
                    </div>
                  </div>
                </div>

                <GlassButton onClick={handleFinish} loading={saving} fullWidth>
                  Build my feed →
                </GlassButton>
                <button onClick={handleFinish} className="w-full text-center text-white/40 text-sm mt-3 hover:text-white/60 transition-colors">
                  Skip for now
                </button>
              </GlassCard>
            </motion.div>
          )}

          {step === 'building' && (
            <motion.div key="building" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
              <GlassCard className="text-center py-12">
                <div className="text-5xl mb-4 animate-float">🌍</div>
                <h2 className="text-2xl font-bold text-white mb-2">Building your feed…</h2>
                <p className="text-white/60">Finding travel vlogs that match your vibe</p>
                <div className="flex justify-center mt-6">
                  <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                </div>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
