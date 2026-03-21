import { useState } from 'react'
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

  const { data: connections } = useQuery<SocialConnection[]>({
    queryKey: ['social-status'],
    queryFn: async () => { const { data } = await api.get('/social/status'); return data },
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
      window.open(data.url, '_blank', 'width=500,height=600')
    } catch { toast.error('Failed to connect YouTube') }
  }

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
          {(() => {
            const yt = connections?.find((c) => c.platform === 'youtube')
            return yt ? (
              <div className="flex items-center justify-between p-3 glass-sm">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                    <span className="text-red-400 text-xs">YT</span>
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">YouTube</p>
                    <p className="text-white/50 text-xs">@{yt.platform_username ?? 'connected'}</p>
                  </div>
                </div>
                <button
                  onClick={() => disconnect.mutate('youtube')}
                  className="text-red-400 hover:text-red-300 text-xs transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 glass-sm">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                    <span className="text-red-400 text-xs">YT</span>
                  </div>
                  <p className="text-white/60 text-sm">YouTube not connected</p>
                </div>
                <button onClick={connectYouTube} className="text-brand-400 hover:text-brand-300 text-xs transition-colors">
                  Connect
                </button>
              </div>
            )
          })()}

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
