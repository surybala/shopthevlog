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

  // ── Generic OAuth popup helper ─────────────────────────────────────────
  async function connectPlatform(platform: 'youtube' | 'tiktok' | 'instagram') {
    const toastId = `${platform}-connect`
    const labels: Record<string, string> = {
      youtube: 'YouTube',
      tiktok: 'TikTok',
      instagram: 'Instagram',
    }
    const label = labels[platform]

    try {
      const { data } = await api.get<{ url: string }>(`/social/connect/${platform}`)
      const popup = window.open(data.url, `${platform}-oauth`, 'width=560,height=680,left=200,top=100')
      if (!popup) {
        toast.error('Popup blocked — please allow popups for this site and try again.')
        return
      }

      setConnecting(true)
      toast.loading(`Waiting for ${label} authorization…`, { id: toastId })

      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        if (!popup.closed) return

        clearInterval(pollRef.current!)
        pollRef.current = null
        setConnecting(false)
        toast.dismiss(toastId)

        await refetchConnections()
        let attempts = 0
        const retryTimer = setInterval(async () => {
          attempts++
          const { data: fresh } = await api.get<SocialConnection[]>('/social/status')
          if (fresh.some((c) => c.platform === platform)) {
            clearInterval(retryTimer)
            qc.setQueryData(['social-status'], fresh)
            toast.success(`${label} connected! Refreshing your feed…`)
            setTimeout(() => qc.invalidateQueries({ queryKey: ['feed'] }), 8000)
          } else if (attempts >= 6) {
            clearInterval(retryTimer)
            toast.error(`${label} connection not detected. Please try again.`)
          }
        }, 1500)
      }, 500)
    } catch {
      toast.dismiss(toastId)
      setConnecting(false)
      toast.error(`Failed to start ${label} connection`)
    }
  }

  const ytConnected = connections?.find((c) => c.platform === 'youtube')
  const ttConnected = connections?.find((c) => c.platform === 'tiktok')
  const igConnected = connections?.find((c) => c.platform === 'instagram')
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
        <h2 className="font-semibold text-white mb-1">Connected accounts</h2>
        <p className="text-white/50 text-xs mb-4">
          Link social accounts to personalise your feed with content from creators you follow.
        </p>
        <div className="space-y-3">

          {/* YouTube */}
          <div className="flex items-center justify-between p-3 glass-sm rounded-xl">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-red-600/20 flex items-center justify-center">
                <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1C4.5 20.5 12 20.5 12 20.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.75 15.5v-7l6.5 3.5-6.5 3.5z"/>
                </svg>
              </div>
              {ytConnected ? (
                <div>
                  <p className="text-white text-sm font-medium">YouTube</p>
                  <p className="text-white/50 text-xs">@{ytConnected.platform_username ?? 'connected'}</p>
                </div>
              ) : (
                <div>
                  <p className="text-white/80 text-sm font-medium">YouTube</p>
                  <p className="text-white/40 text-xs">{connecting ? 'Connecting…' : 'Not connected'}</p>
                </div>
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
                onClick={() => connectPlatform('youtube')}
                disabled={connecting}
                className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white text-xs rounded-full transition-colors disabled:opacity-40"
              >
                {connecting ? 'Waiting…' : 'Connect'}
              </button>
            )}
          </div>

          {/* TikTok */}
          <div className="flex items-center justify-between p-3 glass-sm rounded-xl">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-white/80" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.69a8.15 8.15 0 0 0 4.77 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z"/>
                </svg>
              </div>
              {ttConnected ? (
                <div>
                  <p className="text-white text-sm font-medium">TikTok</p>
                  <p className="text-white/50 text-xs">@{ttConnected.platform_username ?? 'connected'}</p>
                </div>
              ) : (
                <div>
                  <p className="text-white/80 text-sm font-medium">TikTok</p>
                  <p className="text-white/40 text-xs">
                    {connecting ? 'Connecting…' : 'Not connected'}
                  </p>
                </div>
              )}
            </div>
            {ttConnected ? (
              <button
                onClick={() => disconnect.mutate('tiktok')}
                className="text-red-400 hover:text-red-300 text-xs transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={() => connectPlatform('tiktok')}
                disabled={connecting}
                className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white text-xs rounded-full transition-colors disabled:opacity-40"
              >
                {connecting ? 'Waiting…' : 'Connect'}
              </button>
            )}
          </div>

          {/* Instagram */}
          <div className="flex items-center justify-between p-3 glass-sm rounded-xl">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500/20 via-pink-500/20 to-orange-400/20 flex items-center justify-center">
                <svg className="w-4 h-4 text-pink-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
                </svg>
              </div>
              {igConnected ? (
                <div>
                  <p className="text-white text-sm font-medium">Instagram</p>
                  <p className="text-white/50 text-xs">@{igConnected.platform_username ?? 'connected'}</p>
                </div>
              ) : (
                <div>
                  <p className="text-white/80 text-sm font-medium">Instagram</p>
                  <p className="text-white/40 text-xs">
                    {connecting ? 'Connecting…' : 'Not connected'}
                  </p>
                </div>
              )}
            </div>
            {igConnected ? (
              <button
                onClick={() => disconnect.mutate('instagram')}
                className="text-red-400 hover:text-red-300 text-xs transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={() => connectPlatform('instagram')}
                disabled={connecting}
                className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white text-xs rounded-full transition-colors disabled:opacity-40"
              >
                {connecting ? 'Waiting…' : 'Connect'}
              </button>
            )}
          </div>

        </div>
      </GlassCard>
    </div>
  )
}
