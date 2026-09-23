import type {
  Collection, CollectionCreateRequest, CollectionDetailResponse, CollectionListResponse,
  CollectionMembership, CollectionPlace, CollectionPlaceUpdateRequest, CollectionSavePlaceRequest,
  CollectionSaveResult, CollectionStatus, CollectionUpdateRequest,
} from '@trek/shared'
import { offlineDb } from '../db/offlineDb'
import type { LocalCollectionPlaceRecord, LocalCollectionRecord } from '../domain/collectionSyncModel'
import { markLocalChange } from '../sync/localChangeRepository'
import { randomId } from '../utils/randomId'
import { placeRepo } from './placeRepo'

let queue: Promise<void> = Promise.resolve()
function serialize<T>(task: () => Promise<T>): Promise<T> { const result = queue.then(task, task); queue = result.then(() => undefined, () => undefined); return result }
async function nextCollectionId(): Promise<number> { const first = await offlineDb.collections.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }
async function nextPlaceId(): Promise<number> { const first = await offlineDb.collectionPlaces.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }
function user() { try { const raw = localStorage.getItem('trek_auth_snapshot'); const u = raw ? JSON.parse(raw)?.state?.user : null; return { id: Number(u?.id ?? 0), username: String(u?.display_name || u?.username || '旅行者'), avatar: u?.avatar_url ?? null } } catch { return { id: 0, username: '旅行者', avatar: null } } }
function samePlace(a: { google_place_id?: string | null; google_ftid?: string | null; osm_id?: string | null; name: string; lat?: number | null; lng?: number | null }, b: { google_place_id?: string | null; google_ftid?: string | null; osm_id?: string | null; name: string; lat?: number | null; lng?: number | null }): boolean {
  if (a.google_place_id && b.google_place_id) return a.google_place_id === b.google_place_id
  if (a.google_ftid && b.google_ftid) return a.google_ftid === b.google_ftid
  if (a.osm_id && b.osm_id) return a.osm_id === b.osm_id
  if (a.name.trim().toLowerCase() === b.name.trim().toLowerCase()) return true
  return a.lat != null && a.lng != null && b.lat != null && b.lng != null && Math.abs(a.lat - b.lat) < 0.0001 && Math.abs(a.lng - b.lng) < 0.0001
}
async function activeCollections(): Promise<LocalCollectionRecord[]> { return (await offlineDb.collections.toArray()).filter(row => !row.deleted_at) }
async function activePlaces(collectionId?: number): Promise<LocalCollectionPlaceRecord[]> {
  const rows = collectionId == null ? await offlineDb.collectionPlaces.toArray() : await offlineDb.collectionPlaces.where('collection_id').equals(collectionId).toArray()
  return rows.filter(row => !row.deleted_at)
}
async function touchCollection(id: number): Promise<void> {
  const row = await offlineDb.collections.get(id)
  if (!row?.sync_id) return
  const updated = { ...row, updated_at: new Date().toISOString() }
  await offlineDb.collections.put(updated)
  await markLocalChange('collection', row.sync_id, 'upsert')
}

export const collectionRepo = {
  async list(): Promise<CollectionListResponse> {
    const collections = await activeCollections()
    const places = await activePlaces()
    return { collections: collections.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(row => ({ ...row, place_count: places.filter(p => p.collection_id === row.id).length, is_owner: true })), incomingInvites: [] }
  },
  async get(id: number): Promise<CollectionDetailResponse> {
    const collection = await offlineDb.collections.get(id)
    if (!collection || collection.deleted_at) throw new Error('Collection not found')
    return { collection: { ...collection, is_owner: true }, places: await activePlaces(id) }
  },
  async create(body: CollectionCreateRequest): Promise<Collection> {
    return serialize(() => offlineDb.transaction('rw', [offlineDb.collections, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const now = new Date().toISOString(); const rows = await activeCollections()
      const row: LocalCollectionRecord = { id: await nextCollectionId(), sync_id: randomId(), owner_id: user().id, name: body.name, description: body.description ?? null, color: body.color ?? '#6366f1', icon: body.icon ?? 'Bookmark', cover_image: body.cover_image ?? null, links: body.links ?? [], sort_order: rows.length, is_owner: true, members: [], labels: [], created_at: now, updated_at: now, deleted_at: null }
      await offlineDb.collections.add(row); await markLocalChange('collection', row.sync_id, 'upsert'); return row
    }))
  },
  async update(id: number, body: CollectionUpdateRequest): Promise<Collection> {
    return serialize(() => offlineDb.transaction('rw', [offlineDb.collections, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const row = await offlineDb.collections.get(id); if (!row?.sync_id || row.deleted_at) throw new Error('Collection not found')
      const next = { ...row, ...body, updated_at: new Date().toISOString() }; await offlineDb.collections.put(next); await markLocalChange('collection', row.sync_id, 'upsert'); return next
    }))
  },
  async remove(id: number): Promise<{ success: true }> {
    return serialize(() => offlineDb.transaction('rw', [offlineDb.collections, offlineDb.collectionPlaces, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const row = await offlineDb.collections.get(id); if (!row?.sync_id || row.deleted_at) return { success: true as const }; const now = new Date().toISOString()
      await offlineDb.collections.put({ ...row, deleted_at: now, updated_at: now }); await markLocalChange('collection', row.sync_id, 'delete')
      for (const place of await activePlaces(id)) { await offlineDb.collectionPlaces.put({ ...place, deleted_at: now, updated_at: now }); await markLocalChange('collectionPlace', place.sync_id, 'delete') }
      return { success: true as const }
    }))
  },
  async reorder(ids: number[]): Promise<{ success: true }> {
    return serialize(() => offlineDb.transaction('rw', [offlineDb.collections, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const now = new Date().toISOString()
      for (let index = 0; index < ids.length; index++) {
        const row = await offlineDb.collections.get(ids[index])
        if (!row?.sync_id || row.deleted_at) continue
        await offlineDb.collections.put({ ...row, sort_order: index, updated_at: now })
        await markLocalChange('collection', row.sync_id, 'upsert')
      }
      return { success: true as const }
    }))
  },
  async savePlace(body: CollectionSavePlaceRequest): Promise<CollectionSaveResult> {
    return serialize(() => offlineDb.transaction('rw', [offlineDb.collections, offlineDb.collectionPlaces, offlineDb.trips, offlineDb.places, offlineDb.categories, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const collection = await offlineDb.collections.get(body.collection_id); if (!collection?.sync_id || collection.deleted_at) throw new Error('Collection not found')
      const duplicate = (await activePlaces(body.collection_id)).find(place => samePlace(place, body))
      if (duplicate && !body.force) return { duplicate: true, duplicateOf: { id: duplicate.id, name: duplicate.name } }
      const now = new Date().toISOString(); const me = user()
      const source = body as CollectionSavePlaceRequest & Pick<CollectionPlace, 'category' | 'tags'>
      const [sourceTrip, sourcePlace, category] = await Promise.all([
        body.source_trip_id == null ? undefined : offlineDb.trips.get(body.source_trip_id),
        body.source_place_id == null ? undefined : offlineDb.places.get(body.source_place_id),
        body.category_id == null ? undefined : offlineDb.categories.get(body.category_id),
      ])
      const place: LocalCollectionPlaceRecord = {
        id: await nextPlaceId(), sync_id: randomId(), collection_id: collection.id, collection_sync_id: collection.sync_id,
        owner_id: collection.owner_id, saved_by: me.id, name: body.name, description: body.description ?? null,
        lat: body.lat ?? null, lng: body.lng ?? null, address: body.address ?? null, category_id: body.category_id ?? null,
        price: body.price ?? null, currency: body.currency ?? null, notes: body.notes ?? null, image_url: body.image_url ?? null,
        google_place_id: body.google_place_id ?? null, google_ftid: body.google_ftid ?? null, osm_id: body.osm_id ?? null,
        website: body.website ?? null, phone: body.phone ?? null, status: body.status ?? 'idea',
        source_trip_id: body.source_trip_id ?? null, source_trip_sync_id: sourceTrip?.sync_id ?? null,
        source_place_id: body.source_place_id ?? null, source_place_sync_id: sourcePlace?.sync_id ?? null,
        category_sync_id: category?.sync_id ?? null,
        links: body.links ?? [], category: source.category, tags: source.tags ?? [], label_ids: [],
        sort_order: (await activePlaces(collection.id)).length, ratings: [], rating_avg: null, rating_count: 0,
        created_at: now, updated_at: now, deleted_at: null,
      }
      await offlineDb.collectionPlaces.add(place); await markLocalChange('collectionPlace', place.sync_id, 'upsert'); await touchCollection(collection.id); return { place }
    }))
  },
  async saveFromTrip(body: { collection_id: number; source_trip_id: number; source_place_id: number; force?: boolean }) { const source = (await placeRepo.get(body.source_place_id)).place; return this.savePlace({ ...source, collection_id: body.collection_id, source_trip_id: body.source_trip_id, source_place_id: body.source_place_id, force: body.force }) },
  async saveFromTripMany(collectionId: number, tripId: number, ids: number[], force?: boolean) { let copied = 0; const skipped: { id: number; name: string }[] = []; for (const id of ids) { const source = (await placeRepo.get(id)).place; const result = await this.savePlace({ ...source, collection_id: collectionId, source_trip_id: tripId, source_place_id: id, force }); if (result.place) copied++; else skipped.push({ id, name: source.name }) } return { copied, skipped } },
  async importable(collectionId: number, tripId: number) {
    const [places, saved, assignments, days] = await Promise.all([
      placeRepo.list(tripId).then(result => result.places),
      activePlaces(collectionId),
      offlineDb.assignments.where('trip_id').equals(tripId).toArray(),
      offlineDb.days.where('trip_id').equals(tripId).toArray(),
    ])
    const dayById = new Map(days.filter(day => !day.deleted_at).map(day => [day.id, day]))
    return {
      places: places.map(place => {
        const assignment = assignments.find(item => !item.deleted_at && item.place_id === place.id)
        const day = assignment ? dayById.get(assignment.day_id) : undefined
        return {
          place_id: place.id,
          name: place.name,
          address: place.address ?? null,
          lat: place.lat ?? null,
          lng: place.lng ?? null,
          category_id: place.category_id ?? null,
          image_url: place.image_url ?? null,
          already_in_list: saved.some(item => samePlace(item, place)),
          scheduled: Boolean(day),
          day_number: day?.day_number ?? null,
          date: day?.date ?? null,
        }
      }),
    }
  },
  async updatePlace(id: number, body: CollectionPlaceUpdateRequest): Promise<CollectionPlace> { return serialize(() => offlineDb.transaction('rw', [offlineDb.collectionPlaces, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => { const row = await offlineDb.collectionPlaces.get(id); if (!row?.sync_id || row.deleted_at) throw new Error('Saved place not found'); const next = { ...row, ...body, updated_at: new Date().toISOString() }; await offlineDb.collectionPlaces.put(next); await markLocalChange('collectionPlace', row.sync_id, 'upsert'); return next })) },
  async setStatus(id: number, status: CollectionStatus) { return this.updatePlace(id, { status }) },
  async setStatusMany(ids: number[], status: CollectionStatus) { for (const id of ids) await this.setStatus(id, status); return { updated: ids.length } },
  async setStatusFromTrip(tripId: number, ids: number[], status: CollectionStatus) { const rows = (await activePlaces()).filter(row => row.source_trip_id === tripId && row.source_place_id != null && ids.includes(row.source_place_id)); await this.setStatusMany(rows.map(row => row.id), status); return { updated: rows.length, places: new Set(rows.map(row => row.source_place_id)).size } },
  async ratePlace(id: number, rating: number | null) { const row = await offlineDb.collectionPlaces.get(id); if (!row) throw new Error('Saved place not found'); const me = user(); const ratings = (row.ratings ?? []).filter(v => v.user_id !== me.id); if (rating != null) ratings.push({ user_id: me.id, username: me.username, avatar: me.avatar, rating }); return this.updatePlace(id, { ratings, rating_avg: ratings.length ? ratings.reduce((sum, v) => sum + v.rating, 0) / ratings.length : null, rating_count: ratings.length } as CollectionPlaceUpdateRequest) },
  async deletePlace(id: number) { return serialize(() => offlineDb.transaction('rw', [offlineDb.collectionPlaces, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => { const row = await offlineDb.collectionPlaces.get(id); if (!row?.sync_id || row.deleted_at) return { success: true }; const now = new Date().toISOString(); await offlineDb.collectionPlaces.put({ ...row, deleted_at: now, updated_at: now }); await markLocalChange('collectionPlace', row.sync_id, 'delete'); return { success: true } })) },
  async deleteMany(ids: number[]) { for (const id of ids) await this.deletePlace(id); return { success: true } },
  async membership(query: { google_place_id?: string; google_ftid?: string; name?: string; lat?: number; lng?: number }): Promise<CollectionMembership> { const lists = await activeCollections(); const matches = (await activePlaces()).filter(place => samePlace(place, { ...query, name: query.name || '' })); return { saved: matches.length > 0, lists: matches.map(place => ({ collection_id: place.collection_id, name: lists.find(list => list.id === place.collection_id)?.name || '', place_id: place.id, status: place.status, can_edit: true })) } },
  async copyToTrip(body: { trip_id: number; place_ids: number[]; force?: boolean }) { let copied = 0; const skipped: { id: number; name: string }[] = []; for (const id of body.place_ids) { const row = await offlineDb.collectionPlaces.get(id); if (!row || row.deleted_at) continue; const existing = (await placeRepo.list(body.trip_id)).places.find(place => samePlace(place, row)); if (existing && !body.force) { skipped.push({ id, name: row.name }); continue } await placeRepo.create(body.trip_id, { ...row, name: row.name }); copied++ } return { copied, skipped } },
}
