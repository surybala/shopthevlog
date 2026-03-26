import { motion, AnimatePresence } from 'framer-motion'
import { useBookingStore } from '../../stores/bookingStore'
import FlightSearch from './FlightSearch'
import HotelSearch from './HotelSearch'
import PassengerForm from './PassengerForm'

export default function BookingDrawer() {
  const { isOpen, tab, step, saveAndClose, setTab } = useBookingStore()

  const isPassengerStep = step === 'passengers' || step === 'confirm'

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={saveAndClose}
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
              <div>
                <h2 className="font-bold text-white text-lg">Book Your Trip</h2>
                {isPassengerStep && (
                  <p className="text-white/40 text-xs mt-0.5">Enter passenger details</p>
                )}
              </div>
              <button
                onClick={saveAndClose}
                className="flex items-center gap-1.5 text-sm font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 transition-all"
                title="Save your progress and close"
              >
                {/* floppy-disk icon */}
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V8l-4-4H8z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M16 4v4H8V4M12 12v4m0 0l-2-2m2 2l2-2" />
                </svg>
                Save &amp; Close
              </button>
            </div>

            {/* Tabs — hidden while filling in passenger details */}
            {!isPassengerStep && (
              <div className="flex gap-2 px-6 py-4 flex-shrink-0 border-b border-white/10">
                {(['flights', 'hotels'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-4 py-2 rounded-full text-sm font-medium capitalize transition-all duration-200 ${
                      tab === t ? 'bg-white text-black' : 'glass text-white/60 hover:text-white'
                    }`}
                  >
                    {t === 'flights' ? '✈️ Flights' : '🏨 Hotels'}
                  </button>
                ))}
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {isPassengerStep
                ? <PassengerForm />
                : tab === 'flights'
                  ? <FlightSearch />
                  : <HotelSearch />
              }
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
