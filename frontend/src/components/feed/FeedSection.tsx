import { useRef } from 'react'
import { motion } from 'framer-motion'
import VlogCard from './VlogCard'
import type { FeedSection as FeedSectionType } from '../../types/vlog'

interface Props {
  section: FeedSectionType
  /** Index of this section in the page — used for staggered entrance animation */
  sectionIndex?: number
}

export default function FeedSection({ section, sectionIndex = 0 }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  function scrollBy(delta: number) {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  if (!section.vlogs.length) return null

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: sectionIndex * 0.08, duration: 0.45 }}
      className="mb-10"
    >
      {/* Section header */}
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-2">
          <span className="text-2xl leading-none" role="img" aria-label={section.title}>
            {section.emoji}
          </span>
          <h2 className="text-lg font-semibold text-white">{section.title}</h2>
          <span className="text-white/30 text-sm">({section.vlogs.length})</span>
        </div>

        {/* Scroll controls — hidden on touch devices where native scroll works */}
        <div className="hidden sm:flex items-center gap-1">
          <button
            onClick={() => scrollBy(-320)}
            className="p-1.5 rounded-full glass text-white/50 hover:text-white transition-colors"
            aria-label="Scroll left"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => scrollBy(320)}
            className="p-1.5 rounded-full glass text-white/50 hover:text-white transition-colors"
            aria-label="Scroll right"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Horizontal scroll strip */}
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-2 scrollbar-none snap-x snap-mandatory"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {section.vlogs.map((vlog, i) => (
          <div
            key={vlog.id}
            className="flex-none w-64 sm:w-72 snap-start"
          >
            <VlogCard vlog={vlog} index={i} compact />
          </div>
        ))}
      </div>
    </motion.section>
  )
}
