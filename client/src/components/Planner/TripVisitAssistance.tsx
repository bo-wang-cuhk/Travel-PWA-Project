import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Circle, Minus, X } from 'lucide-react'
import type { Place, Trip } from '../../types'
import type { GeoPosition } from '../../hooks/useGeolocation'
import { useTranslation } from '../../i18n'
import { useToast } from '../shared/Toast'
import { localDateKey, nearestUnpromptedPlace, visitAssistancePhase } from './tripVisitAssistanceModel'
import { statusOptions, type VisitStatus } from './placeVisitStatusModel'

function promptedIds(tripId: number): Set<number> {
  try {
    const raw = sessionStorage.getItem(`trek-visit-prompts:${tripId}`)
    return new Set(raw ? JSON.parse(raw) as number[] : [])
  } catch { return new Set() }
}

export default function TripVisitAssistance({ trip, places, position, canEdit, mobile = false, onUpdate }: {
  trip: Trip
  places: Place[]
  position: GeoPosition | null
  canEdit: boolean
  mobile?: boolean
  onUpdate: (placeId: number, status: VisitStatus) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [nearbyId, setNearbyId] = useState<number | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [draft, setDraft] = useState<Record<number, VisitStatus>>({})
  const [saving, setSaving] = useState(false)
  const [today, setToday] = useState(localDateKey)
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  const prompted = useRef(promptedIds(trip.id))
  const lastFix = useRef<number | null>(null)
  const phase = visitAssistancePhase(trip, today)
  const pendingCount = places.filter(place => (place.visit_status ?? 'planned') === 'planned').length
  const nearby = places.find(place => place.id === nearbyId && (place.visit_status ?? 'planned') === 'planned')

  useEffect(() => {
    const check = () => { setToday(localDateKey()); setVisible(document.visibilityState !== 'hidden') }
    const timer = window.setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check) }
  }, [])

  useEffect(() => { if (nearbyId != null && !nearby) setNearbyId(null) }, [nearbyId, nearby])

  useEffect(() => {
    if (phase !== 'active' || !position || !canEdit || !visible) { setNearbyId(null); return }
    // One candidate per GPS fix. Dismissing a prompt must not immediately open
    // another for a second place in the same cluster.
    if (lastFix.current === position.timestamp) return
    lastFix.current = position.timestamp
    if (nearbyId != null) return
    const candidate = nearestUnpromptedPlace(places, position, prompted.current)
    if (!candidate) return
    prompted.current.add(candidate.id)
    try { sessionStorage.setItem(`trek-visit-prompts:${trip.id}`, JSON.stringify([...prompted.current])) } catch { /* session storage may be unavailable */ }
    setNearbyId(candidate.id)
  }, [phase, position, canEdit, visible, nearbyId, places, trip.id])

  const confirmNearby = async () => {
    if (!nearby || saving) return
    setSaving(true)
    try {
      await onUpdate(nearby.id, 'visited')
      setNearbyId(null)
    } catch { toast.error(t('common.error')) }
    finally { setSaving(false) }
  }

  const openReview = () => {
    setDraft(Object.fromEntries(places.map(place => [place.id, place.visit_status ?? 'planned'])))
    setReviewOpen(true)
  }

  const saveReview = async () => {
    if (saving) return
    setSaving(true)
    try {
      for (const place of places) {
        const status = draft[place.id] ?? 'planned'
        if (status !== (place.visit_status ?? 'planned')) await onUpdate(place.id, status)
      }
      setReviewOpen(false)
    } catch { toast.error(t('common.error')) }
    finally { setSaving(false) }
  }

  if (!canEdit || (phase !== 'ended' && !nearby)) return null
  const top = mobile ? 'calc(var(--m-safe-top, 12px) + 98px)' : 'calc(var(--nav-h) + 54px)'
  const buttonStyle = { border: 0, background: 'transparent', padding: '5px 7px', font: 'inherit', cursor: 'pointer' } as const
  return <>
    {nearby && phase === 'active' && <div role="status" style={{ position: 'fixed', top, left: 12, right: 12, zIndex: 65, margin: '0 auto', maxWidth: 460, padding: '10px 14px', borderRadius: 12, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', boxShadow: '0 8px 30px rgba(0,0,0,.16)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ flex: 1, minWidth: 170, fontSize: 13 }}>{t('places.maybeArrived', { name: nearby.name })}</span>
      <button type="button" disabled={saving} onClick={confirmNearby} style={{ ...buttonStyle, color: '#16a34a', fontWeight: 600 }}>{t('places.markVisited')}</button>
      <button type="button" disabled={saving} onClick={() => setNearbyId(null)} style={buttonStyle}>{t('places.ignoreArrival')}</button>
    </div>}

    {phase === 'ended' && pendingCount > 0 && <div role="status" style={{ position: 'fixed', top, left: 12, right: 12, zIndex: 65, margin: '0 auto', maxWidth: 460, padding: '10px 14px', borderRadius: 12, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', boxShadow: '0 8px 30px rgba(0,0,0,.16)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ flex: 1, minWidth: 170, fontSize: 13 }}>{t('places.unconfirmedCount', { count: pendingCount })}</span>
      <button type="button" onClick={openReview} style={{ ...buttonStyle, color: 'var(--accent)', fontWeight: 600 }}>{t('places.reviewVisits')}</button>
    </div>}

    {reviewOpen && createPortal(<div role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !saving) setReviewOpen(false) }} style={{ position: 'fixed', inset: 0, zIndex: 1000000, background: 'rgba(0,0,0,.48)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={t('places.reviewVisits')} style={{ width: 'min(100%, 520px)', maxHeight: 'min(80vh, 720px)', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', color: 'var(--text-primary)', borderRadius: 16, boxShadow: '0 18px 50px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '18px 20px 10px', gap: 12 }}>
          <strong style={{ flex: 1 }}>{t('places.reviewVisits')}</strong>
          <button type="button" aria-label={t('common.close')} disabled={saving} onClick={() => setReviewOpen(false)} style={buttonStyle}><X size={18} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '6px 20px 12px' }}>
          {places.map(place => <div key={place.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-faint)', flexWrap: 'wrap' }}>
            {draft[place.id] === 'visited' ? <Check size={16} color="#16a34a" /> : draft[place.id] === 'skipped' ? <Minus size={16} color="var(--text-faint)" /> : <Circle size={16} color="var(--text-muted)" />}
            <span style={{ flex: 1, minWidth: 120, opacity: draft[place.id] === 'skipped' ? .7 : 1 }}>{place.name}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {statusOptions.map(option => <button key={option.value} type="button" disabled={saving} aria-pressed={draft[place.id] === option.value} onClick={() => setDraft(current => ({ ...current, [place.id]: option.value }))} style={{ ...buttonStyle, borderRadius: 7, background: draft[place.id] === option.value ? 'var(--bg-selected)' : 'transparent', color: option.value === 'visited' && draft[place.id] === option.value ? '#16a34a' : 'var(--text-secondary)', fontSize: 12 }}>{t(option.key)}</button>)}
            </div>
          </div>)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px 18px' }}>
          <button type="button" disabled={saving} onClick={() => setReviewOpen(false)} style={buttonStyle}>{t('common.cancel')}</button>
          <button type="button" disabled={saving} onClick={saveReview} style={{ ...buttonStyle, color: 'var(--accent)', fontWeight: 700 }}>{t('common.save')}</button>
        </div>
      </div>
    </div>, document.body)}
  </>
}
