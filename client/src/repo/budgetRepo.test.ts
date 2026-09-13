import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { clearAll, offlineDb } from '../db/offlineDb'
import { budgetRepo } from './budgetRepo'

beforeEach(async () => {
  await clearAll()
  await offlineDb.trips.put({ id: -1, sync_id: 'trip-a', name: 'Trip', start_date: '2026-01-01', end_date: '2026-01-02', created_at: 'x', updated_at: 'x', deleted_at: null } as never)
  await offlineDb.places.put({ id: -1, sync_id: 'place-a', trip_id: -1, trip_sync_id: 'trip-a', name: 'Cafe', created_at: 'x', updated_at: 'x', deleted_at: null } as never)
  await offlineDb.reservations.put({ id: -1, sync_id: 'reservation-a', trip_id: -1, trip_sync_id: 'trip-a', title: 'Dinner', type: 'restaurant', metadata: '{}', created_at: 'x', updated_at: 'x', deleted_at: null } as never)
  await offlineDb.tripMembers.bulkPut([{ tripId: -1, id: 1, username: 'alice' }, { tripId: -1, id: 2, username: 'bob' }] as never)
})

describe('budgetRepo local-first', () => {
  it('creates and lists an expense without a network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const result = await budgetRepo.create(-1, { name: 'Dinner', category: 'food', total_price: 80, place_id: -1, member_ids: [1, 2] })
    expect(result.item.id).toBeLessThan(0)
    expect(result.item.members?.map(member => member.username)).toEqual(['alice', 'bob'])
    expect((await budgetRepo.list(-1)).items.map(item => item.name)).toEqual(['Dinner'])
    expect(await offlineDb.syncOutbox.get(`budgetItem:${(await offlineDb.budgetItems.get(result.item.id))!.sync_id}`)).toBeDefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('persists payer totals, member state, and linked Reservation metadata', async () => {
    const created = await budgetRepo.create(-1, { name: 'Dinner', reservation_id: -1, total_price: 10, member_ids: [1] })
    const updated = await budgetRepo.update(-1, created.item.id, { payers: [{ user_id: 1, amount: 12.5 }, { user_id: 2, amount: 7.5 }] })
    expect(updated.item.total_price).toBe(20)
    await budgetRepo.togglePaid(-1, created.item.id, 1, true)
    expect((await offlineDb.budgetItems.get(created.item.id))!.members?.[0].paid).toBe(1)
    await budgetRepo.update(-1, created.item.id, { total_price: 25 })
    expect(JSON.parse(String((await offlineDb.reservations.get(-1))!.metadata)).price).toBe('25')
  })

  it('soft deletes, hides the row, and clears linked Reservation price metadata', async () => {
    const created = await budgetRepo.create(-1, { name: 'Dinner', reservation_id: -1, total_price: 25 })
    await budgetRepo.update(-1, created.item.id, { total_price: 25 })
    await budgetRepo.delete(-1, created.item.id)
    expect((await budgetRepo.list(-1)).items).toEqual([])
    expect((await offlineDb.budgetItems.get(created.item.id))!.deleted_at).toBeTruthy()
    expect(JSON.parse(String((await offlineDb.reservations.get(-1))!.metadata)).price).toBeUndefined()
    expect((await offlineDb.syncOutbox.get(`budgetItem:${(await offlineDb.budgetItems.get(created.item.id))!.sync_id}`))!.operation).toBe('delete')
  })

  it('persists item and category ordering in IndexedDB', async () => {
    const food = await budgetRepo.create(-1, { name: 'Food', category: 'food' })
    const hotel = await budgetRepo.create(-1, { name: 'Hotel', category: 'lodging' })
    await budgetRepo.reorderItems(-1, [hotel.item.id, food.item.id])
    expect((await budgetRepo.list(-1)).items.map(item => item.name)).toEqual(['Hotel', 'Food'])
    await budgetRepo.reorderCategories(-1, ['food', 'lodging'])
    expect((await budgetRepo.list(-1)).items.map(item => item.name)).toEqual(['Food', 'Hotel'])
  })

  it('rejects a relation from another Trip', async () => {
    await offlineDb.places.put({ id: -2, sync_id: 'place-b', trip_id: -2, trip_sync_id: 'trip-b', name: 'Elsewhere', created_at: 'x', updated_at: 'x', deleted_at: null } as never)
    await expect(budgetRepo.create(-1, { name: 'Bad', place_id: -2 })).rejects.toThrow('relation')
  })
})
