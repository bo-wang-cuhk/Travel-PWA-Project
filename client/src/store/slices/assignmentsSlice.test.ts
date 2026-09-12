import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, offlineDb } from '../../db/offlineDb'
import { dayRepo } from '../../repo/dayRepo'
import { placeRepo } from '../../repo/placeRepo'
import { tripRepo } from '../../repo/tripRepo'
import { resetAllStores, seedStore } from '../../../tests/helpers/store'
import { useTripStore } from '../tripStore'

beforeEach(async () => { await clearAll(); resetAllStores() })
afterEach(() => { vi.restoreAllMocks() })

async function fixture() {
  const { trip } = await tripRepo.create({ title: 'Local', day_count: 2 })
  const days = (await dayRepo.list(trip.id)).days
  const a = (await placeRepo.create(trip.id, { name: 'A' })).place
  const b = (await placeRepo.create(trip.id, { name: 'B' })).place
  seedStore(useTripStore, { trip, days, places: [a, b], assignments: { [String(days[0].id)]: [], [String(days[1].id)]: [] } })
  return { trip, days, a, b }
}

describe('assignmentsSlice local-first wiring', () => {
  it('creates and removes an Assignment without fetch', async () => {
    const { trip, days, a } = await fixture()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const created = await useTripStore.getState().assignPlaceToDay(trip.id, days[0].id, a.id)
    expect(useTripStore.getState().assignments[String(days[0].id)][0].id).toBe(created?.id)
    await useTripStore.getState().removeAssignment(trip.id, days[0].id, created!.id)
    expect(useTripStore.getState().assignments[String(days[0].id)]).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('honours insertion position and persists reorder', async () => {
    const { trip, days, a, b } = await fixture()
    const first = await useTripStore.getState().assignPlaceToDay(trip.id, days[0].id, a.id)
    const second = await useTripStore.getState().assignPlaceToDay(trip.id, days[0].id, b.id, 0)
    expect(useTripStore.getState().assignments[String(days[0].id)].map(item => item.id)).toEqual([second!.id, first!.id])
    await useTripStore.getState().reorderAssignments(trip.id, days[0].id, [first!.id, second!.id])
    expect((await offlineDb.assignments.where('day_id').equals(days[0].id).toArray()).sort((x, y) => x.order_index - y.order_index).map(item => item.id)).toEqual([first!.id, second!.id])
  })

  it('moves an Assignment between Day maps', async () => {
    const { trip, days, a } = await fixture()
    const created = await useTripStore.getState().assignPlaceToDay(trip.id, days[0].id, a.id)
    await useTripStore.getState().moveAssignment(trip.id, created!.id, days[0].id, days[1].id, 0)
    expect(useTripStore.getState().assignments[String(days[0].id)]).toEqual([])
    expect(useTripStore.getState().assignments[String(days[1].id)][0]).toMatchObject({ id: created!.id, day_id: days[1].id })
  })
})
