import { motion, AnimatePresence } from 'framer-motion'
import { useBookingStore } from '../../stores/bookingStore'
import FlightSearch from './FlightSearch'
import HotelSearch from './HotelSearch'

export default function BookingDrawer() {
  const { isOpen, tab, close, setTab } = useBookingStore()

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-lg z-50 glass border-l border-white/10 flex flex-col"
            style={{ borderRadius: '24px 0 0 24px' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10 flex-shrink-0">
              <h2 className="font-bold text-white text-lg">Book Your Trip</h2>
              <button onClick={close} className="text-white/50 hover:text-white transition-colors">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 px-6 py-4 flex-shrink-0 border-b border-white/10">
              {(['flights', 'hotels'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 rounded-full text-sm font-medium capitalize transition-all duration-200 ${
                    tab === t ? 'bg-brand-500 text-white' : 'glass text-white/60 hover:text-white'
                  }`}
                >
                  {t === 'flights' ? '✈️ Flights' : '🏨 Hotels'}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {tab === 'flights' ? <FlightSearch /> : <HotelSearch />}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
