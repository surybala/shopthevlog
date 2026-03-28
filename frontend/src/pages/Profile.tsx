import { useState, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import GlassCard from '../components/ui/GlassCard'
import GlassInput from '../components/ui/GlassInput'
import GlassButton from '../components/ui/GlassButton'
import toast from 'react-hot-toast'
import type { SocialConnection } from '../types/user'
import { INTERESTS } from '../constants/interests'
import { usePreferences, useUpdatePreferences } from '../hooks/usePreferences'

export default function Profile() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const [name, setName] = useState(profile?.display_name ?? '')
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Social connections ─────────────────────────────────────────────────
  const { data: connections, refetch: refetchConnections } = useQuery<SocialConnection[]>({
    queryKey: ['social-status'],
    queryFn: async () => { const { data } = await api.get('/social/status'); return data },
    refetchInterval: connecting ? 2000 : false,
  })

  const disconnect = useMutation({
    mutationFn: (platform: string) => api.delete(`/social/connect/${platform}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['social-status'] }),
  })

  // ── Taste preferences ──────────────────────────────────────────────────
  const { data: prefs } = usePreferences()
  const updatePrefs = useUpdatePreferences()

  const [selectedStyles, setSelectedStyles] = useState<Set<string>>(
    new Set(prefs?.travel_styles?.map((s) => s.toLowerCase()) ?? [])
  )

  // Sync once prefs load (the Set is initialized empty before the query resolves)
  const [syncedPrefs, setSyncedPrefs] = useState(false)
  if (prefs && !syncedPrefs) {
    setSelectedStyles(new Set(prefs.travel_styles?.map((s) => s.toLowerCase()) ?? []))
    setSyncedPrefs(true)
  }

  function toggleStyle(tag: string) {
    setSelectedStyles((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  async function saveInterests() {
    try {
      await updatePrefs.mutateAsync({ travel_styles: Array.from(selectedStyles) })
      toast.success('Interests updated — rebuilding your feed…')
    } catch {
      toast.error('Failed to save interests')
    }
  }

  // ── Profile save ───────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true)
    try {
      await api.patch('/auth/profile', { display_name: name })
      toast.success('Profile updated')
    } catch { toast.error('Failed to update profile') }
    finally { setSaving(false) }
  }

  // ── YouTube OAuth ──────────────────────────────────────────────────────
  async function connectYouTube() {
    try {
      const { data } = await api.get<{ url: string }>('/social/connect/youtube')
      const popup = window.open(data.url, 'yt-oauth', 'width=520,height=650,left=200,top=100')
      if (!popup) {
        toast.error('Popup blocked — please allow popups for this site and try again.')
        return
      }

      setConnecting(true)
      toast.loading('Waiting for YouTube authorization…', { id: 'yt-connect' })

      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        if (!popup.closed) return

        clearInterval(pollRef.current!)
        pollRef.current = null
        setConnecting(false)
        toast.dismiss('yt-connect')

        await refetchConnections()
        let attempts = 0
        const retryTimer = setInterval(async () => {
          attempts++
          const { data: fresh } = await api.get<SocialConnection[]>('/social/status')
          if (fresh.some((c) => c.platform === 'youtube')) {
            clearInterval(retryTimer)
            qc.setQueryData(['social-status'], fresh)
            toast.success('YouTube connected! Seeding your feed…')
            setTimeout(() => qc.invalidateQueries({ queryKey: ['feed'] }), 8000)
          } else if (attempts >= 6) {
            clearInterval(retryTimer)
            toast.error('YouTube connection not detected. Please try again.')
          }
        }, 1500)
      }, 500)
    } catch {
      toast.dismiss('yt-connect')
      setConnecting(false)
      toast.error('Failed to start YouTube connection')
    }
  }

  const ytConnected = connections?.find((c) => c.platform === 'youtube')
  const interestsChanged =
    JSON.stringify([...selectedStyles].sort()) !==
    JSON.stringify((prefs?.travel_styles ?? []).map((s) => s.toLowerCase()).sort())

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-white">Profile</h1>

      {/* Account card */}
      <GlassCard>
        <h2 className="font-semibold text-white mb-4">Account</h2>
        <div className="space-y-4">
          <GlassInput
            label="Display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <GlassInput
            label="Email"
            value={profile ? '' : ''}
            disabled
            placeholder="Managed by Supabase Auth"
          />
          <GlassButton onClick={handleSave} loading={saving} size="sm">
            Save changes
          </GlassButton>
        </div>
      </GlassCard>

      {/* Travel interests card */}
      <GlassCard>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-white">Travel interests</h2>
          {selectedStyles.size > 0 && (
            <span className="text-white/40 text-xs">
              {selectedStyles.size} selected
            </span>
          )}
        </div>
        <p className="text-white/50 text-xs mb-4">
          These shape the vlogs shown in your Discover feed.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          {INTERESTS.map((interest) => {
            const isSelected = selectedStyles.has(interest.tag)
            return (
              <button
                key={interest.tag}
                onClick={() => toggleStyle(interest.tag)}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                  transition-all duration-200 border
                  ${isSelected
                    ? 'bg-white text-black border-white'
                    : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white hover:border-white/20'
                  }
                `}
              >
                <span>{interest.emoji}</span>
                <span>{interest.label}</span>
              </button>
            )
          })}
        </div>

        <GlassButton
          onClick={saveInterests}
          loading={updatePrefs.isPending}
          disabled={!interestsChanged || selectedStyles.size === 0}
          size="sm"
        >
          Save interests
        </GlassButton>
      </GlassCard>

      {/* Connected accounts */}
      <GlassCard>
        <h2 className="font-semibold text-white mb-4">Connected accounts</h2>
        <div className="space-y-3">
          {/* YouTube */}
          <div className="flex items-center justify-between p-3 glass-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                <span className="text-red-400 text-xs font-bold">YT</span>
              </div>
              {ytConnected ? (
                <div>
                  <p className="text-white text-sm font-medium">YouTube</p>
                  <p className="text-white/50 text-xs">@{ytConnected.platform_username ?? 'connected'}</p>
                </div>
              ) : (
                <p className="text-white/60 text-sm">
                  {connecting ? 'Connecting…' : 'YouTube not connected'}
                </p>
              )}
            </div>
            {ytConnected ? (
              <button
                onClick={() => disconnect.mutate('youtube')}
                className="text-red-400 hover:text-red-300 text-xs transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={connectYouTube}
                disabled={connecting}
                className="text-white/60 hover:text-white text-xs transition-colors disabled:opacity-40"
              >
                {connecting ? 'Waiting…' : 'Connect'}
              </button>
            )}
          </div>

          {/* Instagram — coming soon */}
          <div className="flex items-center justify-between p-3 glass-sm opacity-50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-pink-500/20 flex items-center justify-center">
                <span className="text-pink-400 text-xs">IG</span>
              </div>
              <p className="text-white/60 text-sm">Instagram — coming soon</p>
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}
