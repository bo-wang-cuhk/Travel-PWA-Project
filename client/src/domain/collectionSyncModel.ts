import type { Collection, CollectionPlace } from '@trek/shared'

export interface LocalCollectionRecord extends Collection {
  sync_id: string
  updated_at: string
  deleted_at: string | null
}

export interface LocalCollectionPlaceRecord extends CollectionPlace {
  sync_id: string
  collection_sync_id: string
  source_trip_sync_id?: string | null
  source_place_sync_id?: string | null
  category_sync_id?: string | null
  updated_at: string
  deleted_at: string | null
}

export interface SyncedCollection {
  schemaVersion: 1
  id: string
  name: string
  description: string | null
  color: string | null
  icon: string | null
  coverImage: string | null
  links: Collection['links']
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface SyncedCollectionPlace {
  schemaVersion: 1
  id: string
  collectionId: string
  sourceTripId: string | null
  sourcePlaceId: string | null
  categoryId: string | null
  value: Omit<CollectionPlace, 'id' | 'collection_id' | 'created_at' | 'updated_at' | 'source_trip_id' | 'source_place_id' | 'category_id'>
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export function toSyncedCollection(row: LocalCollectionRecord): SyncedCollection {
  return {
    schemaVersion: 1, id: row.sync_id, name: row.name, description: row.description ?? null,
    color: row.color ?? null, icon: row.icon ?? null, coverImage: row.cover_image ?? null,
    links: row.links ?? [], sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at || row.updated_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
  }
}

export function applySyncedCollection(remote: SyncedCollection, localId: number, ownerId: number): LocalCollectionRecord {
  return {
    id: localId, sync_id: remote.id, owner_id: ownerId, name: remote.name,
    description: remote.description, color: remote.color, icon: remote.icon,
    cover_image: remote.coverImage, links: remote.links, sort_order: remote.sortOrder,
    is_owner: true, members: [], labels: [], created_at: remote.createdAt,
    updated_at: remote.updatedAt, deleted_at: remote.deletedAt,
  }
}

export function toSyncedCollectionPlace(row: LocalCollectionPlaceRecord): SyncedCollectionPlace {
  const {
    id: _id, collection_id: _collectionId, created_at: _createdAt, updated_at: _updatedAt,
    source_trip_id: _sourceTripId, source_place_id: _sourcePlaceId, category_id: _categoryId,
    ...value
  } = row
  delete (value as Partial<LocalCollectionPlaceRecord>).sync_id
  delete (value as Partial<LocalCollectionPlaceRecord>).collection_sync_id
  delete (value as Partial<LocalCollectionPlaceRecord>).source_trip_sync_id
  delete (value as Partial<LocalCollectionPlaceRecord>).source_place_sync_id
  delete (value as Partial<LocalCollectionPlaceRecord>).category_sync_id
  delete (value as Partial<LocalCollectionPlaceRecord>).deleted_at
  return {
    schemaVersion: 1, id: row.sync_id, collectionId: row.collection_sync_id,
    sourceTripId: row.source_trip_sync_id ?? null,
    sourcePlaceId: row.source_place_sync_id ?? null,
    categoryId: row.category_sync_id ?? null,
    value, createdAt: row.created_at || row.updated_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
  }
}

export function applySyncedCollectionPlace(
  remote: SyncedCollectionPlace,
  localId: number,
  relations: { collectionId: number; sourceTripId: number | null; sourcePlaceId: number | null; categoryId: number | null },
): LocalCollectionPlaceRecord {
  return {
    ...remote.value,
    id: localId, sync_id: remote.id, collection_id: relations.collectionId, collection_sync_id: remote.collectionId,
    source_trip_id: relations.sourceTripId, source_trip_sync_id: remote.sourceTripId,
    source_place_id: relations.sourcePlaceId, source_place_sync_id: remote.sourcePlaceId,
    category_id: relations.categoryId, category_sync_id: remote.categoryId,
    created_at: remote.createdAt, updated_at: remote.updatedAt, deleted_at: remote.deletedAt,
  }
}
