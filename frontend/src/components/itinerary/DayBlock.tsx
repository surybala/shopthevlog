import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ActivityCard from './ActivityCard'
import type { ItineraryDay } from '../../types/itinerary'

interface DayBlockProps {
  day: ItineraryDay
  defaultOpen?: boolean
}

export default function DayBlock({ day, defaultOpen = false }: DayBlockProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="glass overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div>
          <div className="flex items-center gap-3">
            <span className="badge">Day {day.day_number}</span>
            {day.location && <span className="text-white/70 text-sm">📍 {day.location}</span>}
          </div>
          {day.title && (
            <h3 className="font-semibold text-white mt-1">{day.title}</h3>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-white/50 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3 border-t border-white/10 pt-4">
              {day.description && (
                <p className="text-white/60 text-sm">{day.description}</p>
              )}
              {day.activities.map((activity) => (
                <ActivityCard key={activity.id} activity={activity} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
