import { Link } from 'react-router-dom'
import GlassCard from '../components/ui/GlassCard'
import GlassButton from '../components/ui/GlassButton'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <GlassCard className="max-w-sm w-full text-center py-12">
        <div className="text-6xl mb-4">🗺️</div>
        <h1 className="text-2xl font-bold text-white mb-2">Page not found</h1>
        <p className="text-white/60 mb-6">Looks like you've wandered off the map.</p>
        <Link to="/"><GlassButton fullWidth>Go home</GlassButton></Link>
      </GlassCard>
    </div>
  )
}
