import type { TripFile } from '../types'

export interface LocalTripFileRecord extends TripFile {
  sync_id: string
  trip_sync_id: string
  place_sync_id: string | null
  reservation_sync_id: string | null
  linked_place_sync_ids: string[]
  linked_reservation_sync_ids: string[]
  storage_path: string
  updated_at: string
  deleted_at: string | null
  purged_at: string | null
}

export type StoredTripFileRecord = TripFile & Partial<Omit<LocalTripFileRecord, keyof TripFile>>

export interface SyncedTripFile {
  schemaVersion: 1
  id: string
  tripId: string
  placeId: string | null
  reservationId: string | null
  linkedPlaceIds: string[]
  linkedReservationIds: string[]
  storagePath: string
  filename: string
  originalName: string
  fileSize: number
  mimeType: string
  description: string | null
  starred: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  purgedAt: string | null
}

export function toSyncedTripFile(value: LocalTripFileRecord): SyncedTripFile {
  return {
    schemaVersion: 1,
    id: value.sync_id,
    tripId: value.trip_sync_id,
    placeId: value.place_sync_id,
    reservationId: value.reservation_sync_id,
    linkedPlaceIds: value.linked_place_sync_ids,
    linkedReservationIds: value.linked_reservation_sync_ids,
    storagePath: value.storage_path,
    filename: value.filename,
    originalName: value.original_name,
    fileSize: value.file_size ?? 0,
    mimeType: value.mime_type || 'application/octet-stream',
    description: value.description ?? null,
    starred: Boolean(value.starred),
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    deletedAt: value.deleted_at,
    purgedAt: value.purged_at,
  }
}

export function applySyncedTripFile(
  remote: SyncedTripFile,
  localId: number,
  relations: { tripId: number; placeId: number | null; reservationId: number | null; linkedPlaceIds: number[]; linkedReservationIds: number[] },
): LocalTripFileRecord {
  return {
    id: localId,
    sync_id: remote.id,
    trip_id: relations.tripId,
    trip_sync_id: remote.tripId,
    place_id: relations.placeId,
    place_sync_id: remote.placeId,
    reservation_id: relations.reservationId,
    reservation_sync_id: remote.reservationId,
    linked_place_ids: relations.linkedPlaceIds,
    linked_place_sync_ids: remote.linkedPlaceIds,
    linked_reservation_ids: relations.linkedReservationIds,
    linked_reservation_sync_ids: remote.linkedReservationIds,
    note_id: null,
    filename: remote.filename,
    original_name: remote.originalName,
    file_size: remote.fileSize,
    mime_type: remote.mimeType,
    description: remote.description,
    starred: Number(remote.starred),
    created_at: remote.createdAt,
    updated_at: remote.updatedAt,
    deleted_at: remote.deletedAt,
    purged_at: remote.purgedAt,
    storage_path: remote.storagePath,
    url: '',
  }
}
