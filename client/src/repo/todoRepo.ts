import type { TodoCreateItemRequest, TodoUpdateItemRequest } from '@trek/shared'
import { offlineDb } from '../db/offlineDb'
import type { LocalTodoRecord } from '../domain/todoSyncModel'
import { markLocalChange } from '../sync/localChangeRepository'
import type { TodoItem } from '../types'
import { randomId } from '../utils/randomId'

async function nextId(): Promise<number> {
  const first = await offlineDb.todoItems.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}

async function assigneeName(tripId: number, userId: number | null | undefined): Promise<string | null> {
  if (userId == null) return null
  return (await offlineDb.tripMembers.get([tripId, userId]))?.username ?? null
}

export const todoRepo = {
  async list(tripId: number | string): Promise<{ items: TodoItem[] }> {
    const rows = await offlineDb.todoItems.where('trip_id').equals(Number(tripId)).toArray() as LocalTodoRecord[]
    return { items: rows.filter(row => !row.deleted_at).sort((a, b) => a.sort_order - b.sort_order) }
  },

  async create(tripId: number | string, data: TodoCreateItemRequest): Promise<{ item: TodoItem }> {
    const localTripId = Number(tripId)
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.todoItems, offlineDb.tripMembers, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const trip = await offlineDb.trips.get(localTripId)
      if (!trip?.sync_id || trip.deleted_at) throw new Error('Trip not found in local database')
      const active = (await offlineDb.todoItems.where('trip_id').equals(localTripId).toArray() as LocalTodoRecord[]).filter(row => !row.deleted_at)
      const now = new Date().toISOString()
      const row: LocalTodoRecord = {
        id: await nextId(), sync_id: randomId(), trip_id: localTripId, trip_sync_id: trip.sync_id,
        name: data.name, category: data.category ?? null, checked: 0,
        sort_order: active.length, due_date: data.due_date ?? null,
        description: data.description ?? null, assigned_user_id: data.assigned_user_id ?? null,
        assigned_user_name: await assigneeName(localTripId, data.assigned_user_id), priority: data.priority ?? 0,
        created_at: now, updated_at: now, deleted_at: null,
      }
      await offlineDb.todoItems.put(row)
      await markLocalChange('todo', row.sync_id, 'upsert')
      return { item: row }
    })
  },

  async update(tripId: number | string, id: number, data: TodoUpdateItemRequest): Promise<{ item: TodoItem }> {
    const localTripId = Number(tripId)
    return offlineDb.transaction('rw', [offlineDb.todoItems, offlineDb.tripMembers, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const old = await offlineDb.todoItems.get(id) as LocalTodoRecord | undefined
      if (!old || old.deleted_at || old.trip_id !== localTripId) throw new Error('Todo not found in local database')
      const assignedUserId = data.assigned_user_id === undefined ? old.assigned_user_id : data.assigned_user_id
      const row: LocalTodoRecord = {
        ...old, ...data,
        checked: data.checked === undefined ? old.checked : Number(data.checked) ? 1 : 0,
        assigned_user_id: assignedUserId ?? null,
        assigned_user_name: data.assigned_user_id === undefined ? old.assigned_user_name : await assigneeName(localTripId, assignedUserId),
        priority: data.priority === null ? 0 : data.priority ?? old.priority,
        updated_at: new Date().toISOString(),
      }
      await offlineDb.todoItems.put(row)
      await markLocalChange('todo', row.sync_id, 'upsert')
      return { item: row }
    })
  },

  async delete(tripId: number | string, id: number): Promise<void> {
    await offlineDb.transaction('rw', [offlineDb.todoItems, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const row = await offlineDb.todoItems.get(id) as LocalTodoRecord | undefined
      if (!row || row.deleted_at || row.trip_id !== Number(tripId)) throw new Error('Todo not found in local database')
      const now = new Date().toISOString()
      await offlineDb.todoItems.put({ ...row, deleted_at: now, updated_at: now })
      await markLocalChange('todo', row.sync_id, 'delete')
    })
  },

  async reorder(tripId: number | string, orderedIds: number[]): Promise<{ items: TodoItem[] }> {
    const active = (await this.list(tripId)).items as LocalTodoRecord[]
    if (orderedIds.length !== active.length || new Set(orderedIds).size !== active.length || orderedIds.some(id => !active.some(row => row.id === id))) throw new Error('Todo reorder must contain every active item exactly once')
    await offlineDb.transaction('rw', [offlineDb.todoItems, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      for (const [sortOrder, id] of orderedIds.entries()) {
        const row = active.find(item => item.id === id)!
        await offlineDb.todoItems.put({ ...row, sort_order: sortOrder, updated_at: new Date().toISOString() })
        await markLocalChange('todo', row.sync_id, 'upsert')
      }
    })
    return this.list(tripId)
  },
}
