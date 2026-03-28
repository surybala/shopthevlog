import type { Platform } from '../../types/vlog'

type PlatformOption = Platform | ''

interface PlatformTab {
  value: PlatformOption
  label: string
  emoji: string
}

const TABS: PlatformTab[] = [
  { value: '', label: 'All', emoji: '🌐' },
  { value: 'youtube', label: 'YouTube', emoji: '▶️' },
  { value: 'tiktok', label: 'TikTok', emoji: '🎵' },
  { value: 'instagram', label: 'Instagram', emoji: '📸' },
]

interface Props {
  value: PlatformOption
  onChange: (v: PlatformOption) => void
}

export default function PlatformFilter({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {TABS.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
            value === tab.value
              ? 'bg-white text-black shadow-lg shadow-white/10'
              : 'glass text-white/60 hover:text-white'
          }`}
        >
          <span>{tab.emoji}</span>
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  )
}
