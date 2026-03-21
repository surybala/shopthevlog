interface FeedFiltersProps {
  destination: string
  style: string
  onDestinationChange: (v: string) => void
  onStyleChange: (v: string) => void
}

const STYLES = ['Adventure', 'Luxury', 'Budget', 'Solo', 'Family', 'Backpacking', 'Cultural']

export default function FeedFilters({
  destination,
  style,
  onDestinationChange,
  onStyleChange,
}: FeedFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-6">
      <input
        type="text"
        placeholder="Filter by destination..."
        value={destination}
        onChange={(e) => onDestinationChange(e.target.value)}
        className="glass-input max-w-xs text-sm py-2"
      />
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onStyleChange('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
            !style ? 'bg-brand-500 text-white' : 'glass text-white/60 hover:text-white'
          }`}
        >
          All
        </button>
        {STYLES.map((s) => (
          <button
            key={s}
            onClick={() => onStyleChange(style === s ? '' : s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
              style === s ? 'bg-brand-500 text-white' : 'glass text-white/60 hover:text-white'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
