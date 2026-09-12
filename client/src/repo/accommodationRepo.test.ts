import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { clearAll, offlineDb } from '../db/offlineDb'
import { accommodationRepo } from './accommodationRepo'

async function seed() {
  await offlineDb.trips.put({ id: -1, sync_id: 'trip-a', name: 'Trip', start_date: '2026-01-01', end_date: '2026-01-02', created_at: '2026-01-01', updated_at: '2026-01-01', deleted_at: null } as never)
  await offlineDb.days.bulkPut([
    { id: -1, sync_id: 'day-a', trip_id: -1, trip_sync_id: 'trip-a', day_number: 1, date: '2026-01-01', created_at: 'x', updated_at: 'x', deleted_at: null },
    { id: -2, sync_id: 'day-b', trip_id: -1, trip_sync_id: 'trip-a', day_number: 2, date: '2026-01-02', created_at: 'x', updated_at: 'x', deleted_at: null },
  ] as never)
  await offlineDb.places.put({ id: -1, sync_id: 'place-a', trip_id: -1, trip_sync_id: 'trip-a', name: 'Hotel', address: 'Main St', created_at: 'x', updated_at: 'x', deleted_at: null } as never)
}

beforeEach(async () => { await clearAll(); await seed() })

describe('accommodationRepo local-first', () => {
  it('creates, projects and updates a stay without fetch', async () => {
    const created = await accommodationRepo.create(-1, { place_id: -1, start_day_id: -1, end_day_id: -2, check_in: '15:00' })
    expect(created.accommodation.place_name).toBe('Hotel')
    expect((await offlineDb.syncOutbox.where('entityType').equals('accommodation').count())).toBe(1)
    const updated = await accommodationRepo.update(-1, created.accommodation.id, { confirmation: 'ABC' })
    expect(updated.accommodation.confirmation).toBe('ABC')
    expect((await accommodationRepo.list(-1)).accommodations).toHaveLength(1)
  })

  it('soft deletes and unlinks a Reservation', async () => {
    const created = await accommodationRepo.create(-1, { place_id: -1, start_day_id: -1, end_day_id: -2 })
    const stored = await offlineDb.accommodations.get(created.accommodation.id)
    await offlineDb.reservations.put({ id: -1, sync_id: 'res-a', trip_id: -1, trip_sync_id: 'trip-a', accommodation_id: stored!.id, accommodation_sync_id: stored!.sync_id, title: 'Hotel', status: 'confirmed', type: 'hotel', created_at: 'x', updated_at: 'x', deleted_at: null } as never)
    await accommodationRepo.delete(-1, stored!.id)
    expect((await offlineDb.accommodations.get(stored!.id))!.deleted_at).toBeTruthy()
    expect((await offlineDb.reservations.get(-1))!.accommodation_id).toBeNull()
  })
})
