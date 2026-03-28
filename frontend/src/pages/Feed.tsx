import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import { useFeed, useFeedSearch, useFeedSections } from '../hooks/useFeed'
import { usePreferences } from '../hooks/usePreferences'
import VlogCard from '../components/feed/VlogCard'
import FeedSection from '../components/feed/FeedSection'
import FeedFilters from '../components/feed/FeedFilters'
import PlatformFilter from '../components/feed/PlatformFilter'
import InterestsPicker from '../components/feed/InterestsPicker'
import Spinner from '../components/ui/Spinner'
import BookingDrawer from '../components/booking/BookingDrawer'
import type { Vlog, Platform } from '../types/vlog'

// ── Social connect CTA ──────────────────────────────────────────────────────────
function ConnectBanner({ platform, onConnect }: { platform: 'tiktok' | 'instagram'; onConnect: () => void }) {
  const meta = {
    tiktok:    { emoji: '🎵', label: 'TikTok',    colour: 'from-neutral-800 to-neutral-900 border-white/10' },
    instagram: { emoji: '📸', label: 'Instagram', colour: 'from-purple-900/60 to-pink-900/60 border-pink-500/20' },
  }[platform]

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`flex items-center justify-between px-4 py-3 rounded-xl bg-gradient-to-r border ${meta.colour} mb-4`}
    >
      <div className="flex items-center gap-2">
        <span className="text-xl">{meta.emoji}</span>
        <div>
          <p className="text-white text-sm font-medium">Connect {meta.label}</p>
          <p className="text-white/50 text-xs">Get personalised {meta.label} travel content in your feed</p>
        </div>
      </div>
      <button
        onClick={onConnect}
        className="px-3 py-1.5 bg-white text-black rounded-full text-xs font-semibold hover:bg-white/90 transition-colors flex-shrink-0"
      >
        Connect
      </button>
    </motion.div>
  )
}

export default function Feed() {
  const [destination, setDestination] = useState('')
  const [style, setStyle] = useState('')
  const [duration, setDuration] = useState('')
  const [platform, setPlatform] = useState<Platform | ''>('')
  const [showInterestsPicker, setShowInterestsPicker] = useState(false)

  // Track which social platforms the user has dismissed the connect banner for
  const [dismissedBanners, setDismissedBanners] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('dismissedSocialBanners') || '[]'))
    } catch { return new Set() }
  })

  function dismissBanner(p: string) {
    const next = new Set([...dismissedBanners, p])
    setDismissedBanners(next)
    localStorage.setItem('dismissedSocialBanners', JSON.stringify([...next]))
  }

  // ── Preferences ──────────────────────────────────────────────────────────────
  const { data: prefs, isLoading: prefsLoading } = usePreferences()
  const hasInterests = (prefs?.travel_styles?.length ?? 0) > 0

  useEffect(() => {
    if (!prefsLoading && !hasInterests) {
      setShowInterestsPicker(true)
    }
  }, [prefsLoading, hasInterests])

  // ── Determine view mode ───────────────────────────────────────────────────────
  // Any active filter → flat masonry grid.  No filter → multi-section home view.
  const hasActiveFilter = Boolean(destination || style || duration || platform)

  // ── Multi-section view (home) ─────────────────────────────────────────────────
  const { data: sectionsData, isLoading: sectionsLoading } = useFeedSections()

  // ── Flat filtered view ────────────────────────────────────────────────────────
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading: feedLoading } = useFeed({
    destination: destination || undefined,
    style: style || undefined,
    duration: duration || undefined,
    platform: platform || undefined,
  })

  // ── Live destination search ───────────────────────────────────────────────────
  const feedSearch = useFeedSearch()
  const prevDestRef = useRef('')

  useEffect(() => {
    if (destination && destination !== prevDestRef.current) {
      feedSearch.mutate(destination)
    }
    prevDestRef.current = destination
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination])

  // ── Deduplicated flat vlog list ───────────────────────────────────────────────
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

  // ── Infinite scroll sentinel ──────────────────────────────────────────────────
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

  // ── Social connect handler ────────────────────────────────────────────────────
  async function handleSocialConnect(p: 'tiktok' | 'instagram') {
    try {
      const { data } = await import('../lib/api').then(m => m.default.get<{ url: string }>(`/social/connect/${p}`))
      window.open(data.url, '_blank', 'width=600,height=700')
    } catch {
      // silently fail — user can try from profile page
    }
  }

  const isSearchingDestination = destination !== '' && feedSearch.isPending
  const showLoading = hasActiveFilter
    ? feedLoading || (destination && feedSearch.isPending)
    : sectionsLoading

  const sections = sectionsData?.sections ?? []

  // Determine if connected (simplistic: no show for users who've dismissed)
  const showTikTokBanner = !dismissedBanners.has('tiktok')
  const showInstagramBanner = !dismissedBanners.has('instagram')

  let itemIndex = 0

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Discover</h1>
            <p className="text-white/50 text-sm">
              {hasInterests
                ? 'Travel vlogs matched to your taste'
                : 'Set your interests to personalise your feed'}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
        </div>

        {/* ── Platform tabs ────────────────────────────────────────────────── */}
        <div className="mb-4">
          <PlatformFilter value={platform} onChange={setPlatform} />
        </div>

        {/* ── Filters ──────────────────────────────────────────────────────── */}
        <FeedFilters
          destination={destination}
          style={style}
          duration={duration}
          onDestinationChange={setDestination}
          onStyleChange={setStyle}
          onDurationChange={setDuration}
          isSearching={isSearchingDestination}
        />

        {/* ── Destination search label ──────────────────────────────────────── */}
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

        {/* ── Content ──────────────────────────────────────────────────────── */}
        {showLoading ? (
          <div className="flex justify-center py-20">
            <Spinner size="lg" />
          </div>
        ) : hasActiveFilter ? (
          /* ── Flat masonry grid (filters active) ── */
          vlogs.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">🎬</div>
              {destination ? (
                <>
                  <h3 className="text-white text-lg font-semibold mb-2">No vlogs found</h3>
                  <p className="text-white/50 text-sm">
                    No results for "{destination}" — try a different city or country.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-white text-lg font-semibold mb-2">No matches</h3>
                  <p className="text-white/50 text-sm">
                    No vlogs match this filter — try a different combination.
                  </p>
                </>
              )}
              <button
                onClick={() => { setDestination(''); setStyle(''); setDuration(''); setPlatform('') }}
                className="mt-4 px-5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-full text-sm transition-colors"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <>
              <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
                {vlogs.map((vlog) => (
                  <div key={vlog.id} className="break-inside-avoid">
                    <VlogCard vlog={vlog} index={itemIndex++} />
                  </div>
                ))}
              </div>
              {!destination && (
                <div ref={bottomRef} className="flex justify-center py-8">
                  {isFetchingNextPage && <Spinner />}
                  {!hasNextPage && vlogs.length > 0 && (
                    <p className="text-white/30 text-sm">You've seen it all ✨</p>
                  )}
                </div>
              )}
            </>
          )
        ) : (
          /* ── Multi-section home view (no filters) ── */
          sections.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">🎬</div>
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
            </div>
          ) : (
            <div>
              {/* Social connect banners (shown once per session unless dismissed) */}
              {showTikTokBanner && (
                <div className="relative">
                  <ConnectBanner
                    platform="tiktok"
                    onConnect={() => handleSocialConnect('tiktok')}
                  />
                  <button
                    onClick={() => dismissBanner('tiktok')}
                    className="absolute top-3 right-3 text-white/30 hover:text-white/60 text-xs"
                    aria-label="Dismiss"
                  >✕</button>
                </div>
              )}
              {showInstagramBanner && !showTikTokBanner && (
                <div className="relative">
                  <ConnectBanner
                    platform="instagram"
                    onConnect={() => handleSocialConnect('instagram')}
                  />
                  <button
                    onClick={() => dismissBanner('instagram')}
                    className="absolute top-3 right-3 text-white/30 hover:text-white/60 text-xs"
                    aria-label="Dismiss"
                  >✕</button>
                </div>
              )}

              {/* Section carousels */}
              {sections.map((section, i) => (
                <FeedSection key={section.id} section={section} sectionIndex={i} />
              ))}
            </div>
          )
        )}

        <BookingDrawer />
      </div>

      {/* Interests picker overlay */}
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
