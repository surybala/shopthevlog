'use client'

import { useState } from 'react'

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

const ACTIVITY_TYPES = [
  { value: 'ACCOMMODATION', label: 'Stay', icon: 'Stay' },
  { value: 'FOOD', label: 'Food', icon: 'Food' },
  { value: 'ATTRACTION', label: 'Attraction', icon: 'Spot' },
  { value: 'TOUR', label: 'Tour', icon: 'Tour' },
  { value: 'ADVENTURE', label: 'Adventure', icon: 'Trail' },
  { value: 'CULTURAL', label: 'Cultural', icon: 'Culture' },
  { value: 'TRANSPORT', label: 'Transport', icon: 'Transit' },
  { value: 'WELLNESS', label: 'Wellness', icon: 'Rest' },
  { value: 'NIGHTLIFE', label: 'Nightlife', icon: 'After' },
  { value: 'OTHER', label: 'Other', icon: 'Note' },
] as const

const PROVIDER_LABELS: Record<string, string> = {
  BOOKING_COM: 'Booking.com',
  GETYOURGUIDE: 'GetYourGuide',
  VIATOR: 'Viator',
  AMAZON: 'Amazon',
  SKYSCANNER: 'Skyscanner',
  KLOOK: 'Klook',
  AIRBNB: 'Airbnb',
  EXPEDIA: 'Expedia',
  STAY22: 'Stay22',
  GOOGLE_FLIGHTS: 'Google Flights',
  CUSTOM: 'Custom',
}

function typeLabel(type: string) {
  return ACTIVITY_TYPES.find((entry) => entry.value === type)?.label ?? type
}

function typeBadge(type: string) {
  return ACTIVITY_TYPES.find((entry) => entry.value === type)?.icon ?? 'Note'
}

function ActivityRow({
  activity,
  dayId,
  kitId,
  onUpdate,
  onDelete,
}: {
  activity: Activity
  dayId: string
  kitId: string
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

  async function saveActivity() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/kits/${kitId}/days/${dayId}/activities/${activity.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          time: form.time || null,
          title: form.title,
          description: form.description || null,
          type: form.type,
        }),
      })
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
    setError('')
    try {
      const res = await fetch(`/api/kits/${kitId}/days/${dayId}/activities/${activity.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not delete activity')
      onDelete()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete activity')
    } finally {
      setSaving(false)
    }
  }

  async function attachLink() {
    if (!linkUrl || !linkName) {
      setLinkError('URL and name are required')
      return
    }
    try {
      new URL(linkUrl)
    } catch {
      setLinkError('Invalid URL')
      return
    }

    setLinkSaving(true)
    setLinkError('')
    try {
      const linkRes = await fetch('/api/affiliate-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetName: linkName, targetUrl: linkUrl, activityType: activity.type }),
      })
      if (!linkRes.ok) throw new Error((await linkRes.json()).error ?? 'Failed to create link')
      const newLink = await linkRes.json()

      const actRes = await fetch(`/api/kits/${kitId}/days/${dayId}/activities/${activity.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ affiliateLinkId: newLink.id }),
      })
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
    setError('')
    try {
      const res = await fetch(`/api/kits/${kitId}/days/${dayId}/activities/${activity.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ affiliateLinkId: null }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not detach link')
      const updated = await res.json()
      onUpdate(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not detach link')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="rounded-[1.4rem] bg-white/[0.035] px-4 py-4 ring-1 ring-white/8 transition hover:bg-white/[0.06]">
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-white/[0.08] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#f0b16b]">
            {typeBadge(activity.type)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {activity.time ? <span className="text-xs text-[#d2d9c7]/55">{activity.time}</span> : null}
              <span className="text-sm font-medium text-[#f7f1e4]">{activity.title}</span>
              <span className="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] text-[#d2d9c7]/72 ring-1 ring-white/10">
                {typeLabel(activity.type)}
              </span>
            </div>
            {activity.description ? <p className="mt-1 text-sm leading-6 text-[#d2d9c7]/68">{activity.description}</p> : null}
            {activity.affiliateLink ? (
              <div className="mt-3">
                <span className="rounded-full bg-[#5f84ff]/14 px-3 py-1 text-xs text-[#c7d5ff] ring-1 ring-[#7c98ff]/20">
                  {PROVIDER_LABELS[activity.affiliateLink.provider] ?? activity.affiliateLink.provider} · {activity.affiliateLink.targetName}
                </span>
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={() => setEditing(true)} className="dashboard-pill-button text-xs">
              Edit
            </button>
            <button onClick={deleteActivity} disabled={saving} className="dashboard-pill-button text-xs text-[#ffb5a8] hover:bg-red-400/10">
              Remove
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-[1.5rem] bg-white/[0.05] p-4 ring-1 ring-white/10">
      {error ? <p className="mb-3 text-xs text-red-200">{error}</p> : null}

      <div className="grid gap-3 md:grid-cols-[120px_1fr]">
        <div>
          <label className="dashboard-mirror-kicker mb-2 block text-[11px]">Time</label>
          <input className="dashboard-input" placeholder="09:00" value={form.time} onChange={(e) => setForm((prev) => ({ ...prev, time: e.target.value }))} />
        </div>
        <div>
          <label className="dashboard-mirror-kicker mb-2 block text-[11px]">Title</label>
          <input className="dashboard-input" placeholder="Ramen at Fuunji" value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
        </div>
      </div>

      <div className="mt-3">
        <label className="dashboard-mirror-kicker mb-2 block text-[11px]">Description</label>
        <input className="dashboard-input" placeholder="Brief description" value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
      </div>

      <div className="mt-4">
        <label className="dashboard-mirror-kicker mb-2 block text-[11px]">Type</label>
        <div className="flex flex-wrap gap-2">
          {ACTIVITY_TYPES.map((entry) => {
            const selected = form.type === entry.value
            return (
              <button
                key={entry.value}
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, type: entry.value }))}
                className={`rounded-full px-3 py-1.5 text-xs transition ${
                  selected
                    ? 'bg-[linear-gradient(135deg,rgba(240,152,74,0.32),rgba(232,118,34,0.2))] text-[#f7f1e4] ring-1 ring-[#f0b16b]/35'
                    : 'bg-white/[0.05] text-[#d2d9c7]/72 ring-1 ring-white/10 hover:bg-white/[0.08]'
                }`}
              >
                {entry.icon} · {entry.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-4 border-t border-white/8 pt-4">
        <p className="dashboard-mirror-kicker text-[11px]">Affiliate Link</p>
        {activity.affiliateLink ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#5f84ff]/14 px-3 py-1 text-xs text-[#c7d5ff] ring-1 ring-[#7c98ff]/20">
              {activity.affiliateLink.targetName} ({PROVIDER_LABELS[activity.affiliateLink.provider]})
            </span>
            <button onClick={detachLink} disabled={saving} className="dashboard-pill-button text-xs text-[#ffb5a8] hover:bg-red-400/10">
              Remove
            </button>
          </div>
        ) : (
          <>
            <button type="button" onClick={() => setLinkOpen((open) => !open)} className="dashboard-pill-button mt-3 text-xs">
              {linkOpen ? 'Hide link form' : 'Attach affiliate link'}
            </button>
            {linkOpen ? (
              <div className="mt-3 space-y-3">
                {linkError ? <p className="text-xs text-red-200">{linkError}</p> : null}
                <input className="dashboard-input" placeholder="Paste affiliate URL" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
                <div className="flex flex-col gap-3 md:flex-row">
                  <input className="dashboard-input" placeholder="Link label" value={linkName} onChange={(e) => setLinkName(e.target.value)} />
                  <button onClick={attachLink} disabled={linkSaving || !linkUrl || !linkName} className="btn-primary shrink-0 disabled:opacity-50">
                    {linkSaving ? 'Saving...' : 'Save link'}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={saveActivity} disabled={saving || !form.title} className="btn-primary disabled:opacity-50">
          {saving ? 'Saving...' : 'Done'}
        </button>
        <button
          onClick={() => {
            setEditing(false)
            setForm({
              time: activity.time ?? '',
              title: activity.title,
              description: activity.description ?? '',
              type: activity.type,
            })
          }}
          className="dashboard-pill-button"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

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
      activities: day.activities.map((activity) => (activity.id === updated.id ? updated : activity)),
    })
  }

  function deleteActivity(activityId: string) {
    onUpdate({
      ...day,
      activities: day.activities.filter((activity) => activity.id !== activityId),
    })
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
      if (!res.ok) throw new Error('Failed to add activity')
      const newActivity = await res.json()
      onUpdate({ ...day, activities: [...day.activities, newActivity] })
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
    <div className="dashboard-mirror-card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-white/8 px-5 py-4">
        <button onClick={() => setCollapsed((value) => !value)} className="text-sm text-[#d2d9c7]/58 transition hover:text-[#f7f1e4]">
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
        <div className="min-w-0 flex-1">
          {editingHeader ? (
            <div className="grid gap-3 md:grid-cols-[1fr_160px_160px_auto_auto]">
              <input className="dashboard-input" value={header.title} onChange={(e) => setHeader((prev) => ({ ...prev, title: e.target.value }))} placeholder="Day title" />
              <input className="dashboard-input" value={header.city} onChange={(e) => setHeader((prev) => ({ ...prev, city: e.target.value }))} placeholder="City" />
              <input className="dashboard-input" value={header.country} onChange={(e) => setHeader((prev) => ({ ...prev, country: e.target.value }))} placeholder="Country" />
              <button onClick={saveHeader} disabled={headerSaving} className="btn-primary disabled:opacity-50">
                {headerSaving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setEditingHeader(false)} className="dashboard-pill-button">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#f0b16b] ring-1 ring-white/10">
                Day {day.dayNumber}
              </span>
              <span className="text-base font-semibold text-[#f7f1e4]">{day.title}</span>
              {day.city || day.country ? <span className="text-sm text-[#d2d9c7]/64">{[day.city, day.country].filter(Boolean).join(', ')}</span> : null}
              <span className="text-sm text-[#d2d9c7]/52">{day.activities.length} activities</span>
            </div>
          )}
        </div>
        {!editingHeader ? (
          <div className="flex items-center gap-2">
            <button onClick={() => setEditingHeader(true)} className="dashboard-pill-button text-xs">
              Edit Day
            </button>
            <button onClick={deleteDay} className="dashboard-pill-button text-xs text-[#ffb5a8] hover:bg-red-400/10">
              Delete
            </button>
          </div>
        ) : null}
      </div>

      {!collapsed ? (
        <div className="space-y-3 px-4 py-4">
          {day.activities.length === 0 ? (
            <div className="rounded-[1.35rem] border border-dashed border-white/12 bg-white/[0.03] px-5 py-6 text-sm text-[#d2d9c7]/62">
              No activities yet. Add the first stop for this day below.
            </div>
          ) : null}

          {day.activities.map((activity) => (
            <ActivityRow
              key={activity.id}
              activity={activity}
              dayId={day.id}
              kitId={kitId}
              onUpdate={updateActivity}
              onDelete={() => deleteActivity(activity.id)}
            />
          ))}

          <button onClick={addActivity} disabled={addingActivity} className="dashboard-pill-button w-full justify-center py-3 text-sm disabled:opacity-50">
            {addingActivity ? 'Adding activity...' : 'Add activity'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default function ItineraryEditor({ kitId, initialDays }: Props) {
  const [days, setDays] = useState<Day[]>(initialDays)
  const [addingDay, setAddingDay] = useState(false)

  function updateDay(updated: Day) {
    setDays((prev) => prev.map((day) => (day.id === updated.id ? updated : day)))
  }

  function deleteDay(dayId: string) {
    setDays((prev) => {
      const remaining = prev.filter((day) => day.id !== dayId)
      return remaining.map((day, index) => ({ ...day, dayNumber: index + 1 }))
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
      setDays((prev) => [...prev, newDay])
    } finally {
      setAddingDay(false)
    }
  }

  return (
    <div className="space-y-4">
      {days.length === 0 ? (
        <div className="rounded-[1.75rem] border border-dashed border-white/12 bg-white/[0.03] py-10 text-center text-sm text-[#d2d9c7]/62">
          No itinerary yet. Add your first day below.
        </div>
      ) : null}

      {days.map((day) => (
        <DayCard key={day.id} day={day} kitId={kitId} onUpdate={updateDay} onDelete={() => deleteDay(day.id)} />
      ))}

      <button onClick={addDay} disabled={addingDay} className="dashboard-pill-button w-full justify-center py-4 text-sm disabled:opacity-50">
        {addingDay ? 'Adding day...' : `Add Day ${days.length + 1}`}
      </button>
    </div>
  )
}
