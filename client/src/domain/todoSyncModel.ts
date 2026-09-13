import type { TodoItem } from '../types'

export interface LocalTodoRecord extends TodoItem {
  sync_id: string
  trip_sync_id: string
  assigned_user_name?: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type StoredTodoRecord = TodoItem & Partial<Omit<LocalTodoRecord, keyof TodoItem>>

export interface SyncedTodo {
  schemaVersion: 1
  id: string
  tripId: string
  name: string
  category: string | null
  checked: number
  sortOrder: number
  dueDate: string | null
  description: string | null
  assignedUserId: number | null
  assignedUserName: string | null
  priority: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export function toSyncedTodo(value: LocalTodoRecord): SyncedTodo {
  return {
    schemaVersion: 1, id: value.sync_id, tripId: value.trip_sync_id, name: value.name,
    category: value.category ?? null, checked: Number(value.checked) ? 1 : 0,
    sortOrder: value.sort_order ?? 0, dueDate: value.due_date ?? null,
    description: value.description ?? null, assignedUserId: value.assigned_user_id ?? null,
    assignedUserName: value.assigned_user_name ?? null, priority: value.priority ?? 0,
    createdAt: value.created_at, updatedAt: value.updated_at, deletedAt: value.deleted_at,
  }
}

export function applySyncedTodo(remote: SyncedTodo, localId: number, tripId: number): LocalTodoRecord {
  return {
    id: localId, sync_id: remote.id, trip_id: tripId, trip_sync_id: remote.tripId,
    name: remote.name, category: remote.category, checked: remote.checked,
    sort_order: remote.sortOrder, due_date: remote.dueDate, description: remote.description,
    assigned_user_id: remote.assignedUserId, assigned_user_name: remote.assignedUserName,
    priority: remote.priority, created_at: remote.createdAt, updated_at: remote.updatedAt,
    deleted_at: remote.deletedAt,
  }
}
