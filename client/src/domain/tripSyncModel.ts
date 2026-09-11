import type { Trip } from '../types'

/**
 * Transitional local record. `id` remains the TREK numeric compatibility key
 * until child entities migrate; `sync_id` is the canonical cross-device id.
 */
export interface LocalTripRecord extends Trip {
  sync_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** Rows created before Dexie v6 are accepted while the upgrade normalizes them. */
export type StoredTripRecord = Trip & Partial<Pick<LocalTripRecord, 'sync_id' | 'deleted_at'>>

/** Provider-neutral representation written to a personal sync provider. */
export interface SyncedTrip {
  schemaVersion: 1
  id: string
  title: string
  description: string | null
  startDate: string | null
  endDate: string | null
  currency: string
  coverImage: string | null
  archived: boolean
  reminderDays: number
  dayCount?: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export function toSyncedTrip(trip: LocalTripRecord): SyncedTrip {
  return {
    schemaVersion: 1,
    id: trip.sync_id,
    title: trip.title,
    description: trip.description ?? null,
    startDate: trip.start_date ?? null,
    endDate: trip.end_date ?? null,
    currency: trip.currency,
    coverImage: trip.cover_image ?? null,
    archived: Boolean(trip.is_archived),
    reminderDays: trip.reminder_days,
    dayCount: trip.day_count,
    createdAt: trip.created_at,
    updatedAt: trip.updated_at,
    deletedAt: trip.deleted_at,
  }
}

export function applySyncedTrip(
  remote: SyncedTrip,
  localId: number,
  userId = 0,
): LocalTripRecord {
  return {
    id: localId,
    sync_id: remote.id,
    user_id: userId,
    title: remote.title,
    description: remote.description,
    start_date: remote.startDate,
    end_date: remote.endDate,
    currency: remote.currency,
    cover_image: remote.coverImage,
    is_archived: Number(remote.archived),
    reminder_days: remote.reminderDays,
    day_count: remote.dayCount,
    place_count: 0,
    is_owner: 1,
    shared_count: 0,
    created_at: remote.createdAt,
    updated_at: remote.updatedAt,
    deleted_at: remote.deletedAt,
  }
}
