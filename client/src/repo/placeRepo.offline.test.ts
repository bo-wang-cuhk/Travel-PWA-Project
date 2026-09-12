import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, offlineDb } from '../db/offlineDb'
import { assignmentRepo } from './assignmentRepo'
import { dayRepo } from './dayRepo'
import { placeRepo } from './placeRepo'
import { tripRepo } from './tripRepo'

beforeEach(async () => { await clearAll() })
afterEach(() => { vi.restoreAllMocks() })

async function seedTrip(): Promise<{ tripId: number; dayId: number }> {
  const { trip } = await tripRepo.create({ title: 'Barcelona', day_count: 1 })
  const day = (await dayRepo.list(trip.id)).days[0]
  return { tripId: trip.id, dayId: day.id }
}

describe('placeRepo local IndexedDB data source', () => {
  it('FE-REPO-PLACE-001: creates and lists a Place without fetch', async () => {
    const { tripId } = await seedTrip()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { place } = await placeRepo.create(tripId, { name: 'Sagrada Familia', lat: 41.4 })
    expect(place).toMatchObject({ trip_id: tripId, name: 'Sagrada Familia', deleted_at: null })
    expect(place.id).toBeLessThan(0)
    expect(place.sync_id).toMatch(/^[0-9a-f-]{36}$/i)
    expect((await placeRepo.list(tripId)).places).toHaveLength(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('FE-REPO-PLACE-002: updates locally and queues a provider-neutral change', async () => {
    const { tripId } = await seedTrip()
    const { place } = await placeRepo.create(tripId, { name: 'Old' })
    await offlineDb.syncOutbox.clear()
    const updated = await placeRepo.update(tripId, place.id, { name: 'New', notes: 'later' })
    expect(updated.place).toMatchObject({ name: 'New', notes: 'later' })
    expect(await offlineDb.syncOutbox.get(`place:${place.sync_id}`)).toMatchObject({ entityType: 'place', operation: 'upsert' })
    expect(await offlineDb.mutationQueue.count()).toBe(0)
  })

  it('FE-REPO-PLACE-003: rejects cross-Trip updates', async () => {
    const a = await seedTrip()
    const b = await seedTrip()
    const { place } = await placeRepo.create(a.tripId, { name: 'Local' })
    await expect(placeRepo.update(b.tripId, place.id, { name: 'Wrong' })).rejects.toThrow('Place not found')
  })

  it('FE-REPO-PLACE-004: delete writes a tombstone rather than removing the row', async () => {
    const { tripId } = await seedTrip()
    const { place } = await placeRepo.create(tripId, { name: 'Park Güell' })
    await placeRepo.delete(tripId, place.id)
    expect((await placeRepo.list(tripId)).places).toEqual([])
    expect((await offlineDb.places.get(place.id))?.deleted_at).toBeTruthy()
    expect(await offlineDb.syncOutbox.get(`place:${place.sync_id}`)).toMatchObject({ operation: 'delete' })
  })

  it('FE-REPO-PLACE-005: deleting a Place tombstones its Assignments', async () => {
    const { tripId, dayId } = await seedTrip()
    const { place } = await placeRepo.create(tripId, { name: 'Museum' })
    const { assignment } = await assignmentRepo.create(tripId, dayId, place.id)
    await placeRepo.delete(tripId, place.id)
    expect((await offlineDb.assignments.get(assignment.id))?.deleted_at).toBeTruthy()
    expect(await offlineDb.syncOutbox.get(`assignment:${(await offlineDb.assignments.get(assignment.id))?.sync_id}`)).toMatchObject({ operation: 'delete' })
  })

  it('FE-REPO-PLACE-006: bulk update and delete use the same local-first rules', async () => {
    const { tripId } = await seedTrip()
    const a = await placeRepo.create(tripId, { name: 'A' })
    const b = await placeRepo.create(tripId, { name: 'B' })
    expect(await placeRepo.updateMany(tripId, [a.place.id, b.place.id], { currency: 'JPY' })).toMatchObject({ count: 2 })
    expect((await placeRepo.list(tripId)).places.every(place => place.currency === 'JPY')).toBe(true)
    expect(await placeRepo.deleteMany(tripId, [a.place.id, b.place.id])).toMatchObject({ count: 2 })
    expect((await placeRepo.list(tripId)).places).toEqual([])
  })

  it('FE-REPO-PLACE-007: data survives reopening IndexedDB', async () => {
    const { tripId } = await seedTrip()
    const { place } = await placeRepo.create(tripId, { name: 'Persistent' })
    offlineDb.close()
    await offlineDb.open()
    expect((await placeRepo.get(place.id)).place.name).toBe('Persistent')
  })
})
