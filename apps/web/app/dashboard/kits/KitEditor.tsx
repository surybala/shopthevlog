'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ItineraryEditor from './ItineraryEditor'

type LinkRef = {
  id: string
  targetName: string
  shortCode: string
  provider: string
  affiliateUrl: string
}

type Activity = {
  id: string
  sortOrder: number
  time: string | null
  title: string
  description: string | null
  type: string
  affiliateLink: LinkRef | null
}

type Day = {
  id: string
  dayNumber: number
  title: string
  summary: string | null
  city: string | null
  country: string | null
  activities: Activity[]
}

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
  days: Day[]
}

interface Props {
  creatorId: string
  creatorHandle: string
  kit: Kit | null
}

export default function KitEditor({ creatorId, creatorHandle, kit }: Props) {
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
    accessTier: (kit?.accessTier ?? 'FREE') as 'FREE' | 'FOLLOWER' | 'PREMIUM',
    isPublished: kit?.isPublished ?? false,
    isFeatured: kit?.isFeatured ?? false,
  })

  function set(key: keyof typeof form, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

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
        countries: form.countries.split(',').map((s) => s.trim()).filter(Boolean),
        cities: form.cities.split(',').map((s) => s.trim()).filter(Boolean),
        durationDays: form.durationDays ? parseInt(form.durationDays, 10) : null,
        estimatedBudgetLow: form.estimatedBudgetLow ? parseInt(form.estimatedBudgetLow, 10) : null,
        estimatedBudgetHigh: form.estimatedBudgetHigh ? parseInt(form.estimatedBudgetHigh, 10) : null,
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
      if (!kit) {
        router.push(`/dashboard/kits/${saved.id}`)
      }
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? (kit.isPublished ? 'Could not unpublish kit' : 'Could not publish kit'))
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const labelCls = 'dashboard-mirror-kicker mb-2 block text-[11px]'

  return (
    <div className="max-w-4xl space-y-6 pb-12">
      {error ? (
        <div className="dashboard-mirror-card border border-red-400/25 p-4 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <section className="dashboard-mirror-card space-y-6 p-6 md:p-7">
        <div>
          <p className="dashboard-mirror-kicker text-xs">Core Story</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#17332d]">Shape the Trip Kit before it goes live.</h2>
          <p className="dashboard-mirror-subtle mt-2 max-w-2xl text-sm">
            Dial in the title, route, budget, and unlock level so subscribers feel like they are stepping into a polished travel editorial.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={labelCls}>Title</label>
            <input
              className="dashboard-input"
              placeholder="10 Days in Japan: Tokyo to Kyoto"
              value={form.title}
              onChange={(e) => handleTitleChange(e.target.value)}
            />
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>Storefront Slug</label>
            <div className="flex items-center gap-3 rounded-[1.35rem] bg-white/[0.05] px-4 py-3 ring-1 ring-white/10">
              <span className="shrink-0 text-sm text-[rgba(23,51,45,0.52)]">/@{creatorHandle}/kits/</span>
              <input
                className="min-w-0 flex-1 bg-transparent text-sm text-[#17332d] outline-none placeholder:text-[rgba(23,51,45,0.36)]"
                placeholder="10-days-in-japan"
                value={form.slug}
                onChange={(e) => set('slug', e.target.value)}
              />
            </div>
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>Description</label>
            <textarea
              className="dashboard-input min-h-28 resize-none"
              rows={4}
              placeholder="Give subscribers a quick editorial feel for the route, highlights, and who this trip is best for."
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>

          <div>
            <label className={labelCls}>Primary City</label>
            <input className="dashboard-input" placeholder="Tokyo" value={form.primaryCity} onChange={(e) => set('primaryCity', e.target.value)} />
          </div>

          <div>
            <label className={labelCls}>Duration</label>
            <input className="dashboard-input" type="number" placeholder="10" value={form.durationDays} onChange={(e) => set('durationDays', e.target.value)} />
          </div>

          <div>
            <label className={labelCls}>Countries</label>
            <input className="dashboard-input" placeholder="Japan" value={form.countries} onChange={(e) => set('countries', e.target.value)} />
          </div>

          <div>
            <label className={labelCls}>Cities</label>
            <input className="dashboard-input" placeholder="Tokyo, Kyoto, Osaka" value={form.cities} onChange={(e) => set('cities', e.target.value)} />
          </div>

          <div>
            <label className={labelCls}>Budget Low (USD)</label>
            <input className="dashboard-input" type="number" placeholder="1500" value={form.estimatedBudgetLow} onChange={(e) => set('estimatedBudgetLow', e.target.value)} />
          </div>

          <div>
            <label className={labelCls}>Budget High (USD)</label>
            <input className="dashboard-input" type="number" placeholder="3000" value={form.estimatedBudgetHigh} onChange={(e) => set('estimatedBudgetHigh', e.target.value)} />
          </div>
        </div>
      </section>

      <section className="dashboard-mirror-card space-y-5 p-6 md:p-7">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="dashboard-mirror-kicker text-xs">Access</p>
            <h2 className="mt-2 text-xl font-semibold text-[#17332d]">Choose how this guide unlocks.</h2>
          </div>
          <div className="rounded-full bg-white/[0.06] px-4 py-2 text-xs text-[rgba(23,51,45,0.58)] ring-1 ring-white/10">
            {kit ? (kit.isPublished ? 'Published now' : 'Draft mode') : 'Create first draft'}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {([
            { value: 'FREE', label: 'Free', description: 'Anyone can browse it without following.' },
            { value: 'FOLLOWER', label: 'Follower', description: 'Unlocked once someone follows or subscribes.' },
            { value: 'PREMIUM', label: 'Premium', description: 'Reserved for your paid supporters.' },
          ] as const).map((tier) => {
            const selected = form.accessTier === tier.value
            return (
              <button
                key={tier.value}
                type="button"
                onClick={() => set('accessTier', tier.value)}
                className={`rounded-[1.5rem] p-4 text-left transition-all ${
                  selected
                    ? 'bg-[linear-gradient(135deg,rgba(240,152,74,0.32),rgba(232,118,34,0.2))] ring-1 ring-[#f0b16b]/40'
                    : 'bg-white/[0.04] ring-1 ring-white/10 hover:bg-white/[0.07] hover:ring-white/20'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-[#17332d]">{tier.label}</span>
                  <span className={`h-2.5 w-2.5 rounded-full ${selected ? 'bg-[#f0b16b]' : 'bg-white/25'}`} />
                </div>
                <p className="mt-2 text-sm leading-6 text-[rgba(23,51,45,0.68)]">{tier.description}</p>
              </button>
            )
          })}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <button
            type="button"
            onClick={() => set('isFeatured', !form.isFeatured)}
            className="rounded-[1.5rem] bg-white/[0.04] p-4 text-left ring-1 ring-white/10 transition hover:bg-white/[0.07]"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#17332d]">Featured placement</p>
                <p className="mt-1 text-sm text-[rgba(23,51,45,0.72)]">Lift this kit toward the top of your storefront collection.</p>
              </div>
              <div className={`h-6 w-11 rounded-full transition ${form.isFeatured ? 'bg-[#f0b16b]' : 'bg-white/12'}`}>
                <div className={`mt-0.5 h-5 w-5 rounded-full bg-[#163328] transition-transform ${form.isFeatured ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
            </div>
          </button>

          <div className="rounded-[1.5rem] bg-white/[0.04] p-4 ring-1 ring-white/10">
            <p className="text-sm font-semibold text-[#17332d]">Storefront visibility</p>
            <p className="mt-1 text-sm text-[rgba(23,51,45,0.72)]">
              {kit?.isPublished
                ? 'This Trip Kit is live on your storefront right now.'
                : 'Save your edits first. You can publish once the kit is ready for subscribers.'}
            </p>
          </div>
        </div>
      </section>

      <section className="dashboard-mirror-card space-y-5 p-6 md:p-7">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="dashboard-mirror-kicker text-xs">Itinerary</p>
            <h2 className="mt-2 text-xl font-semibold text-[#17332d]">Build the experience day by day.</h2>
          </div>
          <div className="rounded-full bg-white/[0.06] px-4 py-2 text-xs text-[rgba(23,51,45,0.58)] ring-1 ring-white/10">
            {kit ? `${kit.days.length} day${kit.days.length === 1 ? '' : 's'}` : 'Save to unlock'}
          </div>
        </div>

        {kit ? (
          <ItineraryEditor kitId={kit.id} initialDays={kit.days} />
        ) : (
          <div className="rounded-[1.75rem] border border-dashed border-white/12 bg-white/[0.03] px-6 py-12 text-center">
            <p className="text-sm font-medium text-[#17332d]">Save the Trip Kit first.</p>
            <p className="mt-2 text-sm text-[rgba(23,51,45,0.64)]">
              Once the kit exists, you can add days, activities, and affiliate links in the same editor.
            </p>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={handleSave} disabled={saving || !form.title || !form.slug} className="btn-primary disabled:opacity-50">
          {saving ? 'Saving...' : kit ? 'Save changes' : 'Create Trip Kit'}
        </button>

        {kit ? (
          <button
            onClick={handlePublishToggle}
            disabled={saving}
            className={
              kit.isPublished
                ? 'btn-ghost border border-red-400/25 text-[#b84c38] hover:bg-red-400/10 disabled:opacity-50'
                : 'btn-ghost disabled:opacity-50'
            }
          >
            {kit.isPublished ? 'Unpublish' : 'Publish'}
          </button>
        ) : null}

        {kit?.isPublished ? (
          <a
            href={`/@${creatorHandle}/kits/${kit.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-sm text-[rgba(23,51,45,0.62)] transition hover:text-[#17332d]"
          >
            View on storefront
          </a>
        ) : null}
      </div>
    </div>
  )
}
