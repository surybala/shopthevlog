/**
 * BookingSuccessModal — full-screen celebration overlay shown after a successful
 * flight or hotel booking.  Fireworks are rendered as pure-CSS animated particles
 * (no extra dependencies).
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import GlassButton from '../ui/GlassButton'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BookingSuccessInfo {
  type: 'flight' | 'hotel'
  /** Booking reference / confirmation number shown to the user. */
  reference?: string
  /** Internal booking ID (shown as a secondary detail). */
  bookingId?: string
  /** Human-readable summary line — e.g. "JFK → NRT" or "Grand Hotel Tokyo". */
  summary?: string
  totalAmount?: string
  currency?: string
}

interface BookingSuccessModalProps {
  info: BookingSuccessInfo | null
  onClose: () => void
}

// ─── Fireworks ────────────────────────────────────────────────────────────────

const COLOURS = [
  '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff',
  '#ff9ff3', '#f368e0', '#48dbfb', '#ff9f43',
  '#a29bfe', '#fd79a8', '#55efc4', '#fdcb6e',
]

interface Particle {
  id: number
  x: number       // vw units
  y: number       // vh units
  tx: number      // translate x (px)
  ty: number      // translate y (px)
  color: string
  size: number    // px
  delay: number   // ms
  duration: number // ms
  shape: 'circle' | 'star' | 'rect'
  rotation: number // deg
}

function randomBetween(a: number, b: number) {
  return a + Math.random() * (b - a)
}

function generateParticles(count = 120): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    // Cluster bursts across 4-5 launch points for a realistic fireworks feel
    const burstX = randomBetween(15, 85)
    const burstY = randomBetween(10, 60)
    const angle = Math.random() * Math.PI * 2
    const distance = randomBetween(60, 220)
    return {
      id: i,
      x: burstX,
      y: burstY,
      tx: Math.cos(angle) * distance,
      ty: Math.sin(angle) * distance,
      color: COLOURS[Math.floor(Math.random() * COLOURS.length)],
      size: randomBetween(4, 10),
      delay: randomBetween(0, 1200),
      duration: randomBetween(900, 1800),
      shape: (['circle', 'star', 'rect'] as const)[Math.floor(Math.random() * 3)],
      rotation: randomBetween(0, 360),
    }
  })
}

/** CSS keyframes injected once as a <style> tag */
const STYLE_ID = 'booking-success-keyframes'

function ensureKeyframes() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    @keyframes bsm-particle {
      0%   { transform: translate(0, 0) rotate(0deg) scale(1); opacity: 1; }
      80%  { opacity: 0.9; }
      100% { transform: translate(var(--tx), var(--ty)) rotate(var(--rot)) scale(0); opacity: 0; }
    }
    @keyframes bsm-modal-in {
      from { opacity: 0; transform: scale(0.92) translateY(20px); }
      to   { opacity: 1; transform: scale(1)    translateY(0);    }
    }
  `
  document.head.appendChild(style)
}

function Fireworks() {
  const particlesRef = useRef<Particle[]>(generateParticles(140))

  useEffect(() => {
    ensureKeyframes()
  }, [])

  return (
    <div
      aria-hidden
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 9998 }}
    >
      {particlesRef.current.map((p) => {
        const borderRadius =
          p.shape === 'circle' ? '50%'
          : p.shape === 'rect'  ? '2px'
          : '0%'

        // Star shape via clip-path
        const clipPath =
          p.shape === 'star'
            ? 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)'
            : undefined

        return (
          <div
            key={p.id}
            style={{
              position: 'absolute',
              left: `${p.x}vw`,
              top:  `${p.y}vh`,
              width:  p.size,
              height: p.size,
              backgroundColor: p.color,
              borderRadius,
              clipPath,
              // CSS custom properties for the keyframe
              ['--tx' as string]: `${p.tx}px`,
              ['--ty' as string]: `${p.ty}px`,
              ['--rot' as string]: `${p.rotation}deg`,
              animation: `bsm-particle ${p.duration}ms ease-out ${p.delay}ms both`,
            }}
          />
        )
      })}
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export default function BookingSuccessModal({ info, onClose }: BookingSuccessModalProps) {
  const isOpen = info !== null

  // Prevent body scroll while open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  if (!isOpen || !info) return null

  const emoji      = info.type === 'flight' ? '✈️' : '🏨'
  const typeLabel  = info.type === 'flight' ? 'Flight' : 'Hotel'
  const priceStr   = info.totalAmount && info.currency
    ? `${info.currency} ${parseFloat(info.totalAmount).toLocaleString()}`
    : null

  return createPortal(
    <>
      <Fireworks />

      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        style={{ zIndex: 9999 }}
        onClick={onClose}
        data-testid="success-backdrop"
      />

      {/* Card */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          pointerEvents: 'none',
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.88, y: 28 }}
          animate={{ opacity: 1, scale: 1,    y: 0  }}
          exit={{    opacity: 0, scale: 0.94,  y: 16 }}
          transition={{ type: 'spring', damping: 22, stiffness: 280 }}
          style={{ pointerEvents: 'auto', width: '100%', maxWidth: '480px' }}
          className="glass rounded-3xl p-8 text-center shadow-2xl border border-white/15"
          data-testid="booking-success-modal"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Big emoji + animated ring */}
          <div className="relative inline-flex items-center justify-center mb-6">
            <span
              className="absolute inset-0 rounded-full animate-ping"
              style={{ background: 'radial-gradient(circle, rgba(99,255,180,0.25) 0%, transparent 70%)' }}
            />
            <span className="text-6xl select-none" role="img" aria-label={typeLabel}>
              {emoji}
            </span>
          </div>

          <h2 className="text-2xl font-bold text-white mb-1">
            {typeLabel} Booked!
          </h2>
          <p className="text-white/50 text-sm mb-6">
            Your booking is confirmed. Get ready for an amazing trip! 🎉
          </p>

          {/* Details card */}
          <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-5 text-left space-y-3 mb-6">
            {info.reference && (
              <div className="flex justify-between items-center">
                <span className="text-white/50 text-xs uppercase tracking-wide">Confirmation</span>
                <span
                  className="text-white font-mono font-bold text-sm tracking-widest"
                  data-testid="success-reference"
                >
                  {info.reference}
                </span>
              </div>
            )}
            {info.summary && (
              <div className="flex justify-between items-center">
                <span className="text-white/50 text-xs uppercase tracking-wide">
                  {info.type === 'flight' ? 'Route' : 'Hotel'}
                </span>
                <span className="text-white text-sm font-medium text-right max-w-[60%]" data-testid="success-summary">
                  {info.summary}
                </span>
              </div>
            )}
            {priceStr && (
              <div className="flex justify-between items-center">
                <span className="text-white/50 text-xs uppercase tracking-wide">Total paid</span>
                <span className="text-emerald-400 font-bold text-sm" data-testid="success-price">
                  {priceStr}
                </span>
              </div>
            )}
          </div>

          <GlassButton
            onClick={onClose}
            fullWidth
            data-testid="success-close-btn"
          >
            View My Trips →
          </GlassButton>
        </motion.div>
      </div>
    </>,
    document.body
  )
}
