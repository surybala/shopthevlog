import { Link, useSearchParams } from 'react-router-dom'
import GlassCard from '../components/ui/GlassCard'
import GlassButton from '../components/ui/GlassButton'

export default function BookingConfirmation() {
  const [params] = useSearchParams()
  const ref = params.get('ref')
  const type = params.get('type') ?? 'flight'

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <GlassCard className="max-w-md w-full text-center py-12">
        <div className="text-6xl mb-4 animate-float">{type === 'hotel' ? '🏨' : '✈️'}</div>
        <h1 className="text-2xl font-bold text-white mb-2">Booking Confirmed!</h1>
        <p className="text-white/60 mb-6">
          Your {type} has been booked successfully.
        </p>
        {ref && (
          <div className="glass-sm p-3 mb-6">
            <p className="text-white/50 text-xs uppercase tracking-wider mb-1">Booking reference</p>
            <p className="font-mono font-bold text-brand-300 text-lg">{ref}</p>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Link to="/trips"><GlassButton fullWidth>View my trips</GlassButton></Link>
          <Link to="/feed"><GlassButton variant="glass" fullWidth>Discover more vlogs</GlassButton></Link>
        </div>
      </GlassCard>
    </div>
  )
}
