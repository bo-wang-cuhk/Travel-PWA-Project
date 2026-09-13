import type { PackingCreateBagRequest, PackingCreateItemRequest, PackingUpdateBagRequest, PackingUpdateItemRequest, PackingVisibility } from '@trek/shared'
import { offlineDb } from '../db/offlineDb'
import type { LocalPackingBagRecord, LocalPackingConfigRecord, LocalPackingItemRecord } from '../domain/packingSyncModel'
import { markLocalChange } from '../sync/localChangeRepository'
import type { PackingBag, PackingItem } from '../types'
import { randomId } from '../utils/randomId'

async function nextItemId(): Promise<number> { const first = await offlineDb.packingItems.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }
async function nextBagId(): Promise<number> { const first = await offlineDb.packingBags.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }
function currentIdentity(): { userId: number; username: string } {
  try {
    const raw = localStorage.getItem('trek_auth_snapshot')
    const user = raw ? JSON.parse(raw)?.state?.user : null
    return { userId: Number(user?.id ?? 1), username: String(user?.username ?? 'Me') }
  } catch {
    return { userId: 1, username: 'Me' }
  }
}
async function readConfig(): Promise<LocalPackingConfigRecord> {
  return await offlineDb.packingConfig.get('personal-packing') ?? { id: 'personal-packing', categoryAssignees: {}, templates: [], updated_at: new Date(0).toISOString() }
}
async function writeConfig(value: LocalPackingConfigRecord): Promise<void> {
  const next = { ...value, updated_at: new Date().toISOString() }
  await offlineDb.transaction('rw', [offlineDb.packingConfig, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => { await offlineDb.packingConfig.put(next); await markLocalChange('packingConfig', next.id, 'upsert') })
}

export const packingRepo = {
  async list(tripId: number | string): Promise<{ items: PackingItem[] }> {
    const rows = await offlineDb.packingItems.where('trip_id').equals(Number(tripId)).toArray() as LocalPackingItemRecord[]
    return { items: rows.filter(row => !row.deleted_at).sort((a, b) => a.sort_order - b.sort_order) }
  },

  async create(tripId: number | string, data: PackingCreateItemRequest): Promise<{ item: PackingItem }> {
    const localTripId = Number(tripId)
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.packingItems, offlineDb.packingBags, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const trip = await offlineDb.trips.get(localTripId)
      if (!trip?.sync_id || trip.deleted_at) throw new Error('Trip not found in local database')
      const rows = (await offlineDb.packingItems.where('trip_id').equals(localTripId).toArray() as LocalPackingItemRecord[]).filter(v => !v.deleted_at)
      const now = new Date().toISOString()
      const visibility = data.visibility ?? (data.is_private ? 'personal' : 'common')
      const row: LocalPackingItemRecord = {
        id: await nextItemId(), sync_id: randomId(), trip_id: localTripId, trip_sync_id: trip.sync_id,
        bag_id: data.bag_id ?? null, bag_sync_id: data.bag_id == null ? null : (await offlineDb.packingBags.get(data.bag_id) as LocalPackingBagRecord | undefined)?.sync_id ?? null,
        name: data.name, checked: Number(data.checked) ? 1 : 0, category: data.category ?? null,
        sort_order: rows.length, weight_grams: data.weight_grams ?? null, quantity: data.quantity ?? 1,
        is_private: visibility === 'common' ? 0 : 1, owner_id: null, owner_username: null,
        recipients: (data.recipient_ids ?? []).map(userId => ({ user_id: userId, username: '' })), contributors: [],
        created_at: now, updated_at: now, deleted_at: null,
      }
      await offlineDb.packingItems.put(row); await markLocalChange('packingItem', row.sync_id, 'upsert'); return { item: row }
    })
  },

  async update(tripId: number | string, id: number, data: PackingUpdateItemRequest): Promise<{ item: PackingItem }> {
    return offlineDb.transaction('rw', [offlineDb.packingItems, offlineDb.packingBags, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const old = await offlineDb.packingItems.get(id) as LocalPackingItemRecord | undefined
      if (!old || old.deleted_at || old.trip_id !== Number(tripId)) throw new Error('Packing item not found in local database')
      const bagId = data.bag_id === undefined ? old.bag_id ?? null : data.bag_id
      const bag = bagId == null ? undefined : await offlineDb.packingBags.get(bagId) as LocalPackingBagRecord | undefined
      const row: LocalPackingItemRecord = { ...old, ...data, checked: data.checked === undefined ? old.checked : Number(data.checked) ? 1 : 0,
        is_private: data.is_private === undefined ? old.is_private : data.is_private ? 1 : 0,
        bag_id: bagId, bag_sync_id: bag?.sync_id ?? null, updated_at: new Date().toISOString() }
      await offlineDb.packingItems.put(row); await markLocalChange('packingItem', row.sync_id, 'upsert'); return { item: row }
    })
  },

  async delete(tripId: number | string, id: number): Promise<void> {
    await offlineDb.transaction('rw', [offlineDb.packingItems, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const row = await offlineDb.packingItems.get(id) as LocalPackingItemRecord | undefined
      if (!row || row.deleted_at || row.trip_id !== Number(tripId)) throw new Error('Packing item not found in local database')
      const now = new Date().toISOString(); await offlineDb.packingItems.put({ ...row, deleted_at: now, updated_at: now }); await markLocalChange('packingItem', row.sync_id, 'delete')
    })
  },

  async reorder(tripId: number | string, orderedIds: number[]): Promise<{ items: PackingItem[] }> {
    const active = (await this.list(tripId)).items as LocalPackingItemRecord[]
    if (orderedIds.length !== active.length || new Set(orderedIds).size !== active.length || orderedIds.some(id => !active.some(row => row.id === id))) throw new Error('Packing reorder must contain every active item exactly once')
    await offlineDb.transaction('rw', [offlineDb.packingItems, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      for (const [sort_order, id] of orderedIds.entries()) { const row = active.find(v => v.id === id)!; await offlineDb.packingItems.put({ ...row, sort_order, updated_at: new Date().toISOString() }); await markLocalChange('packingItem', row.sync_id, 'upsert') }
    }); return this.list(tripId)
  },

  async setSharing(tripId: number | string, id: number, data: { visibility: PackingVisibility; recipient_ids?: number[] }): Promise<{ item: PackingItem }> {
    const members = await offlineDb.tripMembers.where('tripId').equals(Number(tripId)).toArray()
    const names = new Map(members.map(v => [v.id, v.username]))
    const result = await this.update(tripId, id, { is_private: data.visibility !== 'common' })
    const row = result.item as LocalPackingItemRecord
    row.recipients = data.visibility === 'shared' ? (data.recipient_ids ?? []).map(user_id => ({ user_id, username: names.get(user_id) ?? '' })) : []
    row.updated_at = new Date().toISOString()
    await offlineDb.transaction('rw', [offlineDb.packingItems, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => { await offlineDb.packingItems.put(row); await markLocalChange('packingItem', row.sync_id, 'upsert') })
    return { item: row }
  },

  async clone(tripId: number | string, id: number): Promise<{ item: PackingItem }> {
    const old = await offlineDb.packingItems.get(id) as LocalPackingItemRecord | undefined
    if (!old || old.deleted_at) throw new Error('Packing item not found in local database')
    return this.create(tripId, { name: old.name, category: old.category ?? undefined, checked: old.checked, weight_grams: old.weight_grams ?? null, bag_id: old.bag_id ?? null, quantity: old.quantity ?? 1, visibility: 'personal' })
  },

  async addContributor(tripId: number | string, id: number): Promise<{ item: PackingItem }> {
    const row = await offlineDb.packingItems.get(id) as LocalPackingItemRecord | undefined
    if (!row || row.deleted_at || row.trip_id !== Number(tripId)) throw new Error('Packing item not found in local database')
    const identity = currentIdentity()
    const contributors = row.contributors ?? []
    if (contributors.some(value => value.user_id === identity.userId)) return { item: row }
    const next = {
      ...row,
      contributors: [...contributors, { user_id: identity.userId, username: identity.username, status: 'joined' }],
      updated_at: new Date().toISOString(),
    }
    await offlineDb.transaction('rw', [offlineDb.packingItems, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      await offlineDb.packingItems.put(next)
      await markLocalChange('packingItem', next.sync_id, 'upsert')
    })
    return { item: next }
  },
  async removeContributor(tripId: number | string, id: number, userId: number): Promise<{ item: PackingItem }> {
    const row = await offlineDb.packingItems.get(id) as LocalPackingItemRecord | undefined
    if (!row || row.trip_id !== Number(tripId)) throw new Error('Packing item not found in local database')
    const next = { ...row, contributors: (row.contributors ?? []).filter(v => v.user_id !== userId), updated_at: new Date().toISOString() }
    await offlineDb.transaction('rw', [offlineDb.packingItems, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => { await offlineDb.packingItems.put(next); await markLocalChange('packingItem', next.sync_id, 'upsert') }); return { item: next }
  },

  async bulkImport(tripId: number | string, items: Array<{ name: string; category?: string; quantity?: number }>): Promise<{ items: PackingItem[]; count: number }> {
    const created: PackingItem[] = []; for (const value of items) created.push((await this.create(tripId, value)).item); return { items: created, count: created.length }
  },

  async listBags(tripId: number | string): Promise<{ bags: PackingBag[]; unassigned_weight_grams: number }> {
    const rows = await offlineDb.packingBags.where('trip_id').equals(Number(tripId)).toArray() as LocalPackingBagRecord[]
    const items = (await this.list(tripId)).items
    return { bags: rows.filter(v => !v.deleted_at).sort((a, b) => a.sort_order - b.sort_order), unassigned_weight_grams: items.filter(v => v.bag_id == null).reduce((sum, v) => sum + (v.weight_grams ?? 0) * (v.quantity ?? 1), 0) }
  },
  async createBag(tripId: number | string, data: PackingCreateBagRequest): Promise<{ bag: PackingBag }> {
    const localTripId = Number(tripId); const trip = await offlineDb.trips.get(localTripId); if (!trip?.sync_id || trip.deleted_at) throw new Error('Trip not found in local database')
    const now = new Date().toISOString(); const bags = (await this.listBags(tripId)).bags
    const row: LocalPackingBagRecord = { id: await nextBagId(), sync_id: randomId(), trip_id: localTripId, trip_sync_id: trip.sync_id, name: data.name, color: data.color ?? '#64748b', weight_limit_grams: data.weight_limit_grams ?? null, sort_order: bags.length, user_id: null, members: [], created_at: now, updated_at: now, deleted_at: null }
    await offlineDb.transaction('rw', [offlineDb.packingBags, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => { await offlineDb.packingBags.put(row); await markLocalChange('packingBag', row.sync_id, 'upsert') }); return { bag: row }
  },
  async updateBag(tripId: number | string, id: number, data: PackingUpdateBagRequest): Promise<{ bag: PackingBag }> {
    const old = await offlineDb.packingBags.get(id) as LocalPackingBagRecord | undefined; if (!old || old.deleted_at || old.trip_id !== Number(tripId)) throw new Error('Packing bag not found in local database')
    const row = { ...old, ...data, updated_at: new Date().toISOString() }; await offlineDb.transaction('rw', [offlineDb.packingBags, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => { await offlineDb.packingBags.put(row); await markLocalChange('packingBag', row.sync_id, 'upsert') }); return { bag: row }
  },
  async deleteBag(tripId: number | string, id: number): Promise<void> {
    const bag = await offlineDb.packingBags.get(id) as LocalPackingBagRecord | undefined; if (!bag || bag.deleted_at || bag.trip_id !== Number(tripId)) throw new Error('Packing bag not found in local database')
    const now = new Date().toISOString(); await offlineDb.transaction('rw', [offlineDb.packingBags, offlineDb.packingItems, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      await offlineDb.packingBags.put({ ...bag, deleted_at: now, updated_at: now }); await markLocalChange('packingBag', bag.sync_id, 'delete')
      const items = await offlineDb.packingItems.where('bag_sync_id').equals(bag.sync_id).toArray() as LocalPackingItemRecord[]
      for (const item of items) { await offlineDb.packingItems.put({ ...item, bag_id: null, bag_sync_id: null, updated_at: now }); await markLocalChange('packingItem', item.sync_id, 'upsert') }
    })
  },
  async setBagMembers(tripId: number | string, id: number, userIds: number[]): Promise<{ bag: PackingBag; members: NonNullable<PackingBag['members']> }> {
    const members = await offlineDb.tripMembers.where('tripId').equals(Number(tripId)).toArray(); const wanted = new Set(userIds)
    const bag = await offlineDb.packingBags.get(id) as LocalPackingBagRecord | undefined; if (!bag) throw new Error('Packing bag not found in local database')
    const next = { ...bag, members: members.filter(v => wanted.has(v.id)).map(v => ({ user_id: v.id, username: v.username, avatar: v.avatar_url ?? null })), updated_at: new Date().toISOString() }
    await offlineDb.transaction('rw', [offlineDb.packingBags, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => { await offlineDb.packingBags.put(next); await markLocalChange('packingBag', next.sync_id, 'upsert') }); return { bag: next, members: next.members }
  },

  async getCategoryAssignees(tripId: number | string): Promise<{ assignees: Record<string, Array<{ user_id: number; username: string }>> }> { const trip = await offlineDb.trips.get(Number(tripId)); const config = await readConfig(); return { assignees: trip?.sync_id ? config.categoryAssignees[trip.sync_id] ?? {} : {} } },
  async setCategoryAssignees(tripId: number | string, category: string, userIds: number[]): Promise<{ assignees: Array<{ user_id: number; username: string }> }> { const trip = await offlineDb.trips.get(Number(tripId)); if (!trip?.sync_id) throw new Error('Trip not found in local database'); const config = await readConfig(); const values = { ...(config.categoryAssignees[trip.sync_id] ?? {}) }; const members = await offlineDb.tripMembers.where('tripId').equals(Number(tripId)).toArray(); const wanted = new Set(userIds); values[category] = members.filter(v => wanted.has(v.id)).map(v => ({ user_id: v.id, username: v.username })); config.categoryAssignees = { ...config.categoryAssignees, [trip.sync_id]: values }; await writeConfig(config); return { assignees: values[category] } },
  async listTemplates(): Promise<{ templates: Array<{ id: number; name: string; item_count: number }> }> { const config = await readConfig(); return { templates: config.templates.map(v => ({ id: v.id, name: v.name, item_count: v.items.length })) } },
  async saveAsTemplate(tripId: number | string, name: string): Promise<{ success: true }> { const config = await readConfig(); const items = (await this.list(tripId)).items; config.templates.push({ id: Math.min(0, ...config.templates.map(v => v.id)) - 1, syncId: randomId(), name, items: items.map(v => ({ name: v.name, category: v.category ?? undefined, quantity: v.quantity, weight_grams: v.weight_grams })) }); await writeConfig(config); return { success: true } },
  async applyTemplate(tripId: number | string, templateId: number, visibility: 'common' | 'personal' = 'common'): Promise<{ items: PackingItem[]; count: number }> { const config = await readConfig(); const template = config.templates.find(v => v.id === templateId); if (!template) throw new Error('Packing template not found in local database'); const created: PackingItem[] = []; for (const value of template.items) created.push((await this.create(tripId, { ...value, visibility })).item); return { items: created, count: created.length } },
}
