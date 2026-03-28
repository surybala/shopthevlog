import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'
import { useFeed, useFeedSearch } from '../hooks/useFeed'
import { usePreferences } from '../hooks/usePreferences'
import VlogCard from '../components/feed/VlogCard'
import FeedFilters from '../components/feed/FeedFilters'
import InterestsPicker from '../components/feed/InterestsPicker'
import Spinner from '../components/ui/Spinner'
import BookingDrawer from '../components/booking/BookingDrawer'
import type { Vlog } from '../types/vlog'

export default function Feed() {
  const [destination, setDestination] = useState('')
  const [style, setStyle] = useState('')
  const [duration, setDuration] = useState('')
  const [showInterestsPicker, setShowInterestsPicker] = useState(false)

  // ── Preferences (drives onboarding & feed personalisation) ─────────────
  const { data: prefs, isLoading: prefsLoading } = usePreferences()
  const hasInterests = (prefs?.travel_styles?.length ?? 0) > 0

  // Show interests picker on first load when the user has no interests yet
  useEffect(() => {
    if (!prefsLoading && !hasInterests) {
      setShowInterestsPicker(true)
    }
  }, [prefsLoading, hasInterests])

  // ── Regular paginated feed (when no destination search is active) ──────
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useFeed({
    destination: destination || undefined,
    style: style || undefined,
    duration: duration || undefined,
  })

  // ── Live destination search (POST /feed/search) ─────────────────────────
  const feedSearch = useFeedSearch()
  const prevDestRef = useRef('')

  useEffect(() => {
    if (destination && destination !== prevDestRef.current) {
      feedSearch.mutate(destination)
    }
    prevDestRef.current = destination
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination])

  // ── Deduplicated vlog list ─────────────────────────────────────────────
  // When searching a destination, use the search results; otherwise use
  // the infinite-scrolled feed. Either way, dedup by id across all pages.
  const vlogs = useMemo<Vlog[]>(() => {
    let raw: Vlog[]
    if (destination && feedSearch.data) {
      raw = feedSearch.data.vlogs
    } else {
      raw = data?.pages.flatMap((p) => p.vlogs) ?? []
    }

    const seen = new Set<string>()
    return raw.filter((v) => {
      if (seen.has(v.id)) return false
      seen.add(v.id)
      return true
    })
  }, [destination, feedSearch.data, data])

  // ── Infinite scroll sentinel ───────────────────────────────────────────
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

  // ── Loading state ──────────────────────────────────────────────────────
  const isSearchingDestination = destination !== '' && feedSearch.isPending
  const showLoading = isLoading || (destination && feedSearch.isPending)
  const showEmpty = !showLoading && vlogs.length === 0

  let itemIndex = 0

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Discover</h1>
            <p className="text-white/50 text-sm">
              {hasInterests
                ? 'Travel vlogs matched to your taste'
                : 'Set your interests to personalise your feed'}
            </p>
          </div>
          {!hasInterests && !prefsLoading && (
            <button
              onClick={() => setShowInterestsPicker(true)}
              className="text-xs text-white/50 hover:text-white border border-white/10 hover:border-white/30 px-3 py-1.5 rounded-full transition-all"
            >
              ✨ Set interests
            </button>
          )}
          {hasInterests && (
            <button
              onClick={() => setShowInterestsPicker(true)}
              className="text-xs text-white/40 hover:text-white/70 transition-colors"
              title="Edit interests"
            >
              ✏️ Edit interests
            </button>
          )}
        </div>

        {/* Filters */}
        <FeedFilters
          destination={destination}
          style={style}
          duration={duration}
          onDestinationChange={setDestination}
          onStyleChange={setStyle}
          onDurationChange={setDuration}
          isSearching={isSearchingDestination}
        />

        {/* Destination search label */}
        {destination && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-white/60 text-sm">
              {feedSearch.isPending
                ? `Searching YouTube for "${destination}"…`
                : `Showing results for "${destination}"`}
            </span>
            {feedSearch.isPending && <Spinner size="sm" />}
          </div>
        )}

        {/* Content */}
        {showLoading ? (
          <div className="flex justify-center py-20">
            <Spinner size="lg" />
          </div>
        ) : showEmpty ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">🎬</div>
            {destination ? (
              <>
                <h3 className="text-white text-lg font-semibold mb-2">No vlogs found</h3>
                <p className="text-white/50 text-sm">
                  No results for "{destination}" — try a different city or country.
                </p>
              </>
            ) : style || duration ? (
              <>
                <h3 className="text-white text-lg font-semibold mb-2">No matches</h3>
                <p className="text-white/50 text-sm">
                  No vlogs match this filter — try a different combination.
                </p>
              </>
            ) : (
              <>
                <h3 className="text-white text-lg font-semibold mb-2">
                  {hasInterests ? 'Building your feed…' : 'No vlogs yet'}
                </h3>
                <p className="text-white/50 text-sm">
                  {hasInterests
                    ? "We're fetching travel vlogs matched to your interests. Check back in a moment."
                    : 'Pick your travel interests to seed your personal discovery feed.'}
                </p>
                {!hasInterests && (
                  <button
                    onClick={() => setShowInterestsPicker(true)}
                    className="mt-4 px-5 py-2 bg-white text-black rounded-full text-sm font-medium hover:bg-white/90"
                  >
                    Choose interests
                  </button>
                )}
              </>
            )}
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

            {/* Infinite scroll sentinel (not shown when doing destination search) */}
            {!destination && (
              <div ref={bottomRef} className="flex justify-center py-8">
                {isFetchingNextPage && <Spinner />}
                {!hasNextPage && vlogs.length > 0 && (
                  <p className="text-white/30 text-sm">You've seen it all ✨</p>
                )}
              </div>
            )}
          </>
        )}

        <BookingDrawer />
      </div>

      {/* Interests picker overlay — rendered in a portal so it covers everything */}
      {createPortal(
        <AnimatePresence>
          {showInterestsPicker && (
            <InterestsPicker
              initialStyles={prefs?.travel_styles ?? []}
              onDone={() => setShowInterestsPicker(false)}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
