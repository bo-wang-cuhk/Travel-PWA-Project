import { offlineDb } from '../db/offlineDb'
import type { LocalCategoryRecord } from '../domain/categorySyncModel'
import { markLocalChange } from '../sync/localChangeRepository'
import type { Category } from '../types'
import { randomId } from '../utils/randomId'

let mutationQueue: Promise<void> = Promise.resolve()

function serialize<T>(mutation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(mutation, mutation)
  mutationQueue = result.then(() => undefined, () => undefined)
  return result
}

async function nextId(): Promise<number> {
  const first = await offlineDb.categories.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}

function active(row: { deleted_at?: string | null }): boolean { return !row.deleted_at }

export const categoryRepo = {
  async list(): Promise<{ categories: Category[] }> {
    return { categories: (await offlineDb.categories.toArray()).filter(active) }
  },

  async create(data: Partial<Category> & { name: string }): Promise<{ category: LocalCategoryRecord }> {
    return serialize(() => offlineDb.transaction('rw', [offlineDb.categories, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const now = new Date().toISOString()
      const category: LocalCategoryRecord = {
        id: await nextId(),
        sync_id: randomId(),
        name: data.name.trim(),
        color: data.color || '#6366f1',
        icon: data.icon || 'MapPin',
        user_id: data.user_id ?? null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      }
      await offlineDb.categories.add(category)
      await markLocalChange('category', category.sync_id, 'upsert')
      return { category }
    }))
  },

  async update(id: number, data: Partial<Category>): Promise<{ category: LocalCategoryRecord }> {
    return serialize(() => offlineDb.transaction('rw', [offlineDb.categories, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const current = await offlineDb.categories.get(id) as LocalCategoryRecord | undefined
      if (!current || current.deleted_at) throw new Error('Category not found')
      const category = { ...current, ...data, id: current.id, sync_id: current.sync_id, updated_at: new Date().toISOString() }
      await offlineDb.categories.put(category)
      await markLocalChange('category', category.sync_id, 'upsert')
      return { category }
    }))
  },

  async delete(id: number): Promise<{ success: true }> {
    return serialize(() => offlineDb.transaction('rw', [offlineDb.categories, offlineDb.places, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const current = await offlineDb.categories.get(id) as LocalCategoryRecord | undefined
      if (!current || current.deleted_at) return { success: true as const }
      const now = new Date().toISOString()
      await offlineDb.categories.put({ ...current, updated_at: now, deleted_at: now })
      const places = await offlineDb.places.filter(place => place.category_id === id).toArray()
      for (const place of places) {
        if (!place.sync_id || place.deleted_at) continue
        await offlineDb.places.put({ ...place, category_id: null, category_sync_id: null, category: null, updated_at: now })
        await markLocalChange('place', place.sync_id, 'upsert')
      }
      await markLocalChange('category', current.sync_id, 'delete')
      return { success: true as const }
    }))
  },
}
