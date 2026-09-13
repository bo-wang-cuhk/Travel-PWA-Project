import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { clearAll, offlineDb } from '../db/offlineDb'
import { reservationRepo } from './reservationRepo'

beforeEach(async () => {
  await clearAll()
  await offlineDb.trips.put({ id: -1, sync_id: 'trip-a', name: 'Trip', start_date: '2026-01-01', end_date: '2026-01-02', created_at: 'x', updated_at: 'x', deleted_at: null } as never)
  await offlineDb.days.put({ id: -1, sync_id: 'day-a', trip_id: -1, trip_sync_id: 'trip-a', day_number: 1, date: '2026-01-01', created_at: 'x', updated_at: 'x', deleted_at: null } as never)
  await offlineDb.places.put({ id: -1, sync_id: 'place-a', trip_id: -1, trip_sync_id: 'trip-a', name: 'Hotel', created_at: 'x', updated_at: 'x', deleted_at: null } as never)
})

describe('reservationRepo local-first', () => {
  it('creates, updates and lists from IndexedDB', async () => {
    const created = await reservationRepo.create(-1, { title: 'Train', type: 'train', day_id: -1 })
    expect(created.reservation.id).toBeLessThan(0)
    expect((await offlineDb.syncOutbox.where('entityType').equals('reservation').count())).toBe(1)
    const updated = await reservationRepo.update(-1, created.reservation.id, { status: 'confirmed' })
    expect(updated.reservation.status).toBe('confirmed')
    expect((await reservationRepo.list(-1)).reservations.map(item => item.title)).toEqual(['Train'])
  })

  it('soft deletes and preserves a tombstone', async () => {
    const created = await reservationRepo.create(-1, { title: 'Flight', type: 'flight' })
    await reservationRepo.delete(-1, created.reservation.id)
    expect((await reservationRepo.list(-1)).reservations).toEqual([])
    expect((await offlineDb.reservations.get(created.reservation.id))!.deleted_at).toBeTruthy()
  })

  it('soft deleting a hotel Reservation also tombstones its linked Accommodation', async () => {
    const created = await reservationRepo.create(-1, {
      title: 'Hotel stay', type: 'hotel',
      create_accommodation: { place_id: -1, start_day_id: -1, end_day_id: -1 },
    } as never)
    const accommodationId = Number(created.reservation.accommodation_id)
    await reservationRepo.delete(-1, created.reservation.id)
    expect((await offlineDb.accommodations.get(accommodationId))?.deleted_at).toBeTruthy()
  })

  it('stores per-Day positions locally', async () => {
    const created = await reservationRepo.create(-1, { title: 'Bus', type: 'bus', day_id: -1 })
    await reservationRepo.updatePositions(-1, [{ id: created.reservation.id, day_plan_position: 2.5 }], -1)
    expect((await offlineDb.reservations.get(created.reservation.id))!.day_positions).toEqual({ '-1': 2.5 })
  })

  it('creates a linked Accommodation for a hotel in the same local workflow', async () => {
    const created = await reservationRepo.create(-1, { title: 'Hotel', type: 'hotel', create_accommodation: { place_id: -1, start_day_id: -1, end_day_id: -1 } } as never)
    expect(created.reservation.accommodation_id).toBeLessThan(0)
    expect(await offlineDb.accommodations.count()).toBe(1)
    expect(await offlineDb.syncOutbox.get(`reservation:${(await offlineDb.reservations.get(created.reservation.id))!.sync_id}`)).toBeDefined()
  })

  it('creates and later tombstones a linked Expense in the same local workflow', async () => {
    const created = await reservationRepo.create(-1, { title: 'Dinner', type: 'restaurant', create_budget_entry: { total_price: 45, category: 'food' } } as never)
    const budget = (await offlineDb.budgetItems.toArray())[0]
    expect(budget).toMatchObject({ reservation_id: created.reservation.id, name: 'Dinner', total_price: 45, category: 'food', deleted_at: null })
    await reservationRepo.delete(-1, created.reservation.id)
    expect((await offlineDb.budgetItems.get(budget.id))?.deleted_at).toBeTruthy()
    expect(await offlineDb.syncOutbox.get(`budgetItem:${budget.sync_id}`)).toMatchObject({ operation: 'delete' })
  })
})
