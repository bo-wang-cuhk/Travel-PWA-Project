import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, offlineDb } from '../db/offlineDb'
import { collectionRepo } from './collectionRepo'
import { placeRepo } from './placeRepo'
import { tripRepo } from './tripRepo'

beforeEach(async () => {
  await clearAll()
  localStorage.removeItem('trek_auth_snapshot')
})
afterEach(() => vi.restoreAllMocks())

describe('collectionRepo', () => {
  it('creates a collection and saves a trip place without a server request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { trip } = await tripRepo.create({ title: 'Kyoto', day_count: 1 })
    const { place } = await placeRepo.create(trip.id, { name: 'Kiyomizu-dera', lat: 34.9949, lng: 135.785 })
    const collection = await collectionRepo.create({ name: 'Temples' })

    const saved = await collectionRepo.saveFromTrip({ collection_id: collection.id, source_trip_id: trip.id, source_place_id: place.id })
    const detail = await collectionRepo.get(collection.id)
    const membership = await collectionRepo.membership({ name: place.name, lat: place.lat ?? undefined, lng: place.lng ?? undefined })
    const storedCollection = await offlineDb.collections.get(collection.id)

    expect(saved.place).toMatchObject({ collection_id: collection.id, source_place_id: place.id, status: 'idea' })
    expect(detail.places).toHaveLength(1)
    expect(membership).toMatchObject({ saved: true, lists: [expect.objectContaining({ collection_id: collection.id })] })
    expect(await offlineDb.syncOutbox.get(`collection:${storedCollection?.sync_id}`)).toMatchObject({ operation: 'upsert' })
    expect(await offlineDb.syncOutbox.get(`collectionPlace:${saved.place?.sync_id}`)).toMatchObject({ operation: 'upsert' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reports duplicates unless force is set, then creates another saved place', async () => {
    const collection = await collectionRepo.create({ name: 'Ideas' })
    const first = await collectionRepo.savePlace({ collection_id: collection.id, name: 'Museum', google_place_id: 'g-1' })
    const duplicate = await collectionRepo.savePlace({ collection_id: collection.id, name: 'Museum copy', google_place_id: 'g-1' })
    const forced = await collectionRepo.savePlace({ collection_id: collection.id, name: 'Museum copy', google_place_id: 'g-1', force: true })

    expect(first.place).toBeTruthy()
    expect(duplicate).toMatchObject({ duplicate: true })
    expect(forced.place?.id).not.toBe(first.place?.id)
    expect((await collectionRepo.get(collection.id)).places).toHaveLength(2)
  })

  it('reorders collections and persists saved-place ratings locally', async () => {
    const first = await collectionRepo.create({ name: 'First' })
    const second = await collectionRepo.create({ name: 'Second' })
    await collectionRepo.reorder([second.id, first.id])
    const saved = await collectionRepo.savePlace({ collection_id: second.id, name: 'Cafe' })
    const rated = await collectionRepo.ratePlace(saved.place!.id, 4)

    expect((await collectionRepo.list()).collections.map(row => row.id)).toEqual([second.id, first.id])
    expect(rated).toMatchObject({ rating_avg: 4, rating_count: 1 })
    expect(rated.ratings).toEqual([expect.objectContaining({ rating: 4 })])
  })

  it('previews trip imports with the same local duplicate verdict as saving', async () => {
    const { trip } = await tripRepo.create({ title: 'Import', day_count: 1 })
    const first = await placeRepo.create(trip.id, { name: 'Already saved' })
    const second = await placeRepo.create(trip.id, { name: 'New idea' })
    const collection = await collectionRepo.create({ name: 'Ideas' })
    await collectionRepo.saveFromTrip({ collection_id: collection.id, source_trip_id: trip.id, source_place_id: first.place.id })

    const preview = await collectionRepo.importable(collection.id, trip.id)

    expect(preview.places).toEqual(expect.arrayContaining([
      expect.objectContaining({ place_id: first.place.id, already_in_list: true }),
      expect.objectContaining({ place_id: second.place.id, already_in_list: false, scheduled: false }),
    ]))
  })
})
