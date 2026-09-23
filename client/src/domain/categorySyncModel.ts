import type { Category } from '../types'

export interface LocalCategoryRecord extends Category {
  sync_id: string
  updated_at: string
  deleted_at: string | null
}

export type StoredCategoryRecord = Category & Partial<Pick<LocalCategoryRecord,
  'sync_id' | 'updated_at' | 'deleted_at'
>>

export interface SyncedCategory {
  schemaVersion: 1
  id: string
  name: string
  color: string
  icon: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export function toSyncedCategory(category: LocalCategoryRecord): SyncedCategory {
  return {
    schemaVersion: 1,
    id: category.sync_id,
    name: category.name,
    color: category.color,
    icon: category.icon,
    createdAt: category.created_at || category.updated_at,
    updatedAt: category.updated_at,
    deletedAt: category.deleted_at,
  }
}

export function applySyncedCategory(remote: SyncedCategory, localId: number): LocalCategoryRecord {
  return {
    id: localId,
    sync_id: remote.id,
    name: remote.name,
    color: remote.color,
    icon: remote.icon,
    user_id: null,
    created_at: remote.createdAt,
    updated_at: remote.updatedAt,
    deleted_at: remote.deletedAt,
  }
}
