// FE-TSLICE-DAYS-001 to FE-TSLICE-DAYS-005
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll } from '../../db/offlineDb'
import { dayRepo } from '../../repo/dayRepo'
import { tripRepo } from '../../repo/tripRepo'
import { resetAllStores, seedStore } from '../../../tests/helpers/store'
import { useTripStore } from '../tripStore'

beforeEach(async () => {
  await clearAll()
  resetAllStores()
})

async function localTrip(): Promise<number> {
  const { trip } = await tripRepo.create({
    title: 'Local trip', start_date: '2026-06-01', end_date: '2026-06-03', currency: 'EUR',
  })
  seedStore(useTripStore, { days: (await dayRepo.list(trip.id)).days, reservations: [] })
  return trip.id
}

describe('daysSlice local-first wiring', () => {
  it('FE-TSLICE-DAYS-001: reorders locally and pins dates to slots', async () => {
    const tripId = await localTrip()
    const before = useTripStore.getState().days
    await dayRepo.update(tripId, before[0].id, { title: 'Arrival' })
    await dayRepo.update(tripId, before[2].id, { title: 'Departure' })
    seedStore(useTripStore, { days: (await dayRepo.list(tripId)).days })

    await useTripStore.getState().reorderDays(tripId, [before[2].id, before[0].id, before[1].id])

    expect(useTripStore.getState().days.map(day => day.title)).toEqual(['Departure', 'Arrival', null])
    expect(useTripStore.getState().days.map(day => day.date)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03'])
  })

  it('FE-TSLICE-DAYS-002: does not call fetch to persist a reorder', async () => {
    const tripId = await localTrip()
    const ids = useTripStore.getState().days.map(day => day.id).reverse()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await useTripStore.getState().reorderDays(tripId, ids)

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('FE-TSLICE-DAYS-003: rejects an incomplete order and restores the visible state', async () => {
    const tripId = await localTrip()
    const before = useTripStore.getState().days
    await expect(useTripStore.getState().reorderDays(tripId, [before[0].id])).rejects.toThrow('every active day')
    expect(useTripStore.getState().days.map(day => day.id)).toEqual(before.map(day => day.id))
  })

  it('FE-TSLICE-DAYS-004: inserts a Day and refreshes from IndexedDB', async () => {
    const tripId = await localTrip()
    const created = await useTripStore.getState().insertDay(tripId, 2)

    expect(created?.day_number).toBe(2)
    expect(useTripStore.getState().days).toHaveLength(4)
    expect(useTripStore.getState().days[1].id).toBe(created?.id)
  })

  it('FE-TSLICE-DAYS-005: a missing local Trip leaves the visible list unchanged', async () => {
    const before = useTripStore.getState().days
    await expect(useTripStore.getState().insertDay(999)).rejects.toThrow('Trip not found')
    expect(useTripStore.getState().days).toEqual(before)
  })
})
