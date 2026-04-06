'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Kit {
  id: string
  title: string
  description: string | null
  slug: string
  primaryCity: string | null
  countries: string[]
  cities: string[]
  durationDays: number | null
  estimatedBudgetLow: number | null
  estimatedBudgetHigh: number | null
  accessTier: 'FREE' | 'FOLLOWER' | 'PREMIUM'
  isPublished: boolean
  isFeatured: boolean
  coverImageUrl: string | null
}

interface Props {
  creatorId: string
  kit: Kit | null
}

export default function KitEditor({ creatorId, kit }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    title: kit?.title ?? '',
    description: kit?.description ?? '',
    slug: kit?.slug ?? '',
    primaryCity: kit?.primaryCity ?? '',
    countries: kit?.countries.join(', ') ?? '',
    cities: kit?.cities.join(', ') ?? '',
    durationDays: kit?.durationDays?.toString() ?? '',
    estimatedBudgetLow: kit?.estimatedBudgetLow?.toString() ?? '',
    estimatedBudgetHigh: kit?.estimatedBudgetHigh?.toString() ?? '',
    accessTier: kit?.accessTier ?? 'FREE',
    isPublished: kit?.isPublished ?? false,
    isFeatured: kit?.isFeatured ?? false,
  })

  function set(key: keyof typeof form, value: string | boolean) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  // Auto-generate slug from title
  function handleTitleChange(title: string) {
    set('title', title)
    if (!kit) {
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      set('slug', slug)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const body = {
        creatorId,
        title: form.title,
        description: form.description || null,
        slug: form.slug,
        primaryCity: form.primaryCity || null,
        countries: form.countries.split(',').map(s => s.trim()).filter(Boolean),
        cities: form.cities.split(',').map(s => s.trim()).filter(Boolean),
        durationDays: form.durationDays ? parseInt(form.durationDays) : null,
        estimatedBudgetLow: form.estimatedBudgetLow ? parseInt(form.estimatedBudgetLow) : null,
        estimatedBudgetHigh: form.estimatedBudgetHigh ? parseInt(form.estimatedBudgetHigh) : null,
        accessTier: form.accessTier,
        isPublished: form.isPublished,
        isFeatured: form.isFeatured,
      }
      const res = await fetch(kit ? `/api/kits/${kit.id}` : '/api/kits', {
        method: kit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Save failed')
      }
      const saved = await res.json()
      router.push(`/dashboard/kits/${saved.id}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  async function handlePublishToggle() {
    if (!kit) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/kits/${kit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublished: !kit.isPublished }),
      })
      if (!res.ok) throw new Error('Failed to update')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30'
  const labelCls = 'block text-xs font-medium text-white/50 uppercase tracking-wider mb-1.5'

  return (
    <div className="max-w-3xl space-y-6">
      {error && (
        <div className="glass-card p-4 border-red-500/30 text-red-400 text-sm">{error}</div>
      )}

      {/* Basic info */}
      <div className="glass-card p-6 space-y-4">
        <h2 className="font-semibold text-white mb-4">Basic Info</h2>

        <div>
          <label className={labelCls}>Title *</label>
          <input
            className={inputCls}
            placeholder="10 Days in Japan: Tokyo to Kyoto"
            value={form.title}
            onChange={e => handleTitleChange(e.target.value)}
          />
        </div>

        <div>
          <label className={labelCls}>URL Slug *</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/30">/@handle/kits/</span>
            <input
              className={inputCls}
              placeholder="10-days-in-japan"
              value={form.slug}
              onChange={e => set('slug', e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Description</label>
          <textarea
            className={`${inputCls} resize-none`}
            rows={3}
            placeholder="A 2-3 sentence hook for your kit…"
            value={form.description}
            onChange={e => set('description', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Primary City</label>
            <input
              className={inputCls}
              placeholder="Tokyo"
              value={form.primaryCity}
              onChange={e => set('primaryCity', e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Duration (days)</label>
            <input
              className={inputCls}
              type="number"
              placeholder="10"
              value={form.durationDays}
              onChange={e => set('durationDays', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Countries (comma-separated)</label>
            <input
              className={inputCls}
              placeholder="Japan"
              value={form.countries}
              onChange={e => set('countries', e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Cities (comma-separated)</label>
            <input
              className={inputCls}
              placeholder="Tokyo, Kyoto, Osaka"
              value={form.cities}
              onChange={e => set('cities', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Budget Low (USD/person)</label>
            <input
              className={inputCls}
              type="number"
              placeholder="1500"
              value={form.estimatedBudgetLow}
              onChange={e => set('estimatedBudgetLow', e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Budget High (USD/person)</label>
            <input
              className={inputCls}
              type="number"
              placeholder="3000"
              value={form.estimatedBudgetHigh}
              onChange={e => set('estimatedBudgetHigh', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Access & publishing */}
      <div className="glass-card p-6">
        <h2 className="font-semibold text-white mb-4">Access & Publishing</h2>
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Access Tier</label>
            <div className="flex gap-3">
              {(['FREE', 'FOLLOWER', 'PREMIUM'] as const).map(tier => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => set('accessTier', tier)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors border ${
                    form.accessTier === tier
                      ? 'bg-white text-black border-white'
                      : 'bg-white/5 text-white/50 border-white/10 hover:border-white/30'
                  }`}
                >
                  {tier}
                </button>
              ))}
            </div>
            <p className="text-xs text-white/30 mt-2">
              {form.accessTier === 'FREE' && 'Anyone can view — no sign-in required'}
              {form.accessTier === 'FOLLOWER' && 'Requires free follow or any paid subscription'}
              {form.accessTier === 'PREMIUM' && 'Requires a paid subscription tier'}
            </p>
          </div>

          <div className="flex items-center justify-between py-2 border-t border-white/10">
            <div>
              <p className="text-sm font-medium text-white">Featured Kit</p>
              <p className="text-xs text-white/40">Pin to top of your storefront (max 3)</p>
            </div>
            <button
              type="button"
              onClick={() => set('isFeatured', !form.isFeatured)}
              className={`relative w-11 h-6 rounded-full transition-colors ${form.isFeatured ? 'bg-white' : 'bg-white/10'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-black transition-transform ${form.isFeatured ? 'translate-x-5' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pb-8">
        <button
          onClick={handleSave}
          disabled={saving || !form.title || !form.slug}
          className="btn-primary disabled:opacity-50"
        >
          {saving ? 'Saving…' : kit ? 'Save changes' : 'Create Kit'}
        </button>

        {kit && (
          <button
            onClick={handlePublishToggle}
            disabled={saving}
            className={`btn-ghost disabled:opacity-50 ${kit.isPublished ? 'border-red-500/30 text-red-400 hover:border-red-500/60' : ''}`}
          >
            {kit.isPublished ? 'Unpublish' : 'Publish'}
          </button>
        )}
      </div>
    </div>
  )
}
