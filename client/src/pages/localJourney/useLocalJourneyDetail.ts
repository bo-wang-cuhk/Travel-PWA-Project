import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { journeyRepo } from '../../repo/journeyRepo'
import { offlineDb } from '../../db/offlineDb'
import { workspaceMembersApi, type WorkspacePerson } from '../../auth/workspaceMembersApi'
import { useTranslation } from '../../i18n'
import type { JourneyDetail, JourneyEntry } from '../../store/journeyStore'
import { localIsoDate } from '../../utils/localDate'

type PlaceOption = { id: number; tripId: number; name: string; lat: number | null; lng: number | null }

export function useLocalJourneyDetail() {
  const { id } = useParams()
  const journeyId = Number(id)
  const navigate = useNavigate()
  const { language } = useTranslation()
  const zh = language.startsWith('zh')
  const [journey, setJourney] = useState<JourneyDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<JourneyEntry | 'new' | null>(null)
  const [entryTitle, setEntryTitle] = useState('')
  const [entryDate, setEntryDate] = useState(localIsoDate())
  const [story, setStory] = useState('')
  const [placeId, setPlaceId] = useState('')
  const [locationName, setLocationName] = useState('')
  const [places, setPlaces] = useState<PlaceOption[]>([])
  const [members, setMembers] = useState<WorkspacePerson[]>([])
  const [showMembers, setShowMembers] = useState(false)
  const [selectedMember, setSelectedMember] = useState('')
  const [selectedRole, setSelectedRole] = useState<'editor' | 'viewer'>('editor')
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTitle, setSettingsTitle] = useState('')
  const [settingsSubtitle, setSettingsSubtitle] = useState('')
  const [settingsStatus, setSettingsStatus] = useState<JourneyDetail['status']>('draft')
  const [tripOptions, setTripOptions] = useState<Array<{ id: number; title: string }>>([])
  const [selectedTrips, setSelectedTrips] = useState<number[]>([])
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const current = await journeyRepo.get(journeyId)
      setJourney(current)
      const linkedIds = new Set(current.trips.map(trip => trip.trip_id))
      const rows = await offlineDb.places.toArray()
      setPlaces(rows.filter(row => linkedIds.has(row.trip_id) && !row.deleted_at).map(row => ({ id: row.id, tripId: row.trip_id, name: row.name, lat: row.lat ?? null, lng: row.lng ?? null })))
      setError('')
    } catch (err) { setError(String((err as Error).message || err)) }
    finally { setLoading(false) }
  }, [journeyId])

  useEffect(() => {
    void refresh()
    const onSync = (event: Event) => { if ((event as CustomEvent<{ pulled?: number }>).detail?.pulled) void refresh() }
    window.addEventListener('travel-sync-complete', onSync)
    return () => window.removeEventListener('travel-sync-complete', onSync)
  }, [refresh])

  const canEdit = journey?.my_role === 'owner' || journey?.my_role === 'editor'
  const openEditor = (entry: JourneyEntry | 'new') => {
    setEditing(entry)
    setEntryTitle(entry === 'new' ? '' : entry.title ?? '')
    setEntryDate(entry === 'new' ? localIsoDate() : entry.entry_date)
    setStory(entry === 'new' ? '' : entry.story ?? '')
    setPlaceId(entry === 'new' ? '' : String(entry.source_place_id ?? ''))
    setLocationName(entry === 'new' ? '' : entry.location_name ?? '')
  }
  const saveEntry = async () => {
    if (!editing || saving || !entryDate) return
    setSaving(true)
    try {
      const selectedPlace = places.find(item => String(item.id) === placeId)
      const place = selectedPlace?.name === locationName.trim() ? selectedPlace : undefined
      const patch: Partial<JourneyEntry> = { title: entryTitle.trim() || null, story: story.trim() || null, entry_date: entryDate,
        source_place_id: place?.id ?? null, source_trip_id: place?.tripId ?? null,
        location_name: locationName.trim() || null, location_lat: place?.lat ?? null, location_lng: place?.lng ?? null }
      if (editing === 'new') await journeyRepo.createEntry(journeyId, patch)
      else await journeyRepo.updateEntry(editing.id, patch)
      setEditing(null)
      await refresh()
    } catch (err) { setError(String((err as Error).message || err)) }
    finally { setSaving(false) }
  }
  const deleteEntry = async (entry: JourneyEntry) => {
    if (!window.confirm(zh ? '删除这条记录？' : 'Delete this entry?')) return
    try { await journeyRepo.deleteEntry(entry.id); await refresh() }
    catch (err) { setError(String((err as Error).message || err)) }
  }
  const moveEntry = async (index: number, direction: -1 | 1) => {
    if (!journey) return
    const target = index + direction
    if (target < 0 || target >= journey.entries.length || journey.entries[index].entry_date !== journey.entries[target].entry_date) return
    const ids = journey.entries.map(entry => entry.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    try { await journeyRepo.reorderEntries(journeyId, ids); await refresh() }
    catch (err) { setError(String((err as Error).message || err)) }
  }
  const openMembers = async () => {
    setShowMembers(true)
    try { setMembers((await workspaceMembersApi.context()).members) }
    catch (err) { setError(String((err as Error).message || err)) }
  }
  const addMember = async () => {
    if (!selectedMember) return
    setSaving(true)
    try { await journeyRepo.addContributor(journeyId, Number(selectedMember), selectedRole, members.find(member => member.id === Number(selectedMember))); setSelectedMember(''); await refresh() }
    catch (err) { setError(String((err as Error).message || err)) }
    finally { setSaving(false) }
  }
  const removeMember = async (userId: number) => {
    if (!window.confirm(zh ? '移除这位成员？' : 'Remove this member?')) return
    try { await journeyRepo.removeContributor(journeyId, userId); await refresh() }
    catch (err) { setError(String((err as Error).message || err)) }
  }
  const removeJourney = async () => {
    if (!window.confirm(zh ? '删除整个旅程及其中的记录？' : 'Delete this journey and all its entries?')) return
    try { await journeyRepo.delete(journeyId); navigate('/journey') }
    catch (err) { setError(String((err as Error).message || err)) }
  }
  const openSettings = async () => {
    if (!journey) return
    setSettingsTitle(journey.title)
    setSettingsSubtitle(journey.subtitle ?? '')
    setSettingsStatus(journey.status)
    setSelectedTrips(journey.trips.map(trip => trip.trip_id))
    setShowSettings(true)
    try { setTripOptions((await journeyRepo.availableTrips()).trips) }
    catch (err) { setError(String((err as Error).message || err)) }
  }
  const saveSettings = async () => {
    if (!journey || !settingsTitle.trim() || saving) return
    setSaving(true)
    try {
      await journeyRepo.update(journeyId, { title: settingsTitle.trim(), subtitle: settingsSubtitle.trim() || null, status: settingsStatus })
      await journeyRepo.setTrips(journeyId, selectedTrips)
      setShowSettings(false)
      await refresh()
    } catch (err) { setError(String((err as Error).message || err)) }
    finally { setSaving(false) }
  }

  const toggleArchive = async () => {
    if (!journey) return
    try { await journeyRepo.update(journeyId, { status: journey.status === 'archived' ? 'active' : 'archived' }); await refresh() }
    catch (err) { setError(String(err)) }
  }
  const changeMemberRole = async (userId: number, role: 'editor' | 'viewer') => {
    try { await journeyRepo.addContributor(journeyId, userId, role, members.find(person => person.id === userId)); await refresh() }
    catch (err) { setError(String(err)) }
  }

  return { zh, journey, loading, error, editing, setEditing, entryTitle, setEntryTitle, entryDate, setEntryDate, story, setStory, placeId, setPlaceId, locationName, setLocationName, places, members, showMembers, setShowMembers, selectedMember, setSelectedMember, selectedRole, setSelectedRole, showSettings, setShowSettings, settingsTitle, setSettingsTitle, settingsSubtitle, setSettingsSubtitle, settingsStatus, setSettingsStatus, tripOptions, selectedTrips, setSelectedTrips, saving, canEdit, openEditor, saveEntry, deleteEntry, moveEntry, openMembers, addMember, removeMember, removeJourney, openSettings, saveSettings, toggleArchive, changeMemberRole }
}
