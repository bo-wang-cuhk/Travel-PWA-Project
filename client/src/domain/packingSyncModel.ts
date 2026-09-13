import type { PackingBag, PackingItem } from '../types'

export interface LocalPackingItemRecord extends PackingItem {
  sync_id: string
  trip_sync_id: string
  bag_sync_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface LocalPackingBagRecord extends PackingBag {
  sync_id: string
  trip_sync_id: string
  updated_at: string
  deleted_at: string | null
}

export type StoredPackingItemRecord = PackingItem & Partial<Omit<LocalPackingItemRecord, keyof PackingItem>>
export type StoredPackingBagRecord = PackingBag & Partial<Omit<LocalPackingBagRecord, keyof PackingBag>>

export interface LocalPackingTemplate {
  id: number
  syncId: string
  name: string
  items: Array<{ name: string; category?: string; quantity?: number; weight_grams?: number | null }>
}

export interface LocalPackingConfigRecord {
  id: 'personal-packing'
  categoryAssignees: Record<string, Record<string, Array<{ user_id: number; username: string }>>>
  templates: LocalPackingTemplate[]
  updated_at: string
}

export interface SyncedPackingConfig {
  schemaVersion: 1
  id: 'personal-packing'
  categoryAssignees: LocalPackingConfigRecord['categoryAssignees']
  templates: LocalPackingTemplate[]
  updatedAt: string
}

export function toSyncedPackingConfig(value: LocalPackingConfigRecord): SyncedPackingConfig {
  return { schemaVersion: 1, id: value.id, categoryAssignees: value.categoryAssignees, templates: value.templates, updatedAt: value.updated_at }
}

export function applySyncedPackingConfig(value: SyncedPackingConfig): LocalPackingConfigRecord {
  return { id: value.id, categoryAssignees: value.categoryAssignees, templates: value.templates, updated_at: value.updatedAt }
}

export interface SyncedPackingItem {
  schemaVersion: 1
  id: string
  tripId: string
  bagId: string | null
  name: string
  checked: number
  category: string | null
  sortOrder: number
  weightGrams: number | null
  quantity: number
  visibility: 'common' | 'personal' | 'shared'
  ownerId: number | null
  ownerName: string | null
  recipients: Array<{ userId: number; username: string }>
  contributors: Array<{ userId: number; username: string; status: string }>
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface SyncedPackingBag {
  schemaVersion: 1
  id: string
  tripId: string
  name: string
  color: string
  weightLimitGrams: number | null
  sortOrder: number
  userId: number | null
  assignedUsername: string | null
  members: Array<{ userId: number; username: string; avatar: string | null }>
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export function toSyncedPackingItem(value: LocalPackingItemRecord): SyncedPackingItem {
  const visibility = value.is_private ? ((value.recipients?.length ?? 0) > 0 ? 'shared' : 'personal') : 'common'
  return {
    schemaVersion: 1, id: value.sync_id, tripId: value.trip_sync_id, bagId: value.bag_sync_id,
    name: value.name, checked: Number(value.checked) ? 1 : 0, category: value.category ?? null,
    sortOrder: value.sort_order ?? 0, weightGrams: value.weight_grams ?? null, quantity: value.quantity ?? 1,
    visibility, ownerId: value.owner_id ?? null, ownerName: value.owner_username ?? null,
    recipients: (value.recipients ?? []).map(v => ({ userId: v.user_id, username: v.username })),
    contributors: (value.contributors ?? []).map(v => ({ userId: v.user_id, username: v.username, status: v.status })),
    createdAt: value.created_at, updatedAt: value.updated_at, deletedAt: value.deleted_at,
  }
}

export function applySyncedPackingItem(remote: SyncedPackingItem, localId: number, tripId: number, bagId: number | null): LocalPackingItemRecord {
  return {
    id: localId, sync_id: remote.id, trip_id: tripId, trip_sync_id: remote.tripId,
    bag_id: bagId, bag_sync_id: remote.bagId, name: remote.name, checked: remote.checked,
    category: remote.category, sort_order: remote.sortOrder, weight_grams: remote.weightGrams,
    quantity: remote.quantity, is_private: remote.visibility === 'common' ? 0 : 1,
    owner_id: remote.ownerId, owner_username: remote.ownerName,
    recipients: remote.recipients.map(v => ({ user_id: v.userId, username: v.username })),
    contributors: remote.contributors.map(v => ({ user_id: v.userId, username: v.username, status: v.status })),
    created_at: remote.createdAt, updated_at: remote.updatedAt, deleted_at: remote.deletedAt,
  }
}

export function toSyncedPackingBag(value: LocalPackingBagRecord): SyncedPackingBag {
  return {
    schemaVersion: 1, id: value.sync_id, tripId: value.trip_sync_id, name: value.name,
    color: value.color, weightLimitGrams: value.weight_limit_grams ?? null,
    sortOrder: value.sort_order ?? 0, userId: value.user_id ?? null,
    assignedUsername: value.assigned_username ?? null,
    members: (value.members ?? []).map(v => ({ userId: v.user_id, username: v.username, avatar: v.avatar ?? null })),
    createdAt: value.created_at ?? value.updated_at, updatedAt: value.updated_at, deletedAt: value.deleted_at,
  }
}

export function applySyncedPackingBag(remote: SyncedPackingBag, localId: number, tripId: number): LocalPackingBagRecord {
  return {
    id: localId, sync_id: remote.id, trip_id: tripId, trip_sync_id: remote.tripId,
    name: remote.name, color: remote.color, weight_limit_grams: remote.weightLimitGrams,
    sort_order: remote.sortOrder, user_id: remote.userId, assigned_username: remote.assignedUsername,
    members: remote.members.map(v => ({ user_id: v.userId, username: v.username, avatar: v.avatar })),
    created_at: remote.createdAt, updated_at: remote.updatedAt, deleted_at: remote.deletedAt,
  }
}
