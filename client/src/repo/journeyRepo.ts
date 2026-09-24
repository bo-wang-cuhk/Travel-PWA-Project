import { offlineDb } from '../db/offlineDb'
import type { LocalJourneyEntryRecord, LocalJourneyRecord } from '../domain/journeySyncModel'
import { getSupabaseClient, SUPABASE_AUTH_ENABLED } from '../auth/supabaseClient'
import { workspaceMembersApi, type WorkspacePerson } from '../auth/workspaceMembersApi'
import { markLocalChange } from '../sync/localChangeRepository'
import { randomId } from '../utils/randomId'
import { localIsoDate } from '../utils/localDate'
import type { Journey, JourneyDetail, JourneyEntry } from '../store/journeyStore'

let queue: Promise<void> = Promise.resolve()
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task)
  queue = result.then(() => undefined, () => undefined)
  return result
}
async function nextId(table: typeof offlineDb.journeys | typeof offlineDb.journeyEntries): Promise<number> {
  const first = await table.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}
function localUser(): { id: number; username: string } {
  try {
    const raw = localStorage.getItem('trek_auth_snapshot')
    const user = raw ? JSON.parse(raw)?.state?.user : null
    return { id: Number(user?.id ?? 0), username: String(user?.display_name || user?.username || '旅行者') }
  } catch { return { id: 0, username: '旅行者' } }
}
async function authId(): Promise<string | null> {
  if (!SUPABASE_AUTH_ENABLED) return null
  const { data } = await getSupabaseClient().auth.getSession()
  return data.session?.user.id ?? null
}
async function activeJourneys(): Promise<LocalJourneyRecord[]> {
  return (await offlineDb.journeys.toArray()).filter(row => !row.deleted_at)
}
async function activeEntries(journeyId: number): Promise<LocalJourneyEntryRecord[]> {
  return (await offlineDb.journeyEntries.where('journey_id').equals(journeyId).toArray())
    .filter(row => !row.deleted_at)
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.sort_order - b.sort_order || a.id - b.id)
}
async function tripViews(row: LocalJourneyRecord) {
  const trips = await Promise.all(row.trip_sync_ids.map(id => offlineDb.trips.where('sync_id').equals(id).first()))
  const places = await offlineDb.places.toArray()
  return trips.filter((trip): trip is NonNullable<typeof trip> => Boolean(trip && !trip.deleted_at)).map(trip => ({
    trip_id: trip.id, added_at: row.created_at, title: trip.title,
    start_date: trip.start_date ?? null, end_date: trip.end_date ?? null,
    cover_image: trip.cover_image ?? null, currency: trip.currency,
    place_count: places.filter(place => place.trip_id === trip.id && !place.deleted_at).length,
  }))
}
function visible(row: LocalJourneyRecord, who: string | null): boolean {
  return !row.owner_auth_id || row.owner_auth_id === who || row.members.some(member => member.authId === who)
}
function editable(row: LocalJourneyRecord, who: string | null): boolean {
  return !row.owner_auth_id || row.owner_auth_id === who || row.members.some(member => member.authId === who && member.role === 'editor')
}
async function requireJourney(id: number, edit = false): Promise<LocalJourneyRecord> {
  const row = await offlineDb.journeys.get(id)
  const who = await authId()
  if (!row || row.deleted_at || !visible(row, who)) throw new Error('Journey not found')
  if (edit && !editable(row, who)) throw new Error('Journey is read only')
  return row
}
async function touch(row: LocalJourneyRecord): Promise<void> {
  const next = { ...row, updated_at: Date.now(), local_updated_at: new Date().toISOString() }
  await offlineDb.journeys.put(next)
  await markLocalChange('journey', row.sync_id, 'upsert')
}

export const journeyRepo = {
  async list(): Promise<{ journeys: Journey[] }> {
    const who = await authId()
    const rows = (await activeJourneys()).filter(row => visible(row, who))
    const journeys = await Promise.all(rows.map(async row => {
      const [entries, trips] = await Promise.all([activeEntries(row.id), tripViews(row)])
      const dates = trips.flatMap(trip => [trip.start_date, trip.end_date]).filter((v): v is string => Boolean(v))
      return { ...row, entry_count: entries.filter(e => e.type !== 'skeleton').length,
        photo_count: 0, place_count: new Set(entries.map(e => e.location_name).filter(Boolean)).size,
        trip_date_min: dates.length ? [...dates].sort()[0] : null,
        trip_date_max: dates.length ? [...dates].sort()[dates.length - 1] : null }
    }))
    return { journeys: journeys.sort((a, b) => b.updated_at - a.updated_at) }
  },
  async get(id: number): Promise<JourneyDetail> {
    const row = await requireJourney(id)
    const [entries, trips] = await Promise.all([activeEntries(id), tripViews(row)])
    const who = await authId()
    const me = localUser()
    const contributors = [
      { journey_id: id, user_id: row.user_id, role: 'owner' as const, username: row.user_id === me.id ? me.username : row.owner_username, added_at: row.created_at },
      ...row.members.map(member => ({ journey_id: id, user_id: member.userId, role: member.role, username: member.username, added_at: row.created_at })),
    ]
    const myRole = row.owner_auth_id === who ? 'owner' : row.members.find(member => member.authId === who)?.role
    return { ...row, entries: entries.map(entry => ({ ...entry, photos: [] })), gallery: [], trips,
      contributors, stats: { entries: entries.filter(e => e.type !== 'skeleton').length, photos: 0,
        places: new Set(entries.map(e => e.location_name).filter(Boolean)).size },
      hide_skeletons: true, my_role: myRole }
  },
  async availableTrips() {
    const trips = (await offlineDb.trips.toArray()).filter(row => !row.deleted_at)
    const places = await offlineDb.places.toArray()
    return { trips: trips.map(trip => ({ ...trip, place_count: places.filter(place => place.trip_id === trip.id && !place.deleted_at).length })) }
  },
  async suggestions() { return { trips: [] } },
  async create(data: { title: string; subtitle?: string; trip_ids?: number[] }): Promise<Journey> {
    return serialize(async () => {
      const trips = await Promise.all((data.trip_ids ?? []).map(id => offlineDb.trips.get(id)))
      const me = localUser(), now = Date.now()
      const row: LocalJourneyRecord = { id: await nextId(offlineDb.journeys), sync_id: randomId(),
        user_id: me.id, owner_auth_id: await authId(), owner_username: me.username, title: data.title, subtitle: data.subtitle ?? null,
        cover_gradient: null, cover_image: null, status: 'draft', trip_sync_ids: trips.flatMap(t => t?.sync_id ? [t.sync_id] : []),
        members: [], created_at: now, updated_at: now, local_updated_at: new Date(now).toISOString(), deleted_at: null }
      await offlineDb.transaction('rw', [offlineDb.journeys, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
        await offlineDb.journeys.add(row)
        await markLocalChange('journey', row.sync_id, 'upsert')
      })
      return row
    })
  },
  async update(id: number, patch: Partial<Journey>): Promise<Journey> {
    return serialize(async () => {
      const row = await requireJourney(id, true)
      const now = Date.now(), next = { ...row,
        title: patch.title ?? row.title, subtitle: patch.subtitle === undefined ? row.subtitle : patch.subtitle,
        status: patch.status ?? row.status, cover_gradient: patch.cover_gradient === undefined ? row.cover_gradient : patch.cover_gradient,
        updated_at: now, local_updated_at: new Date(now).toISOString() }
      await offlineDb.transaction('rw', [offlineDb.journeys, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
        await offlineDb.journeys.put(next)
        await markLocalChange('journey', row.sync_id, 'upsert')
      })
      return next
    })
  },
  async delete(id: number): Promise<void> {
    return serialize(async () => {
      const row = await requireJourney(id, true)
      if (row.owner_auth_id !== await authId()) throw new Error('Only the journey owner can delete it')
      const now = new Date().toISOString()
      await offlineDb.transaction('rw', [offlineDb.journeys, offlineDb.journeyEntries, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
        await offlineDb.journeys.put({ ...row, deleted_at: now, updated_at: Date.now(), local_updated_at: now })
        await markLocalChange('journey', row.sync_id, 'delete')
        for (const entry of await activeEntries(id)) {
          await offlineDb.journeyEntries.put({ ...entry, deleted_at: now, updated_at: Date.now(), local_updated_at: now })
          await markLocalChange('journeyEntry', entry.sync_id, 'delete')
        }
      })
    })
  },
  async addTrip(id: number, tripId: number) {
    return serialize(async () => {
      const row = await requireJourney(id, true), trip = await offlineDb.trips.get(tripId)
      if (!trip?.sync_id || trip.deleted_at) throw new Error('Trip not found')
      if (!row.trip_sync_ids.includes(trip.sync_id)) {
        await offlineDb.transaction('rw', [offlineDb.journeys, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
          await touch({ ...row, trip_sync_ids: [...row.trip_sync_ids, trip.sync_id] })
        })
      }
      return { success: true }
    })
  },
  async removeTrip(id: number, tripId: number) {
    return serialize(async () => {
      const row = await requireJourney(id, true), trip = await offlineDb.trips.get(tripId)
      if (trip?.sync_id) await offlineDb.transaction('rw', [offlineDb.journeys, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
        await touch({ ...row, trip_sync_ids: row.trip_sync_ids.filter(value => value !== trip.sync_id) })
      })
      return { success: true }
    })
  },
  async setTrips(id: number, tripIds: number[]) {
    return serialize(async () => {
      const row = await requireJourney(id, true)
      const trips = await Promise.all(tripIds.map(tripId => offlineDb.trips.get(tripId)))
      if (trips.some(trip => !trip?.sync_id || trip.deleted_at)) throw new Error('Trip not found')
      await offlineDb.transaction('rw', [offlineDb.journeys, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
        await touch({ ...row, trip_sync_ids: trips.map(trip => trip!.sync_id!) })
      })
      return { success: true }
    })
  },
  async createEntry(journeyId: number, data: Partial<JourneyEntry>): Promise<JourneyEntry> {
    return serialize(async () => {
      const journey = await requireJourney(journeyId, true)
      const sourceTrip = data.source_trip_id == null ? null : await offlineDb.trips.get(data.source_trip_id)
      const sourcePlace = data.source_place_id == null ? null : await offlineDb.places.get(data.source_place_id)
      const now = Date.now(), me = localUser()
      const row: LocalJourneyEntryRecord = {
        id: await nextId(offlineDb.journeyEntries), sync_id: randomId(), journey_id: journeyId, journey_sync_id: journey.sync_id,
        source_trip_id: data.source_trip_id ?? null, source_trip_sync_id: sourceTrip?.sync_id ?? null,
        source_place_id: data.source_place_id ?? null, source_place_sync_id: sourcePlace?.sync_id ?? null,
        author_id: me.id, type: data.type ?? 'entry', title: data.title ?? null, story: data.story ?? null,
        entry_date: data.entry_date ?? localIsoDate(), entry_time: data.entry_time ?? null,
        location_name: data.location_name ?? null, location_lat: data.location_lat ?? null,
        location_lng: data.location_lng ?? null, mood: data.mood ?? null, weather: data.weather ?? null,
        tags: data.tags ?? [], pros_cons: data.pros_cons ?? null, visibility: data.visibility ?? 'private',
        sort_order: data.sort_order ?? (await activeEntries(journeyId)).length, stats_excluded: data.stats_excluded ?? false,
        photos: [], created_at: now, updated_at: now, local_updated_at: new Date(now).toISOString(), deleted_at: null,
      }
      await offlineDb.transaction('rw', [offlineDb.journeyEntries, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
        await offlineDb.journeyEntries.add(row)
        await markLocalChange('journeyEntry', row.sync_id, 'upsert')
      })
      return row
    })
  },
  async updateEntry(entryId: number, patch: Partial<JourneyEntry>): Promise<JourneyEntry> {
    return serialize(async () => {
      const row = await offlineDb.journeyEntries.get(entryId)
      if (!row || row.deleted_at) throw new Error('Entry not found')
      await requireJourney(row.journey_id, true)
      const sourceTrip = patch.source_trip_id == null ? null : await offlineDb.trips.get(patch.source_trip_id)
      const sourcePlace = patch.source_place_id == null ? null : await offlineDb.places.get(patch.source_place_id)
      const now = Date.now(), next = { ...row, ...patch, id: row.id, sync_id: row.sync_id,
        journey_id: row.journey_id, journey_sync_id: row.journey_sync_id,
        source_trip_sync_id: patch.source_trip_id === undefined ? row.source_trip_sync_id : sourceTrip?.sync_id ?? null,
        source_place_sync_id: patch.source_place_id === undefined ? row.source_place_sync_id : sourcePlace?.sync_id ?? null,
        updated_at: now, local_updated_at: new Date(now).toISOString(), photos: [] }
      await offlineDb.transaction('rw', [offlineDb.journeyEntries, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
        await offlineDb.journeyEntries.put(next)
        await markLocalChange('journeyEntry', row.sync_id, 'upsert')
      })
      return next
    })
  },
  async deleteEntry(entryId: number): Promise<void> {
    return serialize(async () => {
      const row = await offlineDb.journeyEntries.get(entryId)
      if (!row || row.deleted_at) return
      await requireJourney(row.journey_id, true)
      const now = new Date().toISOString()
      await offlineDb.transaction('rw', [offlineDb.journeyEntries, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
        await offlineDb.journeyEntries.put({ ...row, deleted_at: now, updated_at: Date.now(), local_updated_at: now })
        await markLocalChange('journeyEntry', row.sync_id, 'delete')
      })
    })
  },
  async reorderEntries(journeyId: number, ids: number[]) {
    return serialize(async () => {
      await requireJourney(journeyId, true)
      await offlineDb.transaction('rw', [offlineDb.journeyEntries, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
        for (let order = 0; order < ids.length; order++) {
          const row = await offlineDb.journeyEntries.get(ids[order])
          if (!row || row.journey_id !== journeyId || row.deleted_at) continue
          const now = Date.now()
          await offlineDb.journeyEntries.put({ ...row, sort_order: order, updated_at: now, local_updated_at: new Date(now).toISOString() })
          await markLocalChange('journeyEntry', row.sync_id, 'upsert')
        }
      })
      return { success: true }
    })
  },
  async addContributor(journeyId: number, userId: number, role: 'editor' | 'viewer', candidate?: WorkspacePerson) {
    const person = candidate?.id === userId ? candidate : (await workspaceMembersApi.context()).members.find(member => member.id === userId)
    if (!person) throw new Error('Select an existing workspace member')
    return serialize(async () => {
      const row = await requireJourney(journeyId)
      if (row.owner_auth_id !== await authId()) throw new Error('Only the journey owner can manage members')
      await offlineDb.transaction('rw', [offlineDb.journeys, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
        await touch({ ...row, members: [...row.members.filter(member => member.authId !== person.auth_id),
          { authId: person.auth_id, userId: person.id, username: person.display_name || person.username, role }] })
      })
      return { success: true }
    })
  },
  async removeContributor(journeyId: number, userId: number) {
    return serialize(async () => {
      const row = await requireJourney(journeyId)
      if (row.owner_auth_id !== await authId()) throw new Error('Only the journey owner can manage members')
      await offlineDb.transaction('rw', [offlineDb.journeys, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
        await touch({ ...row, members: row.members.filter(member => member.userId !== userId) })
      })
      return { success: true }
    })
  },
}
