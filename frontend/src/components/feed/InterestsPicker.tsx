import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { INTERESTS } from '../../constants/interests'
import { useUpdatePreferences } from '../../hooks/usePreferences'
import toast from 'react-hot-toast'

interface Props {
  /** Current saved styles, so returning users see their existing picks highlighted */
  initialStyles?: string[]
  onDone: () => void
}

export default function InterestsPicker({ initialStyles = [], onDone }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialStyles.map((s) => s.toLowerCase()))
  )
  const updatePrefs = useUpdatePreferences()

  function toggle(tag: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  async function handleContinue() {
    if (selected.size === 0) return
    try {
      await updatePrefs.mutateAsync({ travel_styles: Array.from(selected) })
      toast.success('Interests saved — personalising your feed…')
      onDone()
    } catch {
      toast.error('Failed to save interests')
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center px-4 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)' }}
    >
      <motion.div
        initial={{ y: 32, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-2xl py-10"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">✈️</div>
          <h2 className="text-3xl font-bold text-white mb-2">
            What kind of traveler are you?
          </h2>
          <p className="text-white/60 text-sm">
            Pick your interests — we'll fill your feed with vlogs that match.
            <br />
            You can change these any time in your profile.
          </p>
        </div>

        {/* Interest grid */}
        <div className="flex flex-wrap gap-3 justify-center mb-10">
          {INTERESTS.map((interest) => {
            const isSelected = selected.has(interest.tag)
            return (
              <motion.button
                key={interest.tag}
                whileTap={{ scale: 0.93 }}
                onClick={() => toggle(interest.tag)}
                className={`
                  flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium
                  transition-all duration-200 border
                  ${isSelected
                    ? 'bg-white text-black border-white shadow-lg shadow-white/20'
                    : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white hover:border-white/20'
                  }
                `}
              >
                <span className="text-base leading-none">{interest.emoji}</span>
                <span>{interest.label}</span>
              </motion.button>
            )
          })}
        </div>

        {/* Selection count + continue */}
        <div className="text-center space-y-3">
          {selected.size > 0 && (
            <p className="text-white/50 text-xs">
              {selected.size} interest{selected.size !== 1 ? 's' : ''} selected
            </p>
          )}
          <button
            onClick={handleContinue}
            disabled={selected.size === 0 || updatePrefs.isPending}
            className={`
              px-8 py-3 rounded-full text-sm font-semibold transition-all duration-200
              ${selected.size > 0
                ? 'bg-white text-black hover:bg-white/90 shadow-lg shadow-white/20'
                : 'bg-white/10 text-white/30 cursor-not-allowed'
              }
            `}
          >
            {updatePrefs.isPending ? 'Saving…' : 'Build my feed →'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
