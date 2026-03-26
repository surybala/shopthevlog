import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useFeedInteract } from '../../hooks/useFeed'
import type { Vlog } from '../../types/vlog'

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

interface VlogCardProps {
  vlog: Vlog
  index?: number
}

export default function VlogCard({ vlog, index = 0 }: VlogCardProps) {
  const navigate = useNavigate()
  const interact = useFeedInteract()

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
      <div className="relative aspect-video overflow-hidden rounded-t-2xl">
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
        >
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
        </button>

        {/* Platform badge */}
        <span className="absolute top-2 left-2 badge text-xs capitalize">
          {vlog.platform}
        </span>
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="font-semibold text-white text-sm leading-snug line-clamp-2 mb-2 group-hover:text-white/80 transition-colors">
          {vlog.title}
        </h3>

        {/* Channel + stats */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-white/50 text-xs truncate">{vlog.channel_name}</span>
          {vlog.view_count && (
            <span className="text-white/40 text-xs">{formatCount(vlog.view_count)} views</span>
          )}
        </div>

        {/* Destination tags */}
        {vlog.destinations.length > 0 && (
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

        {/* Ready indicator */}
        {vlog.itinerary_id ? (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-400">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Itinerary ready
          </div>
        ) : vlog.processing_status === 'ready' ? (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-white/40">
            <div className="w-1.5 h-1.5 rounded-full bg-white/40" />
            Ready to plan
          </div>
        ) : null}
      </div>
    </motion.div>
  )
}
