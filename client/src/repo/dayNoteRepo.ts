import type { DayNote } from '../types'
import { offlineDb } from '../db/offlineDb'
import type { LocalDayNoteRecord } from '../domain/dayNoteSyncModel'
import { markLocalChange } from '../sync/localChangeRepository'
import { randomId } from '../utils/randomId'

async function nextId(): Promise<number> {
  const first = await offlineDb.dayNotes.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}

export const dayNoteRepo = {
  async listByTrip(tripId: number): Promise<LocalDayNoteRecord[]> {
    const rows = await offlineDb.dayNotes.where('trip_id').equals(tripId).toArray()
    return rows.filter(row => !row.deleted_at).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  },

  async create(tripId: number, dayId: number, data: Partial<DayNote> & { text: string }): Promise<{ note: LocalDayNoteRecord }> {
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.days, offlineDb.dayNotes, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const [trip, day] = await Promise.all([offlineDb.trips.get(tripId), offlineDb.days.get(dayId)])
      if (!trip?.sync_id || trip.deleted_at || !day?.sync_id || day.deleted_at || day.trip_id !== tripId) throw new Error('Day not found in local database')
      const now = new Date().toISOString()
      const note: LocalDayNoteRecord = {
        id: await nextId(), sync_id: randomId(), trip_id: tripId, trip_sync_id: trip.sync_id,
        day_id: dayId, day_sync_id: day.sync_id, text: data.text, time: data.time ?? null,
        icon: data.icon ?? 'FileText', color: data.color ?? null, sort_order: data.sort_order ?? 0,
        created_at: now, updated_at: now, deleted_at: null,
      }
      await offlineDb.dayNotes.add(note)
      await markLocalChange('dayNote', note.sync_id, 'upsert')
      return { note }
    })
  },

  async update(tripId: number, dayId: number, id: number, data: Partial<DayNote>): Promise<{ note: LocalDayNoteRecord }> {
    return offlineDb.transaction('rw', [offlineDb.dayNotes, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const current = await offlineDb.dayNotes.get(id)
      if (!current || current.deleted_at || current.trip_id !== tripId || current.day_id !== dayId) throw new Error('Day note not found in local database')
      const note = { ...current, ...data, id: current.id, updated_at: new Date().toISOString() }
      await offlineDb.dayNotes.put(note)
      await markLocalChange('dayNote', note.sync_id, 'upsert')
      return { note }
    })
  },

  async delete(tripId: number, dayId: number, id: number): Promise<void> {
    await offlineDb.transaction('rw', [offlineDb.dayNotes, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const current = await offlineDb.dayNotes.get(id)
      if (!current || current.deleted_at || current.trip_id !== tripId || current.day_id !== dayId) throw new Error('Day note not found in local database')
      const now = new Date().toISOString()
      await offlineDb.dayNotes.put({ ...current, deleted_at: now, updated_at: now })
      await markLocalChange('dayNote', current.sync_id, 'delete')
    })
  },

  async move(tripId: number, fromDayId: number, toDayId: number, id: number, sortOrder: number): Promise<{ note: LocalDayNoteRecord }> {
    return offlineDb.transaction('rw', [offlineDb.days, offlineDb.dayNotes, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const [current, target] = await Promise.all([offlineDb.dayNotes.get(id), offlineDb.days.get(toDayId)])
      if (!current || current.deleted_at || current.trip_id !== tripId || current.day_id !== fromDayId || !target?.sync_id || target.deleted_at || target.trip_id !== tripId) throw new Error('Day note relation is unavailable')
      const note = { ...current, day_id: toDayId, day_sync_id: target.sync_id, sort_order: sortOrder, updated_at: new Date().toISOString() }
      await offlineDb.dayNotes.put(note)
      await markLocalChange('dayNote', note.sync_id, 'upsert')
      return { note }
    })
  },
}
