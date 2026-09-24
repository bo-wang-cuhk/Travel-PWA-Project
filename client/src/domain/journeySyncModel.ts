import type { Journey, JourneyEntry } from '../store/journeyStore'

/** Numeric ids are local UI keys. UUIDs survive a second device's Dexie import. */
export interface LocalJourneyRecord extends Journey {
  sync_id: string
  owner_auth_id: string | null
  owner_username: string
  trip_sync_ids: string[]
  members: Array<{ authId: string; userId: number; username: string; role: 'editor' | 'viewer' }>
  deleted_at: string | null
  local_updated_at: string
}

export interface LocalJourneyEntryRecord extends JourneyEntry {
  sync_id: string
  journey_sync_id: string
  source_trip_sync_id: string | null
  source_place_sync_id: string | null
  deleted_at: string | null
  local_updated_at: string
}

export interface SyncedJourney {
  schemaVersion: 1
  id: string
  title: string
  subtitle: string | null
  status: Journey['status']
  coverGradient: string | null
  ownerAuthId: string | null
  ownerUserId: number
  ownerUsername: string
  tripIds: string[]
  members: LocalJourneyRecord['members']
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface SyncedJourneyEntry {
  schemaVersion: 1
  id: string
  journeyId: string
  sourceTripId: string | null
  sourcePlaceId: string | null
  value: Omit<JourneyEntry, 'id' | 'journey_id' | 'source_trip_id' | 'source_place_id' | 'photos' | 'created_at' | 'updated_at'>
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export function toSyncedJourney(row: LocalJourneyRecord): SyncedJourney {
  return {
    schemaVersion: 1, id: row.sync_id, title: row.title, subtitle: row.subtitle ?? null,
    status: row.status, coverGradient: row.cover_gradient ?? null,
    ownerAuthId: row.owner_auth_id, ownerUserId: row.user_id, ownerUsername: row.owner_username, tripIds: row.trip_sync_ids,
    members: row.members, createdAt: new Date(row.created_at).toISOString(),
    updatedAt: row.local_updated_at, deletedAt: row.deleted_at,
  }
}

export function toSyncedJourneyEntry(row: LocalJourneyEntryRecord): SyncedJourneyEntry {
  const {
    id: _id, journey_id: _journeyId, source_trip_id: _sourceTripId,
    source_place_id: _sourcePlaceId, photos: _photos, created_at: _createdAt,
    updated_at: _updatedAt, sync_id: _syncId, journey_sync_id: _journeySyncId,
    source_trip_sync_id: _sourceTripSyncId, source_place_sync_id: _sourcePlaceSyncId,
    deleted_at: _deletedAt, local_updated_at: _localUpdatedAt, ...value
  } = row
  return {
    schemaVersion: 1, id: row.sync_id, journeyId: row.journey_sync_id,
    sourceTripId: row.source_trip_sync_id, sourcePlaceId: row.source_place_sync_id,
    value, createdAt: new Date(row.created_at).toISOString(),
    updatedAt: row.local_updated_at, deletedAt: row.deleted_at,
  }
}
