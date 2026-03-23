import type { ItineraryActivity } from '../../types/itinerary'

const typeIcons: Record<string, string> = {
  activity:      '🎯',
  meal:          '🍽️',
  accommodation: '🏨',
  transport:     '✈️',
  note:          '📝',
}

interface ActivityCardProps {
  activity: ItineraryActivity
}

export default function ActivityCard({ activity }: ActivityCardProps) {
  return (
    <div className="glass-sm p-4 flex gap-3">
      <span className="text-lg flex-shrink-0 mt-0.5">{typeIcons[activity.type] ?? '📌'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-medium text-white text-sm">{activity.name}</h4>
          {activity.estimated_cost_usd != null && (
            <span className="badge flex-shrink-0 text-xs">${activity.estimated_cost_usd}</span>
          )}
        </div>
        {activity.description && (
          <p className="text-white/60 text-xs mt-1 leading-relaxed">{activity.description}</p>
        )}
        {activity.location_name && (
          <p className="text-white/50 text-xs mt-1">📍 {activity.location_name}</p>
        )}
        {activity.duration_minutes && (
          <p className="text-white/40 text-xs mt-1">⏱ {activity.duration_minutes} min</p>
        )}
        {activity.booking_url && (
          <a
            href={activity.booking_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-2 text-xs text-white/60 hover:text-white transition-colors"
          >
            Book →
          </a>
        )}
      </div>
    </div>
  )
}
