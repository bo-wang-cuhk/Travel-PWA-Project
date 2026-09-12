import type { Day } from '../types'

/**
 * Transitional local Day row. Numeric ids keep the existing planner working;
 * UUID references are the canonical cross-device identity.
 */
export interface LocalDayRecord extends Day {
  sync_id: string
  trip_sync_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type StoredDayRecord = Day & Partial<Pick<LocalDayRecord,
  'sync_id' | 'trip_sync_id' | 'created_at' | 'updated_at' | 'deleted_at'
>>

/** Provider-neutral Day document. Numeric local ids are never exported. */
export interface SyncedDay {
  schemaVersion: 1
  id: string
  tripId: string
  dayNumber: number
  date: string | null
  title: string | null
  notes: string | null
  defaultTransportMode: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export function toSyncedDay(day: LocalDayRecord): SyncedDay {
  return {
    schemaVersion: 1,
    id: day.sync_id,
    tripId: day.trip_sync_id,
    dayNumber: day.day_number ?? 1,
    date: day.date ?? null,
    title: day.title ?? null,
    notes: day.notes ?? null,
    defaultTransportMode: day.default_transport_mode ?? null,
    createdAt: day.created_at,
    updatedAt: day.updated_at,
    deletedAt: day.deleted_at,
  }
}

export function applySyncedDay(remote: SyncedDay, localId: number, tripId: number): LocalDayRecord {
  return {
    id: localId,
    sync_id: remote.id,
    trip_id: tripId,
    trip_sync_id: remote.tripId,
    day_number: remote.dayNumber,
    date: remote.date,
    title: remote.title,
    notes: remote.notes,
    default_transport_mode: remote.defaultTransportMode,
    created_at: remote.createdAt,
    updated_at: remote.updatedAt,
    deleted_at: remote.deletedAt,
  }
}
