import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, offlineDb } from '../db/offlineDb'
import { categoryRepo } from './categoryRepo'
import { placeRepo } from './placeRepo'
import { tripRepo } from './tripRepo'

beforeEach(async () => {
  await clearAll()
})
afterEach(() => vi.restoreAllMocks())

describe('categoryRepo', () => {
  it('creates categories locally and assigns their stable identity to places', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { category } = await categoryRepo.create({ name: ' Museums ', color: '#123456', icon: 'Landmark' })
    const { trip } = await tripRepo.create({ title: 'Paris', day_count: 1 })
    const { place } = await placeRepo.create(trip.id, { name: 'Louvre', category_id: category.id })

    expect(category).toMatchObject({ id: -1, name: 'Museums', color: '#123456', icon: 'Landmark' })
    expect(place).toMatchObject({ category_id: category.id, category_sync_id: category.sync_id })
    expect(place.category).toMatchObject({ id: category.id, name: 'Museums' })
    expect(await offlineDb.syncOutbox.get(`category:${category.sync_id}`)).toMatchObject({ operation: 'upsert' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('soft-deletes a category and clears it from linked places', async () => {
    const { category } = await categoryRepo.create({ name: 'Food' })
    const { trip } = await tripRepo.create({ title: 'Tokyo', day_count: 1 })
    const { place } = await placeRepo.create(trip.id, { name: 'Market', category_id: category.id })

    await categoryRepo.delete(category.id)

    expect((await categoryRepo.list()).categories).toEqual([])
    expect(await offlineDb.categories.get(category.id)).toMatchObject({ deleted_at: expect.any(String) })
    expect(await offlineDb.places.get(place.id)).toMatchObject({ category_id: null, category_sync_id: null, category: null })
    expect(await offlineDb.syncOutbox.get(`category:${category.sync_id}`)).toMatchObject({ operation: 'delete' })
  })
})
