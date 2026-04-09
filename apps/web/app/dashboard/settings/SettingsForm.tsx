'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getCreatorPlanConfig } from '@/lib/creatorPlans'

interface Tier {
  id: string
  name: string
  monthlyPrice: number
  yearlyPrice?: number | null
  description: string | null
  perks: string[]
  kitAccess: 'FREE' | 'FOLLOWER' | 'PREMIUM'
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

const emptyTierForm = {
  name: '',
  monthlyPrice: '',
  yearlyPrice: '',
  description: '',
  perksRaw: '',
  kitAccess: 'FREE' as 'FREE' | 'FOLLOWER' | 'PREMIUM',
}

export default function SettingsForm({ userId, email, creator }: Props) {
  const router = useRouter()
  const tabs = ['profile', 'channels', 'tiers', 'billing'] as const
  const [tab, setTab] = useState<'profile' | 'channels' | 'tiers' | 'billing'>('profile')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [scanStatus, setScanStatus] = useState(creator?.catalogScanStatus ?? 'PENDING')
  const [vlogCount, setVlogCount] = useState(0)
  const planConfig = getCreatorPlanConfig(creator?.plan)
  const billingPlans = {
    FREE: getCreatorPlanConfig('FREE'),
    PRO: getCreatorPlanConfig('PRO'),
    STUDIO: getCreatorPlanConfig('STUDIO'),
  } as const

  // Tier management state
  const [showTierForm, setShowTierForm] = useState(false)
  const [tierForm, setTierForm] = useState(emptyTierForm)
  const [tierSaving, setTierSaving] = useState(false)
  const [tierError, setTierError] = useState('')
  const [editingTierId, setEditingTierId] = useState<string | null>(null)

  // Sync tab from URL query param (e.g., after OAuth redirect)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('tab') as typeof tab | null
    if (t && tabs.includes(t)) setTab(t)
    const connected = params.get('connected')
    if (connected) setSuccess(`${connected.charAt(0).toUpperCase() + connected.slice(1)} connected successfully!`)
    const err = params.get('error')
    if (err) setError(`Connection failed: ${err.replace(/_/g, ' ')}`)
  }, [])

  useEffect(() => {
    if (!creator?.youtubeChannelId) return
    void (async () => {
      const res = await fetch('/api/creator/scan/status')
      if (!res.ok) return
      const data = await res.json()
      setScanStatus(data.status)
      setVlogCount(data.vlogCount)
    })()
  }, [creator?.youtubeChannelId])

  useEffect(() => {
    if (scanStatus !== 'SCANNING') return
    const interval = setInterval(async () => {
      const res = await fetch('/api/creator/scan/status')
      if (res.ok) {
        const data = await res.json()
        setScanStatus(data.status)
        setVlogCount(data.vlogCount)
        if (data.status !== 'SCANNING') clearInterval(interval)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [scanStatus])

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

  // ── Tier management helpers ──────────────────────────────────────────────────

  function openCreateTier() {
    setEditingTierId(null)
    setTierForm(emptyTierForm)
    setTierError('')
    setShowTierForm(true)
  }

  function openEditTier(tier: Tier) {
    setEditingTierId(tier.id)
    setTierForm({
      name: tier.name,
      monthlyPrice: String(tier.monthlyPrice / 100),
      yearlyPrice: tier.yearlyPrice ? String(tier.yearlyPrice / 100) : '',
      description: tier.description ?? '',
      perksRaw: tier.perks.join('\n'),
      kitAccess: tier.kitAccess,
    })
    setTierError('')
    setShowTierForm(true)
  }

  function cancelTierForm() {
    setShowTierForm(false)
    setEditingTierId(null)
    setTierForm(emptyTierForm)
    setTierError('')
  }

  async function saveTier() {
    setTierSaving(true)
    setTierError('')
    try {
      const perks = tierForm.perksRaw
        .split('\n')
        .map(p => p.trim())
        .filter(Boolean)

      if (editingTierId) {
        // PATCH — only name/description/perks/kitAccess can change (price is immutable)
        const res = await fetch(`/api/tiers/${editingTierId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: tierForm.name,
            description: tierForm.description || null,
            perks,
            kitAccess: tierForm.kitAccess,
          }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error ?? 'Failed to update tier')
        }
      } else {
        // POST — create tier, syncs Stripe Product + Price
        const monthlyPriceCents = Math.round(parseFloat(tierForm.monthlyPrice) * 100)
        const yearlyPriceCents = tierForm.yearlyPrice
          ? Math.round(parseFloat(tierForm.yearlyPrice) * 100)
          : undefined
        if (!monthlyPriceCents || monthlyPriceCents < 100) {
          throw new Error('Monthly price must be at least $1')
        }
        const res = await fetch('/api/tiers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: tierForm.name,
            monthlyPrice: monthlyPriceCents,
            yearlyPrice: yearlyPriceCents,
            description: tierForm.description || null,
            perks,
            kitAccess: tierForm.kitAccess,
          }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error ?? 'Failed to create tier')
        }
      }

      cancelTierForm()
      router.refresh()
    } catch (e) {
      setTierError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setTierSaving(false)
    }
  }

  async function deactivateTier(tierId: string) {
    if (!window.confirm('Deactivate this tier? Subscribers keep access until their billing period ends.')) return
    try {
      const res = await fetch(`/api/tiers/${tierId}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d.error ?? 'Failed to deactivate tier')
        return
      }
      router.refresh()
    } catch {
      alert('Something went wrong')
    }
  }

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30'
  const labelCls = 'block text-xs font-medium text-white/50 uppercase tracking-wider mb-1.5'

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

      {/* ── Profile tab ── */}
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

      {/* ── Channels tab ── */}
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
              <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-white/40">Catalog scan:</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    scanStatus === 'COMPLETE' ? 'bg-green-500/20 text-green-400' :
                    scanStatus === 'SCANNING' ? 'bg-yellow-500/20 text-yellow-400 animate-pulse' :
                    scanStatus === 'FAILED' ? 'bg-red-500/20 text-red-400' :
                    'bg-white/10 text-white/40'
                  }`}>
                    {scanStatus === 'SCANNING' ? 'Scanning…' : scanStatus}
                  </span>
                  {scanStatus === 'COMPLETE' && vlogCount > 0 && (
                    <span className="text-xs text-white/30">{vlogCount}/{planConfig.maxImportedVlogs} videos imported</span>
                  )}
                </div>
                <p className="text-xs text-white/30">
                  Your {planConfig.label} plan currently includes up to {planConfig.maxImportedVlogs} imported videos.
                </p>
                {(scanStatus === 'PENDING' || scanStatus === 'COMPLETE' || scanStatus === 'FAILED') && (
                  <button
                    onClick={async () => {
                      const res = await fetch('/api/creator/scan', { method: 'POST' })
                      if (res.ok) setScanStatus('SCANNING')
                    }}
                    className="btn-ghost text-sm"
                  >
                    {scanStatus === 'COMPLETE' ? 'Re-scan' : 'Start scan'}
                  </button>
                )}
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

      {/* ── Tiers tab ── */}
      {tab === 'tiers' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-white/40 text-sm">Paid tiers unlock gated Trip Kits. Free followers don&apos;t need one.</p>
            {!showTierForm && (
              <button onClick={openCreateTier} className="btn-primary text-sm">+ New tier</button>
            )}
          </div>

          {/* Create / edit form */}
          {showTierForm && (
            <div className="glass-card p-6 space-y-4 border border-white/20">
              <h3 className="font-semibold text-white">
                {editingTierId ? 'Edit tier' : 'Create new tier'}
              </h3>

              {tierError && (
                <div className="text-red-400 text-sm bg-red-500/10 rounded-lg px-3 py-2">{tierError}</div>
              )}

              <div>
                <label className={labelCls}>Tier name *</label>
                <input
                  className={inputCls}
                  placeholder="e.g. Explorer, Premium, All Access"
                  value={tierForm.name}
                  onChange={e => setTierForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Monthly price (USD) *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm">$</span>
                    <input
                      className={`${inputCls} pl-7`}
                      placeholder="9"
                      type="number"
                      min="1"
                      step="1"
                      value={tierForm.monthlyPrice}
                      onChange={e => setTierForm(f => ({ ...f, monthlyPrice: e.target.value }))}
                      disabled={!!editingTierId}
                    />
                  </div>
                  {editingTierId && (
                    <p className="text-xs text-white/20 mt-1">Price is locked — create a new tier to change it.</p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Yearly price (USD, optional)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm">$</span>
                    <input
                      className={`${inputCls} pl-7`}
                      placeholder="90"
                      type="number"
                      min="1"
                      step="1"
                      value={tierForm.yearlyPrice}
                      onChange={e => setTierForm(f => ({ ...f, yearlyPrice: e.target.value }))}
                      disabled={!!editingTierId}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className={labelCls}>Description</label>
                <textarea
                  className={`${inputCls} resize-none`}
                  rows={2}
                  placeholder="What do subscribers get at a glance?"
                  value={tierForm.description}
                  onChange={e => setTierForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div>
                <label className={labelCls}>Perks (one per line)</label>
                <textarea
                  className={`${inputCls} resize-none font-mono text-xs`}
                  rows={4}
                  placeholder={'All premium Trip Kits\nEarly access to new drops\nExclusive gear guides'}
                  value={tierForm.perksRaw}
                  onChange={e => setTierForm(f => ({ ...f, perksRaw: e.target.value }))}
                />
              </div>

              <div>
                <label className={labelCls}>Kit access level</label>
                <select
                  className={inputCls}
                  value={tierForm.kitAccess}
                  onChange={e =>
                    setTierForm(f => ({ ...f, kitAccess: e.target.value as 'FREE' | 'FOLLOWER' | 'PREMIUM' }))
                  }
                >
                  <option value="FREE">Free — no extra kit access beyond free kits</option>
                  <option value="FOLLOWER">Follower — unlocks follower-gated kits</option>
                  <option value="PREMIUM">Premium — unlocks all kits including premium</option>
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={saveTier}
                  disabled={tierSaving || !tierForm.name.trim() || (!editingTierId && !tierForm.monthlyPrice)}
                  className="btn-primary disabled:opacity-50"
                >
                  {tierSaving ? 'Saving…' : editingTierId ? 'Save changes' : 'Create tier'}
                </button>
                <button onClick={cancelTierForm} disabled={tierSaving} className="btn-ghost">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Existing tiers */}
          {creator?.tiers.length === 0 && !showTierForm && (
            <div className="glass-card p-8 text-center">
              <p className="text-white/40 text-sm mb-4">No tiers yet. Create your first paid subscription tier.</p>
              <button className="btn-primary text-sm" onClick={openCreateTier}>Create first tier</button>
            </div>
          )}

          {creator?.tiers.map(tier => (
            <div key={tier.id} className="glass-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="font-semibold text-white">{tier.name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${tier.isActive ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40'}`}>
                      {tier.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/30 uppercase">
                      {tier.kitAccess} access
                    </span>
                  </div>
                  <p className="text-sm text-white/40">
                    ${(tier.monthlyPrice / 100).toFixed(0)}/mo
                    {tier.yearlyPrice ? ` · $${(tier.yearlyPrice / 100).toFixed(0)}/yr` : ''}
                  </p>
                  {tier.description && <p className="text-xs text-white/30 mt-2">{tier.description}</p>}
                  {tier.perks.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {tier.perks.map((perk, i) => (
                        <li key={i} className="text-xs text-white/50">✓ {perk}</li>
                      ))}
                    </ul>
                  )}
                </div>
                {tier.isActive && !showTierForm && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => openEditTier(tier)}
                      className="text-xs btn-ghost py-1 px-3"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deactivateTier(tier.id)}
                      className="text-xs px-3 py-1 rounded-lg border border-red-500/20 text-red-400 hover:border-red-500/40 transition-colors"
                    >
                      Deactivate
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Billing tab ── */}
      {tab === 'billing' && (
        <div className="space-y-4">
          <div className="glass-card p-6">
            <h2 className="font-semibold text-white mb-4">VlogShopper Plan</h2>
            <div className="space-y-3">
              {(Object.entries(billingPlans) as [keyof typeof billingPlans, typeof billingPlans.FREE][]).map(
                ([key, p]) => (
                  <div
                    key={key}
                    className={`flex items-center justify-between p-4 rounded-xl border ${
                      creator?.plan === key ? 'border-white/30 bg-white/5' : 'border-white/10'
                    }`}
                  >
                    <div>
                      <p className="font-medium text-white">{p.label}</p>
                      <p className="text-xs text-white/40">{p.description}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-white">{p.price}</p>
                      {creator?.plan === key && <p className="text-xs text-green-400">Current plan</p>}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
          <p className="text-xs text-white/30">
            To upgrade your plan, contact us or use the in-app upgrade flow (coming soon).
          </p>
        </div>
      )}
    </div>
  )
}
