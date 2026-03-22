import { useState, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import GlassCard from '../components/ui/GlassCard'
import GlassInput from '../components/ui/GlassInput'
import GlassButton from '../components/ui/GlassButton'
import toast from 'react-hot-toast'
import type { SocialConnection } from '../types/user'

export default function Profile() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const [name, setName] = useState(profile?.display_name ?? '')
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { data: connections, refetch: refetchConnections } = useQuery<SocialConnection[]>({
    queryKey: ['social-status'],
    queryFn: async () => { const { data } = await api.get('/social/status'); return data },
    refetchInterval: connecting ? 2000 : false,   // poll while OAuth popup is open
  })

  const disconnect = useMutation({
    mutationFn: (platform: string) => api.delete(`/social/connect/${platform}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['social-status'] }),
  })

  async function handleSave() {
    setSaving(true)
    try {
      await api.patch('/auth/profile', { display_name: name })
      toast.success('Profile updated')
    } catch { toast.error('Failed to update profile') }
    finally { setSaving(false) }
  }

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

      // Poll every 500 ms to detect when the popup closes
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        if (!popup.closed) return

        // Popup closed — clean up and refresh status
        clearInterval(pollRef.current!)
        pollRef.current = null
        setConnecting(false)
        toast.dismiss('yt-connect')

        // Immediately refetch, then retry a few times while backend finishes
        await refetchConnections()
        let attempts = 0
        const retryTimer = setInterval(async () => {
          attempts++
          const { data: fresh } = await api.get<SocialConnection[]>('/social/status')
          if (fresh.some((c) => c.platform === 'youtube')) {
            clearInterval(retryTimer)
            qc.setQueryData(['social-status'], fresh)
            toast.success('YouTube connected! Seeding your feed…')
            // Give the backend ~8 s to seed then refresh the feed
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

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-white">Profile</h1>

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
                className="text-brand-400 hover:text-brand-300 text-xs transition-colors disabled:opacity-40"
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
