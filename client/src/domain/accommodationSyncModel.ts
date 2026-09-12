import type { Accommodation } from '../types'

export interface LocalAccommodationRecord extends Accommodation {
  sync_id: string
  trip_sync_id: string
  place_sync_id: string | null
  start_day_sync_id: string
  end_day_sync_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type StoredAccommodationRecord = Accommodation & Partial<Omit<LocalAccommodationRecord, keyof Accommodation>>

export interface SyncedAccommodation {
  schemaVersion: 1
  id: string
  tripId: string
  placeId: string | null
  startDayId: string
  endDayId: string
  checkIn: string | null
  checkInEnd: string | null
  checkOut: string | null
  confirmation: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export function toSyncedAccommodation(value: LocalAccommodationRecord): SyncedAccommodation {
  return {
    schemaVersion: 1, id: value.sync_id, tripId: value.trip_sync_id,
    placeId: value.place_sync_id, startDayId: value.start_day_sync_id, endDayId: value.end_day_sync_id,
    checkIn: value.check_in ?? null, checkInEnd: value.check_in_end ?? null, checkOut: value.check_out ?? null,
    confirmation: value.confirmation ?? null, notes: value.notes ?? null,
    createdAt: value.created_at, updatedAt: value.updated_at, deletedAt: value.deleted_at,
  }
}

export function applySyncedAccommodation(
  remote: SyncedAccommodation, localId: number, tripId: number, placeId: number | null, startDayId: number, endDayId: number,
): LocalAccommodationRecord {
  return {
    id: localId, sync_id: remote.id, trip_id: tripId, trip_sync_id: remote.tripId,
    place_id: placeId, place_sync_id: remote.placeId,
    start_day_id: startDayId, start_day_sync_id: remote.startDayId,
    end_day_id: endDayId, end_day_sync_id: remote.endDayId,
    check_in: remote.checkIn, check_in_end: remote.checkInEnd, check_out: remote.checkOut,
    confirmation: remote.confirmation, notes: remote.notes,
    created_at: remote.createdAt, updated_at: remote.updatedAt, deleted_at: remote.deletedAt,
  }
}
