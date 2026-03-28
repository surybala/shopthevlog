import { useEffect, useRef, useState } from 'react'
import { INTERESTS } from '../../constants/interests'

export interface FilterState {
  destination: string
  style: string
  duration: string
}

interface Props extends FilterState {
  onDestinationChange: (v: string) => void
  onStyleChange: (v: string) => void
  onDurationChange: (v: string) => void
  isSearching?: boolean
}

const DURATIONS = [
  { label: 'Any length', emoji: '⏱️', value: '' },
  { label: 'Short',      emoji: '⚡',  value: 'short',  hint: '< 10 min' },
  { label: 'Medium',     emoji: '☕',  value: 'medium', hint: '10–30 min' },
  { label: 'Long',       emoji: '🎬',  value: 'long',   hint: '> 30 min' },
]

export default function FeedFilters({
  destination,
  style,
  duration,
  onDestinationChange,
  onStyleChange,
  onDurationChange,
  isSearching = false,
}: Props) {
  // Local state for the input so we can debounce before firing the prop
  const [localDest, setLocalDest] = useState(destination)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep local in sync when parent resets filters externally
  useEffect(() => {
    setLocalDest(destination)
  }, [destination])

  function handleDestInput(v: string) {
    setLocalDest(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onDestinationChange(v.trim())
    }, 600)
  }

  const hasFilters = destination || style || duration

  return (
    <div className="space-y-3 mb-6">
      {/* Row 1: Destination search + clear */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Destination */}
        <div className="relative">
          <input
            type="text"
            placeholder="🌍  Filter by destination…"
            value={localDest}
            onChange={(e) => handleDestInput(e.target.value)}
            className="glass-input max-w-xs text-sm py-2 pl-3 pr-8"
          />
          {isSearching && (
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 text-xs animate-pulse">
              ⟳
            </span>
          )}
          {localDest && !isSearching && (
            <button
              onClick={() => { setLocalDest(''); onDestinationChange('') }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Duration pills */}
        {DURATIONS.map((d) => (
          <button
            key={d.value}
            onClick={() => onDurationChange(d.value)}
            title={(d as { hint?: string }).hint}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 flex items-center gap-1 ${
              duration === d.value
                ? 'bg-white text-black'
                : 'glass text-white/60 hover:text-white'
            }`}
          >
            <span>{d.emoji}</span>
            <span>{d.label}</span>
          </button>
        ))}

        {/* Clear all filters */}
        {hasFilters && (
          <button
            onClick={() => {
              setLocalDest('')
              onDestinationChange('')
              onStyleChange('')
              onDurationChange('')
            }}
            className="text-white/40 hover:text-white/70 text-xs transition-colors ml-1"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Row 2: Style / interest pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onStyleChange('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
            !style ? 'bg-white text-black' : 'glass text-white/60 hover:text-white'
          }`}
        >
          All styles
        </button>
        {INTERESTS.map((interest) => (
          <button
            key={interest.tag}
            onClick={() => onStyleChange(style === interest.tag ? '' : interest.tag)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 flex items-center gap-1 ${
              style === interest.tag
                ? 'bg-white text-black'
                : 'glass text-white/60 hover:text-white'
            }`}
          >
            <span>{interest.emoji}</span>
            <span>{interest.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
