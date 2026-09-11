// FE-REPO-TRIP-001 to FE-REPO-TRIP-010
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { offlineDb, clearAll } from '../db/offlineDb'
import { ensureDevelopmentSeed, tripRepo } from './tripRepo'
import { buildDay, buildTrip } from '../../tests/helpers/factories'

beforeEach(async () => {
  await clearAll()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tripRepo local IndexedDB data source', () => {
  it('FE-REPO-TRIP-001: lists active and archived trips without calling fetch', async () => {
    await offlineDb.trips.bulkPut([
      buildTrip({ id: 71, is_archived: 0 }),
      buildTrip({ id: 72, is_archived: 1 }),
    ])
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const result = await tripRepo.list()

    expect(result.trips.map(t => t.id)).toEqual([71])
    expect(result.archivedTrips.map(t => t.id)).toEqual([72])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('FE-REPO-TRIP-002: reads a detail directly from IndexedDB', async () => {
    await offlineDb.trips.put(buildTrip({ id: 80, title: 'Kyoto' }))
    await expect(tripRepo.get(80)).resolves.toMatchObject({ trip: { title: 'Kyoto' } })
  })

  it('FE-REPO-TRIP-003: reports a local cache miss', async () => {
    await expect(tripRepo.get(999)).rejects.toThrow('Trip not found in local database')
  })

  it('FE-REPO-TRIP-004: creates a complete Trip using a collision-safe local id', async () => {
    await offlineDb.trips.put(buildTrip({ id: -3 }))
    const result = await tripRepo.create({
      title: 'Iceland',
      start_date: '2027-12-01',
      end_date: '2027-12-05',
      currency: 'ISK',
    }, { id: 42, username: 'traveler' })

    expect(result.trip).toMatchObject({
      id: -4,
      user_id: 42,
      owner_username: 'traveler',
      title: 'Iceland',
      currency: 'ISK',
      day_count: 5,
      is_owner: 1,
      is_archived: 0,
      deleted_at: null,
    })
    expect(result.trip.sync_id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(await offlineDb.trips.get(-4)).toEqual(result.trip)
    expect(await offlineDb.syncOutbox.get(`trip:${result.trip.sync_id}`)).toMatchObject({ operation: 'upsert', status: 'pending' })
  })

  it('FE-REPO-TRIP-005: updates only supplied fields and persists them', async () => {
    await offlineDb.trips.put(buildTrip({ id: -1, title: 'Before', currency: 'EUR' }))
    const { trip } = await tripRepo.update(-1, { title: 'After', currency: 'JPY' })

    expect(trip.title).toBe('After')
    expect(trip.currency).toBe('JPY')
    expect(trip.description).toBeNull()
    expect((await offlineDb.trips.get(-1))?.title).toBe('After')
  })

  it('FE-REPO-TRIP-006: archive and unarchive persist the numeric model field', async () => {
    await offlineDb.trips.put(buildTrip({ id: -1, is_archived: 0 }))
    expect((await tripRepo.archive(-1)).trip.is_archived).toBe(1)
    expect((await tripRepo.unarchive(-1)).trip.is_archived).toBe(0)
    expect((await offlineDb.trips.get(-1))?.is_archived).toBe(0)
  })

  it('FE-REPO-TRIP-007: delete writes a tombstone and queues it without destroying related data', async () => {
    await offlineDb.trips.put(buildTrip({ id: -1 }))
    await offlineDb.days.put(buildDay({ id: 5, trip_id: -1 }))
    await tripRepo.delete(-1)

    const deleted = await offlineDb.trips.get(-1)
    expect(deleted?.deleted_at).toBeTruthy()
    expect(await offlineDb.days.where('trip_id').equals(-1).count()).toBe(1)
    expect(await offlineDb.syncOutbox.get(`trip:${deleted!.sync_id}`)).toMatchObject({ operation: 'delete', status: 'pending' })
    expect((await tripRepo.list()).trips).toEqual([])
  })

  it('FE-REPO-TRIP-008: data survives closing and reopening the database', async () => {
    const { trip } = await tripRepo.create({ title: 'Persistent trip' })
    offlineDb.close()
    await offlineDb.open()
    expect((await tripRepo.get(trip.id)).trip.title).toBe('Persistent trip')
  })

  it('FE-REPO-TRIP-009: picks the active trip entirely from local rows', async () => {
    await offlineDb.trips.bulkPut([
      buildTrip({ id: 91, start_date: '2020-01-01', end_date: '2020-01-02' }),
      buildTrip({ id: 92, start_date: '2099-01-01', end_date: '2099-01-02' }),
    ])
    expect((await tripRepo.active()).trip?.id).toBe(92)
  })

  it('FE-REPO-TRIP-010: seeds Japan 2026 only once in an empty database', async () => {
    await ensureDevelopmentSeed()
    expect((await offlineDb.trips.toArray()).map(t => t.title)).toEqual(['Japan 2026'])

    await offlineDb.trips.clear()
    await ensureDevelopmentSeed()
    expect(await offlineDb.trips.count()).toBe(0)
  })
})
