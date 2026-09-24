import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { journeyRepo } from '../../repo/journeyRepo'
import type { Journey } from '../../store/journeyStore'
import { useTranslation } from '../../i18n'

type TripOption = { id: number; title: string; start_date?: string | null; end_date?: string | null }

export function useLocalJourney() {
  const { language } = useTranslation()
  const zh = language.startsWith('zh')
  const navigate = useNavigate()
  const [journeys, setJourneys] = useState<Journey[]>([])
  const [trips, setTrips] = useState<TripOption[]>([])
  const [selectedTrips, setSelectedTrips] = useState<number[]>([])
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const refresh = () => {
      void journeyRepo.list().then(result => { if (active) setJourneys(result.journeys) })
        .catch(err => { if (active) setError(String(err?.message || err)) })
        .finally(() => { if (active) setLoading(false) })
    }
    refresh()
    const onSync = (event: Event) => { if ((event as CustomEvent<{ pulled?: number }>).detail?.pulled) refresh() }
    window.addEventListener('travel-sync-complete', onSync)
    return () => { active = false; window.removeEventListener('travel-sync-complete', onSync) }
  }, [])

  const openCreate = async () => {
    setError('')
    setCreating(true)
    try { setTrips((await journeyRepo.availableTrips()).trips) }
    catch (err) { setError(String((err as Error).message || err)) }
  }

  const create = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      const row = await journeyRepo.create({ title: title.trim(), subtitle: subtitle.trim(), trip_ids: selectedTrips })
      navigate(`/journey/${row.id}`)
    } catch (err) { setError(String((err as Error).message || err)) }
    finally { setSaving(false) }
  }

  return { journeys, trips, selectedTrips, setSelectedTrips, title, setTitle, subtitle, setSubtitle, creating, setCreating, saving, error, loading, openCreate, create, zh }
}
