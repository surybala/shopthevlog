import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useFeedInteract } from '../../hooks/useFeed'
import type { Vlog, Platform } from '../../types/vlog'

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  return `${m}m`
}

function formatCount(n: number | null): string {
  if (!n) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

// ── Platform badge ─────────────────────────────────────────────────────────────
const PLATFORM_STYLES: Record<Platform, { bg: string; label: string; icon: JSX.Element }> = {
  youtube: {
    bg: 'bg-red-600',
    label: 'YouTube',
    icon: (
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1C4.5 20.5 12 20.5 12 20.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.75 15.5v-7l6.5 3.5-6.5 3.5z" />
      </svg>
    ),
  },
  tiktok: {
    bg: 'bg-neutral-900 border border-white/10',
    label: 'TikTok',
    icon: (
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.69a8.15 8.15 0 0 0 4.77 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z" />
      </svg>
    ),
  },
  instagram: {
    bg: 'bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400',
    label: 'Instagram',
    icon: (
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
      </svg>
    ),
  },
}

interface VlogCardProps {
  vlog: Vlog
  index?: number
  /** When true, renders a slightly more compact card for carousel use */
  compact?: boolean
}

export default function VlogCard({ vlog, index = 0, compact = false }: VlogCardProps) {
  const navigate = useNavigate()
  const interact = useFeedInteract()

  const platform = (vlog.platform || 'youtube') as Platform
  const platformStyle = PLATFORM_STYLES[platform] ?? PLATFORM_STYLES.youtube

  function handleClick() {
    interact.mutate({ vlog_id: vlog.id, action: 'view' })
    navigate(`/vlogs/${vlog.id}`)
  }

  function handleSave(e: React.MouseEvent) {
    e.stopPropagation()
    interact.mutate({ vlog_id: vlog.id, action: 'save' })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      onClick={handleClick}
      className="glass-hover group overflow-hidden cursor-pointer"
      style={{ padding: 0 }}
    >
      {/* Thumbnail */}
      <div className={`relative overflow-hidden rounded-t-2xl ${compact ? 'aspect-video' : 'aspect-video'}`}>
        {vlog.thumbnail_url ? (
          <img
            src={vlog.thumbnail_url}
            alt={vlog.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full bg-white/[0.04] flex items-center justify-center">
            <svg className="w-12 h-12 text-white/20" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* Duration badge */}
        {vlog.duration_seconds && (
          <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded font-mono">
            {formatDuration(vlog.duration_seconds)}
          </span>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          className="absolute top-2 right-2 p-2 glass-sm opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Save vlog"
        >
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
        </button>

        {/* Platform badge — top-left */}
        <span
          className={`absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-white text-xs font-medium ${platformStyle.bg}`}
        >
          {platformStyle.icon}
          <span className="hidden sm:inline">{platformStyle.label}</span>
        </span>
      </div>

      {/* Content */}
      <div className={compact ? 'p-3' : 'p-4'}>
        <h3
          className={`font-semibold text-white leading-snug line-clamp-2 mb-2 group-hover:text-white/80 transition-colors ${
            compact ? 'text-xs' : 'text-sm'
          }`}
        >
          {vlog.title}
        </h3>

        {/* Channel + stats */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-white/50 text-xs truncate">{vlog.channel_name}</span>
          {vlog.view_count && (
            <span className="text-white/40 text-xs">{formatCount(vlog.view_count)} views</span>
          )}
        </div>

        {/* Destination tags — skip in compact mode to save space */}
        {!compact && vlog.destinations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {vlog.destinations.slice(0, 3).map((dest) => (
              <span key={dest} className="badge text-xs">
                📍 {dest}
              </span>
            ))}
            {vlog.destinations.length > 3 && (
              <span className="badge text-xs">+{vlog.destinations.length - 3}</span>
            )}
          </div>
        )}

        {/* Itinerary / ready indicator */}
        {vlog.itinerary_id ? (
          <div className={`flex items-center gap-1.5 text-xs text-emerald-400 ${compact ? '' : 'mt-3'}`}>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Itinerary ready
          </div>
        ) : vlog.processing_status === 'ready' && !compact ? (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-white/40">
            <div className="w-1.5 h-1.5 rounded-full bg-white/40" />
            Ready to plan
          </div>
        ) : null}
      </div>
    </motion.div>
  )
}
