import { useParams, useNavigate } from 'react-router-dom'
import ReactPlayer from 'react-player'
import { useVlog } from '../hooks/useVlog'
import ItineraryPanel from '../components/itinerary/ItineraryPanel'
import BookingDrawer from '../components/booking/BookingDrawer'
import Spinner from '../components/ui/Spinner'

export default function VlogDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: vlog, isLoading } = useVlog(id!)

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!vlog) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="text-5xl">🎬</div>
        <p className="text-white/60">Vlog not found.</p>
        <button onClick={() => navigate('/feed')} className="btn-ghost">← Back to feed</button>
      </div>
    )
  }

  const videoUrl = vlog.platform === 'youtube'
    ? `https://www.youtube.com/watch?v=${vlog.platform_video_id}`
    : vlog.video_url

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col lg:flex-row overflow-hidden">
      {/* Left: Video */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="aspect-video lg:aspect-auto lg:flex-1 bg-black">
          <ReactPlayer
            url={videoUrl ?? undefined}
            width="100%"
            height="100%"
            controls
            style={{ display: 'block' }}
          />
        </div>

        {/* Video info */}
        <div className="p-5 border-t border-white/10 flex-shrink-0 overflow-y-auto lg:max-h-48">
          <button onClick={() => navigate('/feed')} className="text-white/50 text-sm hover:text-white transition-colors mb-3 block">
            ← Back to feed
          </button>
          <h1 className="font-bold text-white text-lg leading-snug">{vlog.title}</h1>
          <p className="text-white/50 text-sm mt-1">{vlog.channel_name}</p>
          {vlog.destinations.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {vlog.destinations.map((d) => (
                <span key={d} className="badge text-xs">📍 {d}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: Itinerary panel */}
      <div className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-white/10 flex flex-col bg-white/5 backdrop-blur-heavy overflow-hidden">
        <ItineraryPanel
          vlogId={vlog.id}
          initialStatus={vlog.processing_status}
          initialItineraryId={vlog.itinerary_id}
        />
      </div>

      <BookingDrawer />
    </div>
  )
}
