import type { DayCreateRequest, DayUpdateRequest } from '@trek/shared'
import { offlineDb } from '../db/offlineDb'
import type { LocalDayRecord, StoredDayRecord } from '../domain/daySyncModel'
import { markLocalChange } from '../sync/localChangeRepository'
import type { Day } from '../types'
import { randomId } from '../utils/randomId'

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

async function nextLocalDayId(): Promise<number> {
  const first = await offlineDb.days.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}

function asLocalDay(day: StoredDayRecord, tripSyncId: string): LocalDayRecord {
  const now = new Date().toISOString()
  return {
    ...day,
    sync_id: day.sync_id || randomId(),
    trip_sync_id: day.trip_sync_id || tripSyncId,
    created_at: day.created_at || now,
    updated_at: day.updated_at || day.created_at || now,
    deleted_at: day.deleted_at ?? null,
  }
}

async function activeDays(tripId: number): Promise<LocalDayRecord[]> {
  const rows = await offlineDb.days.where('trip_id').equals(tripId).toArray()
  return rows
    .filter(day => !day.deleted_at)
    .sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0)) as LocalDayRecord[]
}

export const dayRepo = {
  async list(tripId: number | string): Promise<{ days: Day[] }> {
    return { days: await activeDays(Number(tripId)) }
  },

  async get(dayId: number | string): Promise<{ day: LocalDayRecord }> {
    const day = await offlineDb.days.get(Number(dayId))
    if (!day || day.deleted_at) throw new Error('Day not found in local database')
    return { day: day as LocalDayRecord }
  },

  async create(tripId: number | string, data: DayCreateRequest = {}): Promise<{ day: LocalDayRecord }> {
    const localTripId = Number(tripId)
    return offlineDb.transaction(
      'rw',
      [offlineDb.trips, offlineDb.days, offlineDb.syncOutbox, offlineDb.entitySyncMeta],
      async () => {
        const trip = await offlineDb.trips.get(localTripId)
        if (!trip || trip.deleted_at || !trip.sync_id) throw new Error('Trip not found in local database')
        const rows = await activeDays(localTripId)
        const position = Math.max(1, Math.min(data.position ?? rows.length + 1, rows.length + 1))
        const now = new Date().toISOString()
        const day: LocalDayRecord = {
          id: await nextLocalDayId(),
          sync_id: randomId(),
          trip_id: localTripId,
          trip_sync_id: trip.sync_id,
          day_number: position,
          date: data.date ?? (trip.start_date ? addUtcDays(trip.start_date, position - 1) : null),
          title: null,
          notes: data.notes ?? null,
          default_transport_mode: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        }

        for (const current of rows.filter(row => (row.day_number ?? 0) >= position)) {
          const shifted = {
            ...asLocalDay(current, trip.sync_id),
            day_number: (current.day_number ?? 0) + 1,
            date: trip.start_date ? addUtcDays(trip.start_date, current.day_number ?? 0) : current.date,
            updated_at: now,
          }
          await offlineDb.days.put(shifted)
          await markLocalChange('day', shifted.sync_id, 'upsert')
        }
        await offlineDb.days.add(day)
        await markLocalChange('day', day.sync_id, 'upsert')

        const dayCount = rows.length + 1
        await offlineDb.trips.put({
          ...trip,
          day_count: dayCount,
          end_date: trip.start_date && trip.end_date ? addUtcDays(trip.start_date, dayCount - 1) : trip.end_date,
          updated_at: now,
        })
        await markLocalChange('trip', trip.sync_id, 'upsert')
        return { day }
      },
    )
  },

  async update(tripId: number | string, dayId: number | string, data: DayUpdateRequest): Promise<{ day: LocalDayRecord }> {
    const localTripId = Number(tripId)
    const id = Number(dayId)
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.days, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const [trip, stored] = await Promise.all([offlineDb.trips.get(localTripId), offlineDb.days.get(id)])
      if (!trip || trip.deleted_at || !trip.sync_id) throw new Error('Trip not found in local database')
      if (!stored || stored.deleted_at || stored.trip_id !== localTripId) throw new Error('Day not found in local database')
      const day = { ...asLocalDay(stored, trip.sync_id), ...data, updated_at: new Date().toISOString() }
      await offlineDb.days.put(day)
      await markLocalChange('day', day.sync_id, 'upsert')
      return { day }
    })
  },

  updateTransport(tripId: number | string, dayId: number | string, mode: string | null): Promise<{ day: LocalDayRecord }> {
    return this.update(tripId, dayId, { default_transport_mode: mode } as DayUpdateRequest)
  },

  async reorder(tripId: number | string, orderedIds: number[]): Promise<{ days: LocalDayRecord[] }> {
    const localTripId = Number(tripId)
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.days, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const trip = await offlineDb.trips.get(localTripId)
      if (!trip || trip.deleted_at || !trip.sync_id) throw new Error('Trip not found in local database')
      const rows = await activeDays(localTripId)
      if (orderedIds.length !== rows.length || new Set(orderedIds).size !== rows.length || orderedIds.some(id => !rows.some(row => row.id === id))) {
        throw new Error('Day reorder must contain every active day exactly once')
      }
      const byId = new Map(rows.map(day => [day.id, day]))
      const dates = rows.map(day => day.date).filter((date): date is string => Boolean(date)).sort()
      const now = new Date().toISOString()
      const reordered: LocalDayRecord[] = []
      for (let index = 0; index < orderedIds.length; index++) {
        const current = byId.get(orderedIds[index])!
        const day = {
          ...asLocalDay(current, trip.sync_id),
          day_number: index + 1,
          date: dates.length === rows.length ? dates[index] : current.date,
          updated_at: now,
        }
        await offlineDb.days.put(day)
        await markLocalChange('day', day.sync_id, 'upsert')
        reordered.push(day)
      }
      return { days: reordered }
    })
  },

  async delete(tripId: number | string, dayId: number | string): Promise<void> {
    const localTripId = Number(tripId)
    const id = Number(dayId)
    await offlineDb.transaction(
      'rw',
      [offlineDb.trips, offlineDb.days, offlineDb.syncOutbox, offlineDb.entitySyncMeta],
      async () => {
        const [trip, stored] = await Promise.all([offlineDb.trips.get(localTripId), offlineDb.days.get(id)])
        if (!trip || trip.deleted_at || !trip.sync_id) throw new Error('Trip not found in local database')
        if (!stored || stored.deleted_at || stored.trip_id !== localTripId) throw new Error('Day not found in local database')
        const now = new Date().toISOString()
        const deleted = { ...asLocalDay(stored, trip.sync_id), deleted_at: now, updated_at: now }
        await offlineDb.days.put(deleted)
        await markLocalChange('day', deleted.sync_id, 'delete')

        const remaining = (await activeDays(localTripId)).filter(day => day.id !== id)
        for (let index = 0; index < remaining.length; index++) {
          const current = remaining[index]
          const day = {
            ...asLocalDay(current, trip.sync_id),
            day_number: index + 1,
            date: trip.start_date ? addUtcDays(trip.start_date, index) : current.date,
            updated_at: now,
          }
          await offlineDb.days.put(day)
          await markLocalChange('day', day.sync_id, 'upsert')
        }

        await offlineDb.trips.put({
          ...trip,
          day_count: remaining.length,
          end_date: trip.start_date && trip.end_date && remaining.length > 0
            ? addUtcDays(trip.start_date, remaining.length - 1)
            : trip.end_date,
          updated_at: now,
        })
        await markLocalChange('trip', trip.sync_id, 'upsert')
      },
    )
  },
}
