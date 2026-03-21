import { useState, useCallback, useRef } from 'react'
import { useFeed } from '../hooks/useFeed'
import VlogCard from '../components/feed/VlogCard'
import FeedFilters from '../components/feed/FeedFilters'
import Spinner from '../components/ui/Spinner'
import BookingDrawer from '../components/booking/BookingDrawer'

export default function Feed() {
  const [destination, setDestination] = useState('')
  const [style, setStyle] = useState('')
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useFeed({ destination, style })

  const observer = useRef<IntersectionObserver | null>(null)
  const bottomRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (isFetchingNextPage) return
      if (observer.current) observer.current.disconnect()
      if (!el) return
      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasNextPage) fetchNextPage()
      })
      observer.current.observe(el)
    },
    [isFetchingNextPage, hasNextPage, fetchNextPage]
  )

  const vlogs = data?.pages.flatMap((p) => p.vlogs) ?? []
  let itemIndex = 0

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Discover</h1>
        <p className="text-white/50 text-sm">Travel vlogs matched to your taste</p>
      </div>

      <FeedFilters
        destination={destination}
        style={style}
        onDestinationChange={setDestination}
        onStyleChange={setStyle}
      />

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : vlogs.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">🎬</div>
          <h3 className="text-white text-lg font-semibold mb-2">No vlogs yet</h3>
          <p className="text-white/50 text-sm">Connect your YouTube account to start discovering travel content.</p>
        </div>
      ) : (
        <>
          {/* Masonry grid */}
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
            {vlogs.map((vlog) => (
              <div key={vlog.id} className="break-inside-avoid">
                <VlogCard vlog={vlog} index={itemIndex++} />
              </div>
            ))}
          </div>

          {/* Infinite scroll sentinel */}
          <div ref={bottomRef} className="flex justify-center py-8">
            {isFetchingNextPage && <Spinner />}
            {!hasNextPage && vlogs.length > 0 && (
              <p className="text-white/30 text-sm">You've seen it all ✨</p>
            )}
          </div>
        </>
      )}

      <BookingDrawer />
    </div>
  )
}
