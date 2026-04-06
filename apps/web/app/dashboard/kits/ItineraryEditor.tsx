'use client'

import { useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface Props {
  kitId: string
  initialDays: Day[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTIVITY_TYPES = [
  { value: 'ACCOMMODATION', label: 'Stay',       emoji: '🏨' },
  { value: 'FOOD',          label: 'Food',       emoji: '🍜' },
  { value: 'ATTRACTION',    label: 'Attraction', emoji: '🏛️' },
  { value: 'TOUR',          label: 'Tour',       emoji: '🗺️' },
  { value: 'ADVENTURE',     label: 'Adventure',  emoji: '🧗' },
  { value: 'CULTURAL',      label: 'Cultural',   emoji: '🎭' },
  { value: 'TRANSPORT',     label: 'Transport',  emoji: '🚆' },
  { value: 'WELLNESS',      label: 'Wellness',   emoji: '🧘' },
  { value: 'NIGHTLIFE',     label: 'Nightlife',  emoji: '🌙' },
  { value: 'OTHER',         label: 'Other',      emoji: '⭐' },
]

const PROVIDER_LABELS: Record<string, string> = {
  BOOKING_COM:  'Booking.com',
  GETYOURGUIDE: 'GetYourGuide',
  VIATOR:       'Viator',
  AMAZON:       'Amazon',
  SKYSCANNER:   'Skyscanner',
  KLOOK:        'Klook',
  AIRBNB:       'Airbnb',
  EXPEDIA:      'Expedia',
  STAY22:       'Stay22',
  GOOGLE_FLIGHTS:'Google Flights',
  CUSTOM:       'Custom',
}

function typeEmoji(type: string) {
  return ACTIVITY_TYPES.find(t => t.value === type)?.emoji ?? '⭐'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ActivityRow({
  activity,
  dayId,
  kitId,
  activityType: _actType,
  onUpdate,
  onDelete,
}: {
  activity: Activity
  dayId: string
  kitId: string
  activityType?: string
  onUpdate: (updated: Activity) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    time: activity.time ?? '',
    title: activity.title,
    description: activity.description ?? '',
    type: activity.type,
  })
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkName, setLinkName] = useState('')
  const [linkSaving, setLinkSaving] = useState(false)
  const [linkError, setLinkError] = useState('')

  const inputCls = 'bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 w-full'

  async function saveActivity() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(
        `/api/kits/${kitId}/days/${dayId}/activities/${activity.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            time: form.time || null,
            title: form.title,
            description: form.description || null,
            type: form.type,
          }),
        }
      )
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      const updated = await res.json()
      onUpdate(updated)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function deleteActivity() {
    if (!confirm('Delete this activity?')) return
    setSaving(true)
    try {
      await fetch(`/api/kits/${kitId}/days/${dayId}/activities/${activity.id}`, { method: 'DELETE' })
      onDelete()
    } finally {
      setSaving(false)
    }
  }

  async function attachLink() {
    if (!linkUrl || !linkName) { setLinkError('URL and name are required'); return }
    try { new URL(linkUrl) } catch { setLinkError('Invalid URL'); return }
    setLinkSaving(true)
    setLinkError('')
    try {
      // 1. Create the affiliate link
      const linkRes = await fetch('/api/affiliate-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetName: linkName, targetUrl: linkUrl, activityType: activity.type }),
      })
      if (!linkRes.ok) throw new Error((await linkRes.json()).error ?? 'Failed to create link')
      const newLink = await linkRes.json()

      // 2. Attach to activity
      const actRes = await fetch(
        `/api/kits/${kitId}/days/${dayId}/activities/${activity.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ affiliateLinkId: newLink.id }),
        }
      )
      if (!actRes.ok) throw new Error('Failed to attach link')
      const updated = await actRes.json()
      onUpdate(updated)
      setLinkOpen(false)
      setLinkUrl('')
      setLinkName('')
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLinkSaving(false)
    }
  }

  async function detachLink() {
    setSaving(true)
    try {
      const res = await fetch(
        `/api/kits/${kitId}/days/${dayId}/activities/${activity.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ affiliateLinkId: null }),
        }
      )
      if (!res.ok) throw new Error('Failed')
      const updated = await res.json()
      onUpdate(updated)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-white/5 group">
        <span className="text-base mt-0.5 shrink-0">{typeEmoji(activity.type)}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {activity.time && (
              <span className="text-xs text-white/30 font-mono">{activity.time}</span>
            )}
            <span className="text-sm text-white font-medium">{activity.title}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-white/40">
              {ACTIVITY_TYPES.find(t => t.value === activity.type)?.label ?? activity.type}
            </span>
          </div>
          {activity.description && (
            <p className="text-xs text-white/40 mt-0.5 line-clamp-1">{activity.description}</p>
          )}
          {activity.affiliateLink && (
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/20">
                🔗 {PROVIDER_LABELS[activity.affiliateLink.provider] ?? activity.affiliateLink.provider}
                {' — '}{activity.affiliateLink.targetName}
              </span>
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setEditing(true)}
            className="text-xs px-2 py-1 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={deleteActivity}
            disabled={saving}
            className="text-xs px-2 py-1 rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>
    )
  }

  // Edit mode
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="grid grid-cols-[120px_1fr] gap-3">
        <div>
          <label className="block text-xs text-white/40 mb-1">Time</label>
          <input
            className={inputCls}
            placeholder="09:00"
            value={form.time}
            onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs text-white/40 mb-1">Title *</label>
          <input
            className={inputCls}
            placeholder="Ramen at Fuunji"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-white/40 mb-1">Description</label>
        <input
          className={inputCls}
          placeholder="Brief description (optional)"
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        />
      </div>

      <div>
        <label className="block text-xs text-white/40 mb-1.5">Type</label>
        <div className="flex flex-wrap gap-1.5">
          {ACTIVITY_TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => setForm(f => ({ ...f, type: t.value }))}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                form.type === t.value
                  ? 'bg-white text-black border-white'
                  : 'border-white/10 text-white/50 hover:border-white/30'
              }`}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Affiliate link section */}
      <div className="pt-2 border-t border-white/10">
        <p className="text-xs text-white/40 mb-2">Affiliate link</p>
        {activity.affiliateLink ? (
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-1 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 flex-1 truncate">
              🔗 {activity.affiliateLink.targetName} ({PROVIDER_LABELS[activity.affiliateLink.provider]})
            </span>
            <button
              onClick={detachLink}
              disabled={saving}
              className="text-xs px-2 py-1 rounded border border-white/10 text-white/40 hover:text-red-400 hover:border-red-500/30 transition-colors"
            >
              Remove
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setLinkOpen(o => !o)}
              className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-white/20 text-white/40 hover:text-white hover:border-white/40 transition-colors"
            >
              + Attach link
            </button>
            {linkOpen && (
              <div className="mt-2 space-y-2">
                {linkError && <p className="text-xs text-red-400">{linkError}</p>}
                <input
                  className={inputCls}
                  placeholder="Paste affiliate URL (Booking.com, Amazon, GYG, etc.)"
                  value={linkUrl}
                  onChange={e => setLinkUrl(e.target.value)}
                />
                <div className="flex gap-2">
                  <input
                    className={inputCls}
                    placeholder="Link label (e.g. Shinjuku Hotel)"
                    value={linkName}
                    onChange={e => setLinkName(e.target.value)}
                  />
                  <button
                    onClick={attachLink}
                    disabled={linkSaving || !linkUrl || !linkName}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-white text-black font-medium disabled:opacity-50 hover:bg-white/90 transition-colors"
                  >
                    {linkSaving ? '…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={saveActivity}
          disabled={saving || !form.title}
          className="text-xs px-4 py-1.5 rounded-lg bg-white text-black font-medium disabled:opacity-50 hover:bg-white/90 transition-colors"
        >
          {saving ? 'Saving…' : 'Done'}
        </button>
        <button
          onClick={() => { setEditing(false); setForm({ time: activity.time ?? '', title: activity.title, description: activity.description ?? '', type: activity.type }) }}
          className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/40 hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── DayCard ─────────────────────────────────────────────────────────────────

function DayCard({
  day,
  kitId,
  onUpdate,
  onDelete,
}: {
  day: Day
  kitId: string
  onUpdate: (updated: Day) => void
  onDelete: () => void
}) {
  const [editingHeader, setEditingHeader] = useState(false)
  const [headerSaving, setHeaderSaving] = useState(false)
  const [addingActivity, setAddingActivity] = useState(false)
  const [header, setHeader] = useState({
    title: day.title,
    city: day.city ?? '',
    country: day.country ?? '',
  })
  const [collapsed, setCollapsed] = useState(false)

  function updateActivity(updated: Activity) {
    onUpdate({
      ...day,
      activities: day.activities.map(a => a.id === updated.id ? updated : a),
    })
  }

  function deleteActivity(actId: string) {
    onUpdate({ ...day, activities: day.activities.filter(a => a.id !== actId) })
  }

  async function saveHeader() {
    setHeaderSaving(true)
    try {
      const res = await fetch(`/api/kits/${kitId}/days/${day.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: header.title,
          city: header.city || null,
          country: header.country || null,
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      const updated = await res.json()
      onUpdate({ ...day, title: updated.title, city: updated.city, country: updated.country })
      setEditingHeader(false)
    } finally {
      setHeaderSaving(false)
    }
  }

  async function addActivity() {
    setAddingActivity(true)
    try {
      const res = await fetch(`/api/kits/${kitId}/days/${day.id}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Activity', type: 'OTHER' }),
      })
      if (!res.ok) throw new Error('Failed')
      const newAct = await res.json()
      onUpdate({ ...day, activities: [...day.activities, newAct] })
    } finally {
      setAddingActivity(false)
    }
  }

  async function deleteDay() {
    if (!confirm(`Delete Day ${day.dayNumber} and all its activities?`)) return
    await fetch(`/api/kits/${kitId}/days/${day.id}`, { method: 'DELETE' })
    onDelete()
  }

  return (
    <div className="glass-card overflow-hidden">
      {/* Day header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="text-white/30 hover:text-white transition-colors text-sm w-4"
        >
          {collapsed ? '▶' : '▼'}
        </button>
        <div className="flex-1 min-w-0">
          {editingHeader ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-white/30 shrink-0">Day {day.dayNumber}</span>
              <input
                className="bg-white/10 border border-white/20 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-white/40 flex-1 min-w-0"
                value={header.title}
                onChange={e => setHeader(h => ({ ...h, title: e.target.value }))}
                placeholder="Day title"
              />
              <input
                className="bg-white/10 border border-white/20 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-white/40 w-28"
                value={header.city}
                onChange={e => setHeader(h => ({ ...h, city: e.target.value }))}
                placeholder="City"
              />
              <input
                className="bg-white/10 border border-white/20 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-white/40 w-24"
                value={header.country}
                onChange={e => setHeader(h => ({ ...h, country: e.target.value }))}
                placeholder="Country"
              />
              <button
                onClick={saveHeader}
                disabled={headerSaving}
                className="text-xs px-2.5 py-1 rounded bg-white text-black font-medium disabled:opacity-50"
              >
                {headerSaving ? '…' : 'Save'}
              </button>
              <button
                onClick={() => setEditingHeader(false)}
                className="text-xs text-white/30 hover:text-white"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-white/30">Day {day.dayNumber}</span>
              <span className="text-sm font-semibold text-white">{day.title}</span>
              {(day.city || day.country) && (
                <span className="text-xs text-white/40">
                  {[day.city, day.country].filter(Boolean).join(', ')}
                </span>
              )}
              <span className="text-xs text-white/30">· {day.activities.length} activities</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!editingHeader && (
            <button
              onClick={() => setEditingHeader(true)}
              className="text-xs px-2 py-1 rounded text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            >
              Edit
            </button>
          )}
          <button
            onClick={deleteDay}
            className="text-xs px-2 py-1 rounded text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Activities */}
      {!collapsed && (
        <div className="px-2 py-2 space-y-1">
          {day.activities.length === 0 && (
            <p className="text-xs text-white/20 px-3 py-2">No activities yet — add one below.</p>
          )}
          {day.activities.map(act => (
            <ActivityRow
              key={act.id}
              activity={act}
              dayId={day.id}
              kitId={kitId}
              onUpdate={updateActivity}
              onDelete={() => deleteActivity(act.id)}
            />
          ))}
          <button
            onClick={addActivity}
            disabled={addingActivity}
            className="w-full text-left text-xs px-3 py-2 rounded-lg text-white/30 hover:text-white hover:bg-white/5 transition-colors border border-dashed border-white/10 hover:border-white/20 mt-1"
          >
            {addingActivity ? 'Adding…' : '+ Add activity'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── ItineraryEditor ─────────────────────────────────────────────────────────

export default function ItineraryEditor({ kitId, initialDays }: Props) {
  const [days, setDays] = useState<Day[]>(initialDays)
  const [addingDay, setAddingDay] = useState(false)

  function updateDay(updated: Day) {
    setDays(prev => prev.map(d => d.id === updated.id ? updated : d))
  }

  function deleteDay(dayId: string) {
    setDays(prev => {
      const filtered = prev.filter(d => d.id !== dayId)
      // Re-number locally
      return filtered.map((d, i) => ({ ...d, dayNumber: i + 1 }))
    })
  }

  async function addDay() {
    setAddingDay(true)
    try {
      const res = await fetch(`/api/kits/${kitId}/days`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error('Failed to add day')
      const newDay = await res.json()
      setDays(prev => [...prev, newDay])
    } finally {
      setAddingDay(false)
    }
  }

  return (
    <div className="space-y-3">
      {days.length === 0 && (
        <div className="text-center py-10 text-white/30 text-sm border border-dashed border-white/10 rounded-xl">
          No itinerary yet. Add your first day below.
        </div>
      )}

      {days.map(day => (
        <DayCard
          key={day.id}
          day={day}
          kitId={kitId}
          onUpdate={updateDay}
          onDelete={() => deleteDay(day.id)}
        />
      ))}

      <button
        onClick={addDay}
        disabled={addingDay}
        className="w-full py-3 rounded-xl border border-dashed border-white/20 text-sm text-white/40 hover:text-white hover:border-white/40 disabled:opacity-50 transition-colors"
      >
        {addingDay ? 'Adding day…' : `+ Add Day ${days.length + 1}`}
      </button>
    </div>
  )
}
