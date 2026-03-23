import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBookingStore } from '../../stores/bookingStore'
import { useBookFlight } from '../../hooks/useFlightSearch'
import { useBookHotel } from '../../hooks/useHotelSearch'
import GlassInput from '../ui/GlassInput'
import GlassButton from '../ui/GlassButton'
import toast from 'react-hot-toast'
import axios from 'axios'

function formatPrice(amount: string, currency: string) {
  return `${currency} ${parseFloat(amount).toLocaleString()}`
}

/**
 * Format a phone number string as the user types.
 * Keeps a leading + and groups digits for readability.
 * US (+1): +1 XXX XXX XXXX
 * Generic international: +CC XXX XXX XXXX
 * The backend already strips spaces before sending to Duffel.
 */
function formatPhoneInput(raw: string): string {
  // Always strip everything except digits; note if + was intended
  const digits = raw.replace(/\D/g, '')
  if (!digits) return raw.startsWith('+') ? '+' : ''

  // If user typed a + (or nothing), prefix with +
  // If they typed a digit sequence without +, still prefix
  if (digits.startsWith('1') && (raw.startsWith('+') || raw.startsWith('1'))) {
    // US / Canada: +1 XXX XXX XXXX
    const d = digits.startsWith('1') ? digits.slice(1) : digits
    let out = '+1'
    if (d.length > 0) out += ' ' + d.slice(0, 3)
    if (d.length > 3) out += ' ' + d.slice(3, 6)
    if (d.length > 6) out += ' ' + d.slice(6, 10)
    return out
  }

  // Generic international: +CC XXX XXX XXXX
  // Treat first 2 digits as country code
  let out = '+' + digits.slice(0, 2)
  if (digits.length > 2) out += ' ' + digits.slice(2, 5)
  if (digits.length > 5) out += ' ' + digits.slice(5, 8)
  if (digits.length > 8) out += ' ' + digits.slice(8, 12)
  return out
}

export default function PassengerForm() {
  const navigate = useNavigate()
  const {
    tab, tripId, selectedFlightOffer, selectedHotelOffer, flightParams,
    reset, close,
    passengers: storedPassengers, setPassengers: setStorePassengers,
  } = useBookingStore()

  const bookFlight = useBookFlight()
  const bookHotel = useBookHotel()

  const passengerCount = flightParams?.passengers ?? 1

  const emptyPassenger = () => ({
    title: 'mr' as const,
    given_name: '',
    family_name: '',
    gender: 'male' as const,
    born_on: '',
    email: '',
    phone_number: '',
  })

  // Restore previously saved passengers (from draft), or start fresh
  const [passengers, setPassengersLocal] = useState(() => {
    if (storedPassengers.length > 0) return storedPassengers
    return Array.from({ length: passengerCount }, emptyPassenger)
  })

  function setPassengers(next: typeof passengers) {
    setPassengersLocal(next)
    setStorePassengers(next) // keep store in sync for "Save & Close"
  }

  function updatePassenger(index: number, field: string, value: string) {
    setPassengers(
      passengers.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    )
  }

  function handlePhoneChange(index: number, raw: string) {
    // Allow the user to type freely but normalise on each keystroke
    const formatted = formatPhoneInput(raw)
    updatePassenger(index, 'phone_number', formatted)
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault()
    if (!tripId) return

    try {
      if (tab === 'flights' && selectedFlightOffer) {
        const { data } = await bookFlight.mutateAsync({
          offer_id: selectedFlightOffer.id,
          passengers,
          trip_id: tripId,
        })
        // Don't reset — keep hotel params alive so confirmation page can offer hotel booking
        close()
        navigate(`/booking/confirmation?ref=${data.duffel_booking_reference}&type=flight&trip_id=${tripId}`)

      } else if (tab === 'hotels' && selectedHotelOffer) {
        const { data } = await bookHotel.mutateAsync({
          rate_id: selectedHotelOffer.id,
          guests: passengers.map((p) => ({
            given_name: p.given_name,
            family_name: p.family_name,
            email: p.email,
            phone_number: p.phone_number,
          })),
          trip_id: tripId,
        })
        reset()
        close()
        navigate('/trips')
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        // Offer request was consumed by a prior attempt — must search again
        toast.error('This offer has expired. Please search again for fresh results.', { duration: 5000 })
        useBookingStore.getState().setStep('search')
      } else {
        toast.error(err instanceof Error ? err.message : 'Booking failed. Please try again.')
      }
    }
  }

  const isPending = bookFlight.isPending || bookHotel.isPending

  return (
    <div className="space-y-5">
      {/* Selected offer summary */}
      {tab === 'flights' && selectedFlightOffer && (
        <div className="glass rounded-xl p-4 space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {selectedFlightOffer.owner.logo_symbol_url && (
                <img src={selectedFlightOffer.owner.logo_symbol_url} className="w-5 h-5 object-contain" alt="" />
              )}
              <span className="text-white font-medium text-sm">{selectedFlightOffer.owner.name}</span>
            </div>
            <span className="text-white font-bold text-sm">
              {formatPrice(selectedFlightOffer.total_amount, selectedFlightOffer.total_currency)}
            </span>
          </div>
          {selectedFlightOffer.slices.map((slice, i) => (
            <p key={i} className="text-white/50 text-xs">
              {slice.origin.iata_code} → {slice.destination.iata_code}
            </p>
          ))}
        </div>
      )}

      {tab === 'hotels' && selectedHotelOffer && (
        <div className="glass rounded-xl p-4 flex items-center gap-3">
          {selectedHotelOffer.accommodation.photos[0] && (
            <img
              src={selectedHotelOffer.accommodation.photos[0].url}
              className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
              alt=""
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-white font-medium text-sm truncate">{selectedHotelOffer.accommodation.name}</p>
            <p className="text-white text-xs font-bold">
              {formatPrice(selectedHotelOffer.cheapest_rate_total_amount, selectedHotelOffer.cheapest_rate_currency)}
            </p>
          </div>
        </div>
      )}

      {/* Passenger forms */}
      <form onSubmit={handleConfirm} className="space-y-5">
        {passengers.map((passenger, idx) => (
          <div key={idx} className="space-y-3">
            {passengerCount > 1 && (
              <p className="text-white/50 text-xs font-medium uppercase tracking-wide">
                Passenger {idx + 1}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">Title</label>
                <select
                  value={passenger.title}
                  onChange={(e) => updatePassenger(idx, 'title', e.target.value)}
                  className="glass-input"
                  required
                >
                  <option value="mr">Mr</option>
                  <option value="ms">Ms</option>
                  <option value="mrs">Mrs</option>
                  <option value="miss">Miss</option>
                  <option value="dr">Dr</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">Gender</label>
                <select
                  value={passenger.gender}
                  onChange={(e) => updatePassenger(idx, 'gender', e.target.value)}
                  className="glass-input"
                  required
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <GlassInput
                label="First name"
                placeholder="Jane"
                value={passenger.given_name}
                onChange={(e) => updatePassenger(idx, 'given_name', e.target.value)}
                required
              />
              <GlassInput
                label="Last name"
                placeholder="Smith"
                value={passenger.family_name}
                onChange={(e) => updatePassenger(idx, 'family_name', e.target.value)}
                required
              />
            </div>

            <GlassInput
              label="Date of birth"
              type="date"
              value={passenger.born_on}
              onChange={(e) => updatePassenger(idx, 'born_on', e.target.value)}
              required
            />

            <GlassInput
              label="Email"
              type="email"
              placeholder="jane@example.com"
              value={passenger.email}
              onChange={(e) => updatePassenger(idx, 'email', e.target.value)}
              required
            />

            <div>
              <GlassInput
                label="Phone number"
                placeholder="+1 555 000 0000"
                value={passenger.phone_number}
                onChange={(e) => handlePhoneChange(idx, e.target.value)}
                type="tel"
                required
              />
              <p className="text-white/30 text-xs mt-1 pl-1">Include country code, e.g. +44 7700 900000</p>
            </div>

          </div>
        ))}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => useBookingStore.getState().setStep('search')}
            className="glass px-4 py-2 rounded-xl text-white/60 hover:text-white text-sm transition-colors"
          >
            ← Back
          </button>
          <GlassButton type="submit" loading={isPending} fullWidth>
            Confirm & Book
          </GlassButton>
        </div>
      </form>
    </div>
  )
}
