import type { DayNote } from '../types'

export interface LocalDayNoteRecord extends DayNote {
  trip_id: number
  sync_id: string
  trip_sync_id: string
  day_sync_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface SyncedDayNote {
  schemaVersion: 1
  id: string
  tripId: string
  dayId: string
  text: string
  time: string | null
  icon: string | null
  color: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export function toSyncedDayNote(value: LocalDayNoteRecord): SyncedDayNote {
  return {
    schemaVersion: 1, id: value.sync_id, tripId: value.trip_sync_id, dayId: value.day_sync_id,
    text: value.text, time: value.time ?? null, icon: value.icon ?? null, color: value.color ?? null,
    sortOrder: value.sort_order ?? 0, createdAt: value.created_at, updatedAt: value.updated_at,
    deletedAt: value.deleted_at,
  }
}

export function applySyncedDayNote(remote: SyncedDayNote, localId: number, tripId: number, dayId: number): LocalDayNoteRecord {
  return {
    id: localId, sync_id: remote.id, trip_id: tripId, trip_sync_id: remote.tripId,
    day_id: dayId, day_sync_id: remote.dayId, text: remote.text, time: remote.time,
    icon: remote.icon, color: remote.color, sort_order: remote.sortOrder,
    created_at: remote.createdAt, updated_at: remote.updatedAt, deleted_at: remote.deletedAt,
  }
}
