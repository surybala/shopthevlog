'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getCreatorPlanConfig } from '@/lib/creatorPlans'
import { getStorefrontTheme, STOREFRONT_THEMES, type StorefrontThemeId } from '@/lib/storefrontThemes'
import { resolveStorageAssetUrl } from '@/lib/storageAssets'

interface Tier { id: string; name: string; monthlyPrice: number; yearlyPrice?: number | null; description: string | null; perks: string[]; kitAccess: 'FREE' | 'FOLLOWER' | 'PREMIUM'; isActive: boolean }
interface Creator {
  id: string; handle: string; displayName: string; bio: string | null; coverImageUrl: string | null; location: string | null; websiteUrl: string | null; avatarUrl: string | null;
  storefrontTheme: StorefrontThemeId; storefrontTagline: string | null; storefrontIntro: string | null; storefrontMoodImageUrl: string | null; storefrontGalleryImages: string[];
  youtubeChannelId: string | null; youtubeHandle: string | null; tiktokUserId: string | null; tiktokHandle: string | null; stripeAccountId: string | null;
  payoutsEnabled: boolean; plan: 'FREE' | 'PRO' | 'STUDIO'; isPublished: boolean; catalogScanStatus: string; tiers: Tier[]
}
interface Props { userId: string; email: string; creator: Creator | null }

const emptyTierForm = { name: '', monthlyPrice: '', yearlyPrice: '', description: '', perksRaw: '', kitAccess: 'FREE' as const }
const tabBase = 'px-4 py-2.5 text-sm font-medium capitalize transition-colors'
const sectionTitle = 'font-semibold text-[#17332d]'
const sectionCopy = 'mt-1 text-sm text-[rgba(23,51,45,0.62)]'
const metaText = 'text-xs text-[rgba(23,51,45,0.52)]'

export default function SettingsForm({ userId, creator }: Props) {
  const router = useRouter()
  const tabs = ['profile', 'storefront', 'channels', 'tiers', 'billing'] as const
  const [tab, setTab] = useState<'profile' | 'storefront' | 'channels' | 'tiers' | 'billing'>('profile')
  const [saving, setSaving] = useState(false)
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [scanStatus, setScanStatus] = useState(creator?.catalogScanStatus ?? 'PENDING')
  const [vlogCount, setVlogCount] = useState(0)
  const [remainingProcessingCredits, setRemainingProcessingCredits] = useState<number | null>(null)
  const [processingCreditLimit, setProcessingCreditLimit] = useState<number | null>(null)
  const planConfig = getCreatorPlanConfig(creator?.plan)
  const billingPlans = { FREE: getCreatorPlanConfig('FREE'), PRO: getCreatorPlanConfig('PRO'), STUDIO: getCreatorPlanConfig('STUDIO') } as const
  const [showTierForm, setShowTierForm] = useState(false)
  const [tierForm, setTierForm] = useState(emptyTierForm)
  const [tierSaving, setTierSaving] = useState(false)
  const [tierError, setTierError] = useState('')
  const [editingTierId, setEditingTierId] = useState<string | null>(null)
  const [uploading, setUploading] = useState<'cover' | 'mood' | 'gallery' | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('tab') as typeof tab | null
    if (t && tabs.includes(t)) setTab(t)
    const connected = params.get('connected')
    if (connected) setSuccess(`${connected.charAt(0).toUpperCase() + connected.slice(1)} connected successfully!`)
    const stripe = params.get('stripe')
    if (stripe === 'connected') setSuccess('Stripe onboarding completed. If more details are needed, you can resume setup from billing.')
    if (stripe === 'missing') setError('Connect Stripe first before opening the Stripe dashboard.')
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
      setRemainingProcessingCredits(data.remainingProcessingCredits ?? null)
      setProcessingCreditLimit(data.processingCreditsLimit ?? null)
    })()
  }, [creator?.youtubeChannelId])

  useEffect(() => {
    if (scanStatus !== 'SCANNING') return
    // Stop polling after 40 attempts (~2 minutes) to avoid running forever if
    // the backend is stuck or the status endpoint is consistently failing.
    let attempts = 0
    const MAX_ATTEMPTS = 40
    const interval = setInterval(async () => {
      attempts += 1
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(interval)
        setScanStatus('FAILED')
        setError('Scan is taking too long. Please refresh the page to check status.')
        return
      }
      try {
        const res = await fetch('/api/creator/scan/status')
        if (!res.ok) return // transient error — keep polling
        const data = await res.json()
        setScanStatus(data.status)
        setVlogCount(data.vlogCount)
        setRemainingProcessingCredits(data.remainingProcessingCredits ?? null)
        setProcessingCreditLimit(data.processingCreditsLimit ?? null)
        if (data.status !== 'SCANNING') clearInterval(interval)
      } catch {
        // network error — keep polling until max attempts
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [scanStatus])

  const [profile, setProfile] = useState({ handle: creator?.handle ?? '', displayName: creator?.displayName ?? '', bio: creator?.bio ?? '', location: creator?.location ?? '', websiteUrl: creator?.websiteUrl ?? '' })
  const [storefront, setStorefront] = useState({
    storefrontTheme: creator?.storefrontTheme ?? 'CITY_EDITORIAL',
    storefrontTagline: creator?.storefrontTagline ?? '',
    storefrontIntro: creator?.storefrontIntro ?? '',
    coverImageUrl: creator?.coverImageUrl ?? '',
    storefrontMoodImageUrl: creator?.storefrontMoodImageUrl ?? '',
    storefrontGalleryImages: creator?.storefrontGalleryImages ?? [],
  })

  const setP = (key: keyof typeof profile, value: string) => setProfile((prev) => ({ ...prev, [key]: value }))
  const setStorefrontValue = (key: keyof typeof storefront, value: string) => setStorefront((prev) => ({ ...prev, [key]: value }))

  async function saveProfile() {
    setSaving(true); setError(''); setSuccess('')
    try {
      const res = await fetch('/api/creator/profile', {
        method: creator ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...profile, ...storefront, userId }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? 'Save failed')
      }
      setShowThemePicker(false)
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
    setError('')
    try {
      const res = await fetch('/api/creator/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isPublished: !creator.isPublished }) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? (creator.isPublished ? 'Could not unpublish storefront' : 'Could not publish storefront'))
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  async function connectYouTube() {
    setError('')
    try {
      const res = await fetch('/api/auth/youtube')
      if (!res.ok) throw new Error('Could not start YouTube connection')
      const data = await res.json()
      if (!data.url) throw new Error('No redirect URL returned')
      window.location.href = data.url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect YouTube right now')
    }
  }

  function connectStripe() {
    window.location.href = '/api/stripe/connect/onboard'
  }

  function openStripeDashboard() {
    window.location.href = '/api/stripe/connect/dashboard'
  }

  async function uploadImages(kind: 'cover' | 'mood' | 'gallery', files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(kind)
    setError('')
    setSuccess('')
    try {
      const formData = new FormData()
      formData.append('kind', kind)
      Array.from(files).forEach((file) => formData.append('files', file))

      const res = await fetch('/api/creator/media', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')

      const paths = Array.isArray(data.paths) ? data.paths : []
      if (kind === 'cover') {
        setStorefrontValue('coverImageUrl', paths[0] ?? '')
      } else if (kind === 'mood') {
        setStorefrontValue('storefrontMoodImageUrl', paths[0] ?? '')
      } else {
        setStorefront((prev) => ({
          ...prev,
          storefrontGalleryImages: [...prev.storefrontGalleryImages, ...paths].slice(0, 6),
        }))
      }
      setSuccess('Images uploaded')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload image')
    } finally {
      setUploading(null)
    }
  }

  function removeGalleryImage(imageUrl: string) {
    setStorefront((prev) => ({
      ...prev,
      storefrontGalleryImages: prev.storefrontGalleryImages.filter((url) => url !== imageUrl),
    }))
  }

  function openCreateTier() { setEditingTierId(null); setTierForm(emptyTierForm); setTierError(''); setShowTierForm(true) }
  function openEditTier(tier: Tier) {
    setEditingTierId(tier.id)
    setTierForm({ name: tier.name, monthlyPrice: String(tier.monthlyPrice / 100), yearlyPrice: tier.yearlyPrice ? String(tier.yearlyPrice / 100) : '', description: tier.description ?? '', perksRaw: tier.perks.join('\n'), kitAccess: tier.kitAccess })
    setTierError(''); setShowTierForm(true)
  }
  function cancelTierForm() { setShowTierForm(false); setEditingTierId(null); setTierForm(emptyTierForm); setTierError('') }

  async function saveTier() {
    setTierSaving(true); setTierError('')
    try {
      const perks = tierForm.perksRaw.split('\n').map((p) => p.trim()).filter(Boolean)
      if (editingTierId) {
        const res = await fetch(`/api/tiers/${editingTierId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: tierForm.name, description: tierForm.description || null, perks, kitAccess: tierForm.kitAccess }) })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to update tier')
      } else {
        const monthlyPriceCents = Math.round(parseFloat(tierForm.monthlyPrice) * 100)
        const yearlyPriceCents = tierForm.yearlyPrice ? Math.round(parseFloat(tierForm.yearlyPrice) * 100) : undefined
        if (!monthlyPriceCents || monthlyPriceCents < 100) throw new Error('Monthly price must be at least $1')
        const res = await fetch('/api/tiers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: tierForm.name, monthlyPrice: monthlyPriceCents, yearlyPrice: yearlyPriceCents, description: tierForm.description || null, perks, kitAccess: tierForm.kitAccess }) })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to create tier')
      }
      cancelTierForm(); router.refresh()
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
      if (!res.ok) return alert((await res.json().catch(() => ({}))).error ?? 'Failed to deactivate tier')
      router.refresh()
    } catch { alert('Something went wrong') }
  }

  const inputCls = 'dashboard-input'
  const labelCls = 'dashboard-mirror-kicker mb-1.5 block text-[11px]'
  const activeTheme = getStorefrontTheme(storefront.storefrontTheme)
  const galleryImages = storefront.storefrontGalleryImages

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex gap-1 border-b border-[rgba(23,51,45,0.12)]">
        {tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={`${tabBase} ${tab === t ? '-mb-px border-b-2 border-[#17332d] text-[#17332d]' : 'text-[rgba(23,51,45,0.5)] hover:text-[#17332d]'}`}>{t}</button>)}
      </div>

      {error ? <div className="dashboard-mirror-card mb-4 p-3 text-sm text-[#9f3a24]">{error}</div> : null}
      {success ? <div className="dashboard-mirror-card mb-4 p-3 text-sm text-[#1f6b4f]">{success}</div> : null}

      {tab === 'profile' ? <div className="space-y-5">
        <div className="dashboard-mirror-card space-y-4 p-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className={sectionTitle}>Public Profile</h2>
            {creator ? <button onClick={togglePublish} disabled={saving} className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${creator.isPublished ? 'border-[#5b9b7d]/40 bg-[#edf8f1] text-[#1f6b4f] hover:border-[#5b9b7d]/70' : 'border-[rgba(23,51,45,0.14)] bg-[rgba(255,255,255,0.68)] text-[#17332d] hover:border-[rgba(23,51,45,0.24)]'}`}>{creator.isPublished ? 'Unpublish' : 'Publish'}</button> : null}
          </div>
          <div><label className={labelCls}>Handle *</label><div className="flex items-center gap-2"><span className="text-sm text-[rgba(23,51,45,0.36)]">@</span><input className={inputCls} placeholder="yourhandle" value={profile.handle} onChange={(e) => setP('handle', e.target.value)} /></div></div>
          <div><label className={labelCls}>Display Name *</label><input className={inputCls} placeholder="Your Name" value={profile.displayName} onChange={(e) => setP('displayName', e.target.value)} /></div>
          <div><label className={labelCls}>Bio</label><textarea className={`${inputCls} resize-none`} rows={3} placeholder="Tell your audience what you're about..." value={profile.bio} onChange={(e) => setP('bio', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelCls}>Location</label><input className={inputCls} placeholder="New York, USA" value={profile.location} onChange={(e) => setP('location', e.target.value)} /></div>
            <div><label className={labelCls}>Website</label><input className={inputCls} placeholder="https://yoursite.com" value={profile.websiteUrl} onChange={(e) => setP('websiteUrl', e.target.value)} /></div>
          </div>
        </div>
        <button onClick={saveProfile} disabled={saving} className="btn-primary disabled:opacity-50">{saving ? 'Saving...' : 'Save Profile'}</button>
      </div> : null}

      {tab === 'storefront' ? <div className="space-y-5">
        <div className="dashboard-mirror-card space-y-5 p-6">
          <div><h2 className={sectionTitle}>Storefront Theme</h2><p className={sectionCopy}>Pick a travel style template, then layer in your own imagery and copy to make the storefront feel like you.</p></div>
          <div className="rounded-[1.75rem] border border-[rgba(23,51,45,0.1)] bg-[rgba(255,255,255,0.54)] p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                <div className="h-24 w-32 overflow-hidden rounded-[1.25rem] border border-[rgba(23,51,45,0.1)] bg-[rgba(255,255,255,0.46)]">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={activeTheme.previewImageUrl} alt={activeTheme.name} className="h-full w-full object-cover" /></div>
                <div><p className="font-medium text-[#17332d]">{activeTheme.name}</p><p className="mt-1 text-xs uppercase tracking-[0.22em] text-[rgba(23,51,45,0.42)]">{activeTheme.chip}</p><p className="mt-2 max-w-md text-sm leading-6 text-[rgba(23,51,45,0.66)]">{activeTheme.vibe}</p></div>
              </div>
              <button type="button" onClick={() => setShowThemePicker(true)} className="dashboard-pill-button self-start px-4 py-2 text-sm text-[#17332d] md:self-center">Choose theme</button>
            </div>
          </div>
        </div>
        {showThemePicker ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#02140f]/80 px-5 backdrop-blur-md">
          <div className="max-h-[84vh] w-full max-w-6xl overflow-hidden rounded-[2rem] border border-[rgba(23,51,45,0.12)] bg-[rgba(255,248,240,0.97)] shadow-[0_40px_160px_rgba(0,0,0,0.25)]">
            <div className="flex items-center justify-between border-b border-[rgba(23,51,45,0.1)] px-6 py-5"><div><h3 className="text-lg font-semibold text-[#17332d]">Choose a storefront mood</h3><p className="mt-1 text-sm text-[rgba(23,51,45,0.62)]">Pick the visual world your subscribers step into first.</p></div><button type="button" onClick={() => setShowThemePicker(false)} className="dashboard-pill-button px-4 py-2 text-sm text-[#17332d]">Close</button></div>
            <div className="grid max-h-[calc(84vh-88px)] gap-4 overflow-y-auto p-6 lg:grid-cols-2">
              {STOREFRONT_THEMES.map((theme) => {
                const selected = storefront.storefrontTheme === theme.id
                return <button key={theme.id} type="button" onClick={() => { setStorefrontValue('storefrontTheme', theme.id); setShowThemePicker(false) }} className={`overflow-hidden rounded-[1.75rem] border text-left transition-all ${selected ? 'border-[rgba(23,51,45,0.24)] bg-[rgba(23,51,45,0.08)] shadow-[0_0_0_1px_rgba(23,51,45,0.08)]' : 'border-[rgba(23,51,45,0.1)] bg-[rgba(255,255,255,0.62)] hover:border-[rgba(23,51,45,0.18)] hover:bg-[rgba(255,255,255,0.8)]'}`}>
                  <div className="relative h-48">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={theme.previewImageUrl} alt={theme.name} className="h-full w-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />{selected ? <span className="absolute right-4 top-4 rounded-full border border-[rgba(255,255,255,0.5)] bg-[rgba(255,247,239,0.82)] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-[#17332d]">Selected</span> : null}</div>
                  <div className="p-5"><div className="flex items-center justify-between gap-3"><p className="font-medium text-[#17332d]">{theme.name}</p><p className="text-[11px] uppercase tracking-[0.22em] text-[rgba(23,51,45,0.42)]">{theme.chip}</p></div><p className="mt-3 text-sm leading-6 text-[rgba(23,51,45,0.66)]">{theme.vibe}</p></div>
                </button>
              })}
            </div>
          </div>
        </div> : null}
        <div className={`dashboard-mirror-card space-y-5 border ${activeTheme.shellClassName} p-6`}>
          <div><h2 className={sectionTitle}>Personal Touches</h2><p className={sectionCopy}>Use your own cover art, atmosphere image, and custom words so subscribers feel like they are stepping into your travel world.</p></div>
          <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-4">
              <div><label className={labelCls}>Storefront tagline</label><input className={inputCls} placeholder={activeTheme.headline} value={storefront.storefrontTagline} onChange={(e) => setStorefrontValue('storefrontTagline', e.target.value)} /></div>
              <div><label className={labelCls}>Intro copy</label><textarea className={`${inputCls} resize-none`} rows={4} placeholder={activeTheme.subheadline} value={storefront.storefrontIntro} onChange={(e) => setStorefrontValue('storefrontIntro', e.target.value)} /></div>
              <div className="rounded-[1.4rem] border border-[rgba(23,51,45,0.1)] bg-[rgba(255,255,255,0.58)] p-4">
                <label className={labelCls}>Hero cover image</label>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <input type="file" accept="image/*" onChange={(e) => void uploadImages('cover', e.target.files)} className="text-sm text-[rgba(23,51,45,0.66)]" />
                  {storefront.coverImageUrl ? <button type="button" onClick={() => setStorefrontValue('coverImageUrl', '')} className="dashboard-pill-button px-3 py-1.5 text-xs">Remove</button> : null}
                </div>
                {uploading === 'cover' ? <p className="mt-2 text-xs text-[rgba(23,51,45,0.52)]">Uploading cover image...</p> : null}
              </div>
              <div className="rounded-[1.4rem] border border-[rgba(23,51,45,0.1)] bg-[rgba(255,255,255,0.58)] p-4">
                <label className={labelCls}>Mood image</label>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <input type="file" accept="image/*" onChange={(e) => void uploadImages('mood', e.target.files)} className="text-sm text-[rgba(23,51,45,0.66)]" />
                  {storefront.storefrontMoodImageUrl ? <button type="button" onClick={() => setStorefrontValue('storefrontMoodImageUrl', '')} className="dashboard-pill-button px-3 py-1.5 text-xs">Remove</button> : null}
                </div>
                {uploading === 'mood' ? <p className="mt-2 text-xs text-[rgba(23,51,45,0.52)]">Uploading mood image...</p> : null}
              </div>
              <div className="rounded-[1.4rem] border border-[rgba(23,51,45,0.1)] bg-[rgba(255,255,255,0.58)] p-4">
                <label className={labelCls}>Gallery images</label>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <input type="file" accept="image/*" multiple onChange={(e) => void uploadImages('gallery', e.target.files)} className="text-sm text-[rgba(23,51,45,0.66)]" />
                  <span className="text-xs text-[rgba(23,51,45,0.42)]">{galleryImages.length}/6 uploaded</span>
                </div>
                {uploading === 'gallery' ? <p className="mt-2 text-xs text-[rgba(23,51,45,0.52)]">Uploading gallery images...</p> : null}
                {galleryImages.length > 0 ? (
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {galleryImages.map((imageUrl) => (
                      <div key={imageUrl} className="overflow-hidden rounded-2xl border border-[rgba(23,51,45,0.1)] bg-[rgba(255,255,255,0.46)]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={resolveStorageAssetUrl(imageUrl) ?? ''} alt="" className="h-24 w-full object-cover" />
                        <div className="p-2">
                          <button type="button" onClick={() => removeGalleryImage(imageUrl)} className="dashboard-pill-button w-full justify-center px-3 py-1.5 text-xs">Remove</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className={`rounded-[2rem] border ${activeTheme.cardClassName} p-5`}>
              <div className={`rounded-[1.75rem] border ${activeTheme.heroClassName} p-5`}>
                <div className="flex items-center justify-between"><span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em] ${activeTheme.pillClassName}`}>{activeTheme.chip}</span><span className="text-[11px] uppercase tracking-[0.22em] text-[rgba(23,51,45,0.42)]">Preview</span></div>
                <h3 className="mt-5 text-2xl font-semibold text-[#17332d]">{storefront.storefrontTagline || activeTheme.headline}</h3>
                <p className="mt-3 text-sm leading-7 text-[rgba(23,51,45,0.7)]">{storefront.storefrontIntro || activeTheme.subheadline}</p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="col-span-2 overflow-hidden rounded-[1.4rem] border border-[rgba(23,51,45,0.1)] bg-[rgba(255,255,255,0.46)]">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={activeTheme.previewImageUrl} alt="" className="h-32 w-full object-cover" /></div>
                {[storefront.coverImageUrl, storefront.storefrontMoodImageUrl, ...galleryImages].slice(0, 4).map((imageUrl, index) => <div key={`${imageUrl}-${index}`} className="overflow-hidden rounded-2xl border border-[rgba(23,51,45,0.1)] bg-[rgba(255,255,255,0.46)]">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={resolveStorageAssetUrl(imageUrl) ?? ''} alt="" className="h-24 w-full object-cover" /></div>)}
                {galleryImages.length === 0 && !storefront.coverImageUrl && !storefront.storefrontMoodImageUrl ? <div className="col-span-2 rounded-2xl border border-dashed border-[rgba(23,51,45,0.15)] bg-[rgba(255,255,255,0.46)] px-4 py-8 text-center text-sm text-[rgba(23,51,45,0.46)]">Add your own imagery to make this storefront feel personal.</div> : null}
              </div>
            </div>
          </div>
        </div>
        <button onClick={saveProfile} disabled={saving} className="btn-primary disabled:opacity-50">{saving ? 'Saving...' : 'Save Storefront'}</button>
      </div> : null}

      {tab === 'channels' ? <div className="space-y-4">
        <div className="dashboard-mirror-card p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/20"><span className="text-lg">▶</span></div>
              <div><p className="font-medium text-[#17332d]">YouTube</p>{creator?.youtubeHandle ? <p className={metaText}>Connected as @{creator.youtubeHandle}</p> : <p className={metaText}>Not connected</p>}</div>
            </div>
            {creator?.youtubeChannelId ? <span className="rounded-full bg-green-500/20 px-2 py-1 text-xs text-green-400">Connected</span> : <button onClick={connectYouTube} className="btn-primary text-sm">Connect</button>}
          </div>
          {creator?.youtubeChannelId ? <div className="mt-4 space-y-3 border-t border-[rgba(23,51,45,0.1)] pt-4">
            <div className="flex items-center gap-2">
              <p className={metaText}>Catalog scan:</p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${scanStatus === 'COMPLETE' ? 'bg-green-500/20 text-green-400' : scanStatus === 'SCANNING' ? 'animate-pulse bg-yellow-500/20 text-yellow-400' : scanStatus === 'FAILED' ? 'bg-red-500/20 text-red-400' : 'bg-[rgba(23,51,45,0.08)] text-[rgba(23,51,45,0.52)]'}`}>{scanStatus === 'SCANNING' ? 'Scanning...' : scanStatus}</span>
              {scanStatus === 'COMPLETE' && vlogCount > 0 ? <span className="text-xs text-[rgba(23,51,45,0.42)]">{vlogCount}/{planConfig.maxImportedVlogs} videos imported</span> : null}
            </div>
            <p className="text-xs text-[rgba(23,51,45,0.42)]">
              Your {planConfig.label} plan includes up to {planConfig.maxImportedVlogs} imported videos and {processingCreditLimit ?? planConfig.monthlyProcessingCredits} processing credits each month.
              {remainingProcessingCredits !== null ? ` ${remainingProcessingCredits} credit${remainingProcessingCredits === 1 ? '' : 's'} remaining.` : ''}
            </p>
            <div className="flex flex-wrap gap-3">
              {scanStatus === 'PENDING' || scanStatus === 'COMPLETE' || scanStatus === 'FAILED' ? (
                <button
                  onClick={async () => {
                    setError('')
                    const res = await fetch('/api/creator/scan', { method: 'POST' })
                    const data = await res.json().catch(() => ({}))
                    if (res.ok) {
                      setScanStatus('SCANNING')
                      return
                    }
                    setError(data.error ?? 'Could not start a YouTube scan right now.')
                  }}
                  className="btn-ghost text-sm"
                >
                  {scanStatus === 'COMPLETE' ? 'Re-scan' : 'Start scan'}
                </button>
              ) : null}
              <button onClick={connectYouTube} className="dashboard-pill-button px-4 py-2 text-sm text-[#17332d]">
                Reconnect YouTube
              </button>
            </div>
          </div> : null}
        </div>
        <div className="dashboard-mirror-card p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(23,51,45,0.08)]"><span className="text-lg">♪</span></div>
              <div><p className="font-medium text-[#17332d]">TikTok</p>{creator?.tiktokHandle ? <p className={metaText}>Connected as @{creator.tiktokHandle}</p> : <p className={metaText}>Not connected - metadata only</p>}</div>
            </div>
            {creator?.tiktokUserId ? <span className="rounded-full bg-green-500/20 px-2 py-1 text-xs text-green-400">Connected</span> : <button className="btn-primary text-sm" onClick={() => { window.location.href = '/api/auth/tiktok' }}>Connect</button>}
          </div>
        </div>
      </div> : null}

      {tab === 'tiers' ? <div className="space-y-4">
        <div className="flex items-center justify-between"><p className="text-sm text-[rgba(23,51,45,0.52)]">Paid tiers unlock gated Trip Kits. Free followers don&apos;t need one.</p>{!showTierForm ? <button onClick={openCreateTier} className="btn-primary text-sm">+ New tier</button> : null}</div>
        {showTierForm ? <div className="dashboard-mirror-card space-y-4 border border-[rgba(23,51,45,0.14)] p-6">
          <h3 className="font-semibold text-[#17332d]">{editingTierId ? 'Edit tier' : 'Create new tier'}</h3>
          {tierError ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{tierError}</div> : null}
          <div><label className={labelCls}>Tier name *</label><input className={inputCls} placeholder="e.g. Explorer, Premium, All Access" value={tierForm.name} onChange={(e) => setTierForm((f) => ({ ...f, name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelCls}>Monthly price (USD) *</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[rgba(23,51,45,0.36)]">$</span><input className={`${inputCls} pl-7`} placeholder="9" type="number" min="1" step="1" value={tierForm.monthlyPrice} onChange={(e) => setTierForm((f) => ({ ...f, monthlyPrice: e.target.value }))} disabled={!!editingTierId} /></div>{editingTierId ? <p className="mt-1 text-xs text-[rgba(23,51,45,0.36)]">Price is locked - create a new tier to change it.</p> : null}</div>
            <div><label className={labelCls}>Yearly price (USD, optional)</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[rgba(23,51,45,0.36)]">$</span><input className={`${inputCls} pl-7`} placeholder="90" type="number" min="1" step="1" value={tierForm.yearlyPrice} onChange={(e) => setTierForm((f) => ({ ...f, yearlyPrice: e.target.value }))} disabled={!!editingTierId} /></div></div>
          </div>
          <div><label className={labelCls}>Description</label><textarea className={`${inputCls} resize-none`} rows={2} placeholder="What do subscribers get at a glance?" value={tierForm.description} onChange={(e) => setTierForm((f) => ({ ...f, description: e.target.value }))} /></div>
          <div><label className={labelCls}>Perks (one per line)</label><textarea className={`${inputCls} resize-none font-mono text-xs`} rows={4} placeholder={'All premium Trip Kits\nEarly access to new drops\nExclusive gear guides'} value={tierForm.perksRaw} onChange={(e) => setTierForm((f) => ({ ...f, perksRaw: e.target.value }))} /></div>
          <div><label className={labelCls}>Kit access level</label><select className={inputCls} value={tierForm.kitAccess} onChange={(e) => setTierForm((f) => ({ ...f, kitAccess: e.target.value as 'FREE' | 'FOLLOWER' | 'PREMIUM' }))}><option value="FREE">Free - no extra kit access beyond free kits</option><option value="FOLLOWER">Follower - unlocks follower-gated kits</option><option value="PREMIUM">Premium - unlocks all kits including premium</option></select></div>
          <div className="flex gap-3 pt-2"><button onClick={saveTier} disabled={tierSaving || !tierForm.name.trim() || (!editingTierId && !tierForm.monthlyPrice)} className="btn-primary disabled:opacity-50">{tierSaving ? 'Saving...' : editingTierId ? 'Save changes' : 'Create tier'}</button><button onClick={cancelTierForm} disabled={tierSaving} className="btn-ghost">Cancel</button></div>
        </div> : null}
        {creator?.tiers.length === 0 && !showTierForm ? <div className="dashboard-mirror-card p-8 text-center"><p className="mb-4 text-sm text-[rgba(23,51,45,0.52)]">No tiers yet. Create your first paid subscription tier.</p><button className="btn-primary text-sm" onClick={openCreateTier}>Create first tier</button></div> : null}
        {creator?.tiers.map((tier) => <div key={tier.id} className="dashboard-mirror-card p-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0 flex-1"><div className="mb-1 flex flex-wrap items-center gap-2"><p className="font-semibold text-[#17332d]">{tier.name}</p><span className={`rounded-full px-2 py-0.5 text-xs ${tier.isActive ? 'bg-green-500/20 text-green-400' : 'bg-[rgba(23,51,45,0.08)] text-[rgba(23,51,45,0.52)]'}`}>{tier.isActive ? 'Active' : 'Inactive'}</span><span className="rounded-full bg-[rgba(23,51,45,0.08)] px-2 py-0.5 text-xs uppercase text-[rgba(23,51,45,0.46)]">{tier.kitAccess} access</span></div><p className="text-sm text-[rgba(23,51,45,0.56)]">${(tier.monthlyPrice / 100).toFixed(0)}/mo{tier.yearlyPrice ? ` · $${(tier.yearlyPrice / 100).toFixed(0)}/yr` : ''}</p>{tier.description ? <p className="mt-2 text-xs text-[rgba(23,51,45,0.46)]">{tier.description}</p> : null}{tier.perks.length > 0 ? <ul className="mt-3 space-y-1">{tier.perks.map((perk, i) => <li key={i} className="text-xs text-[rgba(23,51,45,0.62)]">✓ {perk}</li>)}</ul> : null}</div>{tier.isActive && !showTierForm ? <div className="flex shrink-0 gap-2"><button onClick={() => openEditTier(tier)} className="btn-ghost px-3 py-1 text-xs">Edit</button><button onClick={() => deactivateTier(tier.id)} className="rounded-lg border border-red-500/20 px-3 py-1 text-xs text-red-400 transition-colors hover:border-red-500/40">Deactivate</button></div> : null}</div></div>)}
      </div> : null}

      {tab === 'billing' ? <div className="space-y-4">
        <div className="dashboard-mirror-card p-6"><h2 className="mb-4 font-semibold text-[#17332d]">TripKits Plan</h2><div className="space-y-3">{(Object.entries(billingPlans) as [keyof typeof billingPlans, typeof billingPlans.FREE][]).map(([key, p]) => <div key={key} className={`flex items-center justify-between rounded-xl border p-4 ${creator?.plan === key ? 'border-[rgba(23,51,45,0.22)] bg-[rgba(255,255,255,0.5)]' : 'border-[rgba(23,51,45,0.1)]'}`}><div><p className="font-medium text-[#17332d]">{p.label}</p><p className={metaText}>{p.description}</p></div><div className="text-right"><p className="text-sm font-semibold text-[#17332d]">{p.price}</p>{creator?.plan === key ? <p className="text-xs text-green-400">Current plan</p> : null}</div></div>)}</div></div>
        <div className="dashboard-mirror-card p-6">
          <h2 className="mb-2 font-semibold text-[#17332d]">Creator payouts</h2>
          <p className={sectionCopy}>
            Connect Stripe Express so affiliate commissions and future subscriber payouts have somewhere to land.
          </p>
          <div className="mt-4 rounded-xl border border-[rgba(23,51,45,0.1)] bg-[rgba(255,255,255,0.58)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-medium text-[#17332d]">
                  {!creator?.stripeAccountId
                    ? 'Stripe not connected'
                    : creator.payoutsEnabled
                      ? 'Stripe payouts enabled'
                      : 'Stripe connected - onboarding incomplete'}
                </p>
                <p className="mt-1 text-xs text-[rgba(23,51,45,0.52)]">
                  {!creator?.stripeAccountId
                    ? 'Connect once to receive creator payouts and manage tax + banking details.'
                    : creator.payoutsEnabled
                      ? 'Open Stripe Express any time to review transfers and update payout details.'
                      : 'Resume onboarding to finish account details and enable payouts.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button onClick={connectStripe} className="btn-primary text-sm">
                  {!creator?.stripeAccountId ? 'Connect Stripe' : creator.payoutsEnabled ? 'Refresh Stripe setup' : 'Resume onboarding'}
                </button>
                {creator?.stripeAccountId ? (
                  <button onClick={openStripeDashboard} className="btn-ghost text-sm">
                    Open Stripe Dashboard
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <p className="text-xs text-[rgba(23,51,45,0.42)]">To upgrade your plan, contact us or use the in-app upgrade flow (coming soon).</p>
      </div> : null}
    </div>
  )
}
