import { offlineDb } from '../db/offlineDb'
import type { Trip } from '../types'
import type { ActiveTripResponse, TripCreateRequest, TripUpdateRequest } from '@trek/shared'
import type { LocalTripRecord } from '../domain/tripSyncModel'
import type { LocalDayRecord } from '../domain/daySyncModel'
import type { LocalAssignmentRecord } from '../domain/assignmentSyncModel'
import { randomId } from '../utils/randomId'
import { markLocalChange } from '../sync/localChangeRepository'
import { resolveStoredFileUrl } from './fileRepo'

export interface LocalTripOwner {
  id: number
  username?: string | null
}

const DEVELOPMENT_SEED_KEY = 'development-trip-seeded-v1'

function inclusiveDayCount(startDate?: string | null, endDate?: string | null): number | undefined {
  if (!startDate || !endDate) return undefined
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined
  return Math.round((end - start) / 86_400_000) + 1
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

async function nextLocalTripId(): Promise<number> {
  const first = await offlineDb.trips.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}

async function nextLocalDayId(): Promise<number> {
  const first = await offlineDb.days.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}

function localDay(id: number, trip: LocalTripRecord, dayNumber: number, now: string): LocalDayRecord {
  return {
    id,
    sync_id: randomId(),
    trip_id: trip.id,
    trip_sync_id: trip.sync_id,
    day_number: dayNumber,
    date: trip.start_date ? addUtcDays(trip.start_date, dayNumber - 1) : null,
    title: null,
    notes: null,
    default_transport_mode: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  }
}

function tripFromCreate(
  id: number,
  data: TripCreateRequest,
  owner: LocalTripOwner | undefined,
  now: string,
): LocalTripRecord {
  return {
    id,
    sync_id: randomId(),
    user_id: owner?.id ?? 0,
    title: data.title,
    description: data.description ?? null,
    start_date: data.start_date ?? null,
    end_date: data.end_date ?? null,
    currency: data.currency ?? 'CNY',
    cover_image: null,
    is_archived: 0,
    reminder_days: data.reminder_days ?? 3,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    day_count: inclusiveDayCount(data.start_date, data.end_date) ?? data.day_count ?? 7,
    place_count: 0,
    is_owner: 1,
    owner_username: owner?.username ?? undefined,
    shared_count: 0,
  }
}

/**
 * Write the development sample through the same IndexedDB used by the app.
 * appMeta makes this a one-time seed: deleting Japan 2026 does not recreate it.
 */
export async function ensureDevelopmentSeed(): Promise<void> {
  await offlineDb.transaction('rw', [offlineDb.trips, offlineDb.appMeta], async () => {
    if (await offlineDb.appMeta.get(DEVELOPMENT_SEED_KEY)) return
    if (await offlineDb.trips.count() === 0) {
      const now = new Date().toISOString()
      await offlineDb.trips.put(tripFromCreate(-1, {
        title: 'Japan 2026',
        description: 'Development seed trip',
        start_date: '2026-11-01',
        end_date: '2026-11-10',
        currency: 'JPY',
        reminder_days: 3,
      }, undefined, now))
    }
    await offlineDb.appMeta.put({ key: DEVELOPMENT_SEED_KEY, value: new Date().toISOString() })
  })
}

/**
 * Offline stand-in for GET /trips/active. Mirrors the server's ranking
 * (trips.service.ts activeTrip): the trip running today, else the next one to
 * start, else the most recently started. Dates are plain local calendar dates.
 */
function pickActive(trips: Trip[]): Trip | null {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const relevance = (t: Trip): number => {
    if (t.start_date && t.end_date && t.start_date <= today && t.end_date >= today) return 0
    if (t.start_date && t.start_date >= today) return 1
    return 2
  }
  const ranked = [...trips].sort((a, b) => {
    const ra = relevance(a)
    const rb = relevance(b)
    if (ra !== rb) return ra - rb
    // Upcoming: soonest first. Everything else: most recently started first.
    return ra === 2
      ? (b.start_date ?? '').localeCompare(a.start_date ?? '')
      : (a.start_date ?? '').localeCompare(b.start_date ?? '')
  })
  return ranked[0] ?? null
}

async function displayTrip<T extends Trip>(trip: T): Promise<T> {
  return { ...trip, cover_image: await resolveStoredFileUrl(trip.cover_image) } as T
}

export const tripRepo = {
  async list(): Promise<{ trips: Trip[]; archivedTrips: Trip[] }> {
    if (import.meta.env.DEV && import.meta.env.MODE !== 'test') await ensureDevelopmentSeed()
    const all = await Promise.all((await offlineDb.trips.toArray()).filter(t => !t.deleted_at).map(displayTrip))
    return {
      trips: all.filter(t => !t.is_archived),
      archivedTrips: all.filter(t => t.is_archived),
    }
  },

  /**
   * The startup redirect asks for this on the very first paint, so it has to
   * answer offline too — otherwise "open my active trip on startup" drops the
   * user on the dashboard whenever the launch has no network.
   */
  async active(): Promise<ActiveTripResponse> {
    const all = (await offlineDb.trips.toArray()).filter(t => !t.deleted_at)
    const trip = pickActive(all.filter(t => !t.is_archived))
    return {
      trip: trip
        ? { id: trip.id, title: trip.title, start_date: trip.start_date, end_date: trip.end_date }
        : null,
    }
  },

  async get(tripId: number | string): Promise<{ trip: Trip }> {
    const trip = await offlineDb.trips.get(Number(tripId))
    if (!trip || trip.deleted_at) throw new Error('Trip not found in local database')
    return { trip: await displayTrip(trip) }
  },

  async create(data: TripCreateRequest, owner?: LocalTripOwner): Promise<{ trip: LocalTripRecord }> {
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.days, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const trip = tripFromCreate(await nextLocalTripId(), data, owner, new Date().toISOString())
      await offlineDb.trips.add(trip)
      await markLocalChange('trip', trip.sync_id, 'upsert')
      let dayId = await nextLocalDayId()
      for (let dayNumber = 1; dayNumber <= (trip.day_count ?? 0); dayNumber++) {
        const day = localDay(dayId--, trip, dayNumber, trip.created_at)
        await offlineDb.days.add(day)
        await markLocalChange('day', day.sync_id, 'upsert')
      }
      return { trip }
    })
  },

  async update(tripId: number | string, data: TripUpdateRequest): Promise<{ trip: LocalTripRecord }> {
    const id = Number(tripId)
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.days, offlineDb.assignments, offlineDb.accommodations, offlineDb.reservations, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const current = await offlineDb.trips.get(id)
      if (!current || current.deleted_at) throw new Error('Trip not found in local database')
      const { date_shift_mode: _dateShiftMode, ...patch } = data
      void _dateShiftMode
      const nextStart = patch.start_date === undefined ? current.start_date : patch.start_date
      const nextEnd = patch.end_date === undefined ? current.end_date : patch.end_date
      const desiredDayCount = inclusiveDayCount(nextStart, nextEnd) ?? patch.day_count ?? current.day_count ?? 0
      const now = new Date().toISOString()
      const trip: LocalTripRecord = {
        ...current,
        ...patch,
        sync_id: current.sync_id || randomId(),
        created_at: current.created_at || new Date().toISOString(),
        deleted_at: current.deleted_at ?? null,
        is_archived: patch.is_archived == null
          ? current.is_archived
          : Number(Boolean(patch.is_archived)),
        day_count: desiredDayCount,
        updated_at: now,
      }
      await offlineDb.trips.put(trip)
      await markLocalChange('trip', trip.sync_id, 'upsert')

      const dayGridChanged = patch.start_date !== undefined || patch.end_date !== undefined || patch.day_count !== undefined
      if (dayGridChanged) {
        const days = (await offlineDb.days.where('trip_id').equals(id).toArray())
          .filter(day => !day.deleted_at)
          .sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0)) as LocalDayRecord[]
        for (let index = 0; index < days.length; index++) {
          const currentDay = days[index]
          const updated: LocalDayRecord = {
            ...currentDay,
            sync_id: currentDay.sync_id || randomId(),
            trip_sync_id: currentDay.trip_sync_id || trip.sync_id,
            created_at: currentDay.created_at || now,
            updated_at: now,
            deleted_at: index < desiredDayCount ? null : now,
            day_number: index + 1,
            date: index < desiredDayCount ? (nextStart ? addUtcDays(nextStart, index) : null) : currentDay.date ?? null,
          }
          await offlineDb.days.put(updated)
          await markLocalChange('day', updated.sync_id, updated.deleted_at ? 'delete' : 'upsert')
          if (updated.deleted_at) {
            const assignments = await offlineDb.assignments.where('day_id').equals(updated.id).toArray() as LocalAssignmentRecord[]
            for (const assignment of assignments.filter(item => !item.deleted_at)) {
              const tombstone = { ...assignment, deleted_at: now, updated_at: now }
              await offlineDb.assignments.put(tombstone)
              await markLocalChange('assignment', tombstone.sync_id, 'delete')
            }
            const stays = await offlineDb.accommodations.where('trip_id').equals(id).toArray()
            const removedStays = stays.filter(item => !item.deleted_at && (item.start_day_id === updated.id || item.end_day_id === updated.id))
            for (const stay of removedStays) {
              await offlineDb.accommodations.put({ ...stay, deleted_at: now, updated_at: now })
              if (stay.sync_id) await markLocalChange('accommodation', stay.sync_id, 'delete')
            }
            const reservations = await offlineDb.reservations.where('trip_id').equals(id).toArray()
            for (const reservation of reservations.filter(item => !item.deleted_at && (item.day_id === updated.id || item.end_day_id === updated.id || removedStays.some(stay => stay.id === Number(item.accommodation_id))))) {
              const linkedStay = removedStays.some(stay => stay.id === Number(reservation.accommodation_id))
              const changed = { ...reservation,
                ...(reservation.day_id === updated.id ? { day_id: null, day_sync_id: null } : {}),
                ...(reservation.end_day_id === updated.id ? { end_day_id: null, end_day_sync_id: null } : {}),
                ...(linkedStay ? { accommodation_id: null, accommodation_sync_id: null } : {}), updated_at: now }
              await offlineDb.reservations.put(changed)
              if (changed.sync_id) await markLocalChange('reservation', changed.sync_id, 'upsert')
            }
          }
        }
        let nextDayId = await nextLocalDayId()
        for (let index = days.length; index < desiredDayCount; index++) {
          const day = localDay(nextDayId--, trip, index + 1, now)
          await offlineDb.days.add(day)
          await markLocalChange('day', day.sync_id, 'upsert')
        }
      }
      return { trip }
    })
  },

  async delete(tripId: number | string): Promise<void> {
    const id = Number(tripId)
    await offlineDb.transaction('rw', [
      offlineDb.trips, offlineDb.days, offlineDb.dayNotes, offlineDb.places, offlineDb.assignments,
      offlineDb.accommodations, offlineDb.reservations, offlineDb.budgetItems,
      offlineDb.todoItems, offlineDb.packingBags, offlineDb.packingItems, offlineDb.tripFiles,
      offlineDb.syncOutbox, offlineDb.entitySyncMeta,
    ], async () => {
      const trip = await offlineDb.trips.get(id)
      if (!trip || trip.deleted_at) throw new Error('Trip not found in local database')
      const now = new Date().toISOString()
      const syncId = trip.sync_id || randomId()
      await offlineDb.trips.put({ ...trip, sync_id: syncId, created_at: trip.created_at || now, deleted_at: now, updated_at: now })
      await markLocalChange('trip', syncId, 'delete')

      // A Trip is the personal sync boundary. Tombstone every owned child in
      // the same transaction so another device never receives live records
      // whose parent has already disappeared.
      const groups = [
        { table: offlineDb.days, type: 'day' as const },
        { table: offlineDb.dayNotes, type: 'dayNote' as const },
        { table: offlineDb.places, type: 'place' as const },
        { table: offlineDb.assignments, type: 'assignment' as const },
        { table: offlineDb.accommodations, type: 'accommodation' as const },
        { table: offlineDb.reservations, type: 'reservation' as const },
        { table: offlineDb.budgetItems, type: 'budgetItem' as const },
        { table: offlineDb.todoItems, type: 'todo' as const },
        { table: offlineDb.packingBags, type: 'packingBag' as const },
        { table: offlineDb.packingItems, type: 'packingItem' as const },
        { table: offlineDb.tripFiles, type: 'tripFile' as const },
      ]
      for (const group of groups) {
        const rows = await group.table.where('trip_id').equals(id).toArray() as Array<{ sync_id?: string; deleted_at?: string | null; updated_at?: string }>
        for (const row of rows) {
          if (!row.sync_id || row.deleted_at) continue
          await group.table.put({ ...row, deleted_at: now, updated_at: now } as never)
          await markLocalChange(group.type, row.sync_id, 'delete')
        }
      }
    })
  },

  archive(tripId: number | string): Promise<{ trip: LocalTripRecord }> {
    return this.update(tripId, { is_archived: 1 })
  },

  unarchive(tripId: number | string): Promise<{ trip: LocalTripRecord }> {
    return this.update(tripId, { is_archived: 0 })
  },
}
