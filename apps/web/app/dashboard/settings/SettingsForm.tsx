'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Tier {
  id: string
  name: string
  monthlyPrice: number
  description: string | null
  perks: string[]
  isActive: boolean
}

interface Creator {
  id: string
  handle: string
  displayName: string
  bio: string | null
  location: string | null
  websiteUrl: string | null
  avatarUrl: string | null
  youtubeChannelId: string | null
  youtubeHandle: string | null
  tiktokUserId: string | null
  tiktokHandle: string | null
  stripeAccountId: string | null
  plan: 'FREE' | 'PRO' | 'STUDIO'
  isPublished: boolean
  catalogScanStatus: string
  tiers: Tier[]
}

interface Props {
  userId: string
  email: string
  creator: Creator | null
}

const planDetails = {
  FREE: { label: 'Free', description: 'Up to 3 Trip Kits, basic features', price: '$0/mo' },
  PRO: { label: 'Pro', description: 'Unlimited kits, AI scan, advanced analytics', price: '$49/mo' },
  STUDIO: { label: 'Studio', description: 'Team seats, brand inbox, white-label domain', price: '$199/mo' },
}

export default function SettingsForm({ userId, email, creator }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<'profile' | 'channels' | 'tiers' | 'billing'>('profile')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [profile, setProfile] = useState({
    handle: creator?.handle ?? '',
    displayName: creator?.displayName ?? '',
    bio: creator?.bio ?? '',
    location: creator?.location ?? '',
    websiteUrl: creator?.websiteUrl ?? '',
  })

  function setP(key: keyof typeof profile, val: string) {
    setProfile(prev => ({ ...prev, [key]: val }))
  }

  async function saveProfile() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch('/api/creator/profile', {
        method: creator ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...profile, userId }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? 'Save failed')
      }
      setSuccess('Profile saved')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  async function togglePublish() {
    if (!creator) return
    setSaving(true)
    try {
      await fetch('/api/creator/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublished: !creator.isPublished }),
      })
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function connectYouTube() {
    const res = await fetch('/api/auth/youtube')
    const { url } = await res.json()
    window.location.href = url
  }

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30'
  const labelCls = 'block text-xs font-medium text-white/50 uppercase tracking-wider mb-1.5'
  const tabs = ['profile', 'channels', 'tiers', 'billing'] as const

  return (
    <div className="max-w-2xl">
      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-white/10">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors ${
              tab === t ? 'text-white border-b-2 border-white -mb-px' : 'text-white/40 hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <div className="glass-card p-3 mb-4 text-red-400 text-sm">{error}</div>}
      {success && <div className="glass-card p-3 mb-4 text-green-400 text-sm">{success}</div>}

      {/* Profile tab */}
      {tab === 'profile' && (
        <div className="space-y-5">
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-white">Public Profile</h2>
              {creator && (
                <button
                  onClick={togglePublish}
                  disabled={saving}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    creator.isPublished
                      ? 'border-green-500/30 text-green-400 hover:border-green-500/60'
                      : 'border-white/10 text-white/40 hover:border-white/30'
                  }`}
                >
                  {creator.isPublished ? '● Live' : '○ Unpublished'}
                </button>
              )}
            </div>

            <div>
              <label className={labelCls}>Handle *</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-white/30">@</span>
                <input className={inputCls} placeholder="yourhandle" value={profile.handle} onChange={e => setP('handle', e.target.value)} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Display Name *</label>
              <input className={inputCls} placeholder="Your Name" value={profile.displayName} onChange={e => setP('displayName', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Bio</label>
              <textarea className={`${inputCls} resize-none`} rows={3} placeholder="Tell your audience what you're about…" value={profile.bio} onChange={e => setP('bio', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Location</label>
                <input className={inputCls} placeholder="New York, USA" value={profile.location} onChange={e => setP('location', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Website</label>
                <input className={inputCls} placeholder="https://yoursite.com" value={profile.websiteUrl} onChange={e => setP('websiteUrl', e.target.value)} />
              </div>
            </div>
          </div>

          <button onClick={saveProfile} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      )}

      {/* Channels tab */}
      {tab === 'channels' && (
        <div className="space-y-4">
          {/* YouTube */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                  <span className="text-lg">▶</span>
                </div>
                <div>
                  <p className="font-medium text-white">YouTube</p>
                  {creator?.youtubeHandle
                    ? <p className="text-xs text-white/40">Connected as @{creator.youtubeHandle}</p>
                    : <p className="text-xs text-white/40">Not connected</p>}
                </div>
              </div>
              {creator?.youtubeChannelId ? (
                <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-400">Connected</span>
              ) : (
                <button onClick={connectYouTube} className="btn-primary text-sm">Connect</button>
              )}
            </div>
            {creator?.youtubeChannelId && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <p className="text-xs text-white/40 mb-3">AI Catalog Scan: <span className="text-white">{creator.catalogScanStatus}</span></p>
                {creator.catalogScanStatus === 'PENDING' || creator.catalogScanStatus === 'COMPLETE' ? (
                  <button
                    onClick={async () => {
                      await fetch('/api/creator/scan', { method: 'POST' })
                      router.refresh()
                    }}
                    className="btn-ghost text-sm"
                  >
                    {creator.catalogScanStatus === 'COMPLETE' ? 'Re-run scan' : 'Start scan'}
                  </button>
                ) : null}
              </div>
            )}
          </div>

          {/* TikTok */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                  <span className="text-lg">♪</span>
                </div>
                <div>
                  <p className="font-medium text-white">TikTok</p>
                  {creator?.tiktokHandle
                    ? <p className="text-xs text-white/40">Connected as @{creator.tiktokHandle}</p>
                    : <p className="text-xs text-white/40">Not connected — metadata only</p>}
                </div>
              </div>
              {creator?.tiktokUserId ? (
                <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-400">Connected</span>
              ) : (
                <button className="btn-primary text-sm" onClick={() => window.location.href = '/api/auth/tiktok'}>Connect</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tiers tab */}
      {tab === 'tiers' && (
        <div className="space-y-4">
          <p className="text-white/40 text-sm">Configure your subscription tiers. Free followers don&apos;t need a tier.</p>
          {creator?.tiers.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <p className="text-white/40 text-sm mb-4">No tiers configured yet.</p>
              <button className="btn-primary text-sm" onClick={() => alert('Tier editor coming soon')}>Create first tier</button>
            </div>
          ) : (
            creator?.tiers.map(tier => (
              <div key={tier.id} className="glass-card p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-white">{tier.name}</p>
                    <p className="text-sm text-white/40 mt-0.5">${(tier.monthlyPrice / 100).toFixed(0)}/month</p>
                    {tier.description && <p className="text-xs text-white/30 mt-2">{tier.description}</p>}
                    {tier.perks.length > 0 && (
                      <ul className="mt-3 space-y-1">
                        {tier.perks.map((perk, i) => <li key={i} className="text-xs text-white/50">✓ {perk}</li>)}
                      </ul>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${tier.isActive ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40'}`}>
                    {tier.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Billing tab */}
      {tab === 'billing' && (
        <div className="space-y-4">
          <div className="glass-card p-6">
            <h2 className="font-semibold text-white mb-4">VlogShopper Plan</h2>
            <div className="space-y-3">
              {(Object.entries(planDetails) as [keyof typeof planDetails, typeof planDetails.FREE][]).map(([key, p]) => (
                <div key={key} className={`flex items-center justify-between p-4 rounded-xl border ${creator?.plan === key ? 'border-white/30 bg-white/5' : 'border-white/10'}`}>
                  <div>
                    <p className="font-medium text-white">{p.label}</p>
                    <p className="text-xs text-white/40">{p.description}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-white">{p.price}</p>
                    {creator?.plan === key && <p className="text-xs text-green-400">Current plan</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-white/30">To upgrade your plan, contact us or use the in-app upgrade flow (coming soon).</p>
        </div>
      )}
    </div>
  )
}
