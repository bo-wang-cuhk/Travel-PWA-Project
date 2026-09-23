import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAssignment, buildPlace } from '../../../tests/helpers/factories'
import { placesApi } from '../../api/client'
import { clearAll, offlineDb } from '../../db/offlineDb'
import { assignmentRepo } from '../../repo/assignmentRepo'
import { dayRepo } from '../../repo/dayRepo'
import { placeRepo } from '../../repo/placeRepo'
import { tripRepo } from '../../repo/tripRepo'
import type { Place } from '../../types'
import { resetAllStores, seedStore } from '../../../tests/helpers/store'
import { useTripStore } from '../tripStore'

beforeEach(async () => {
  await clearAll()
  resetAllStores()
})
afterEach(() => { vi.restoreAllMocks() })

async function localFixture(names = ['A']) {
  const { trip } = await tripRepo.create({ title: 'Local', day_count: 1 })
  const day = (await dayRepo.list(trip.id)).days[0]
  const places = []
  for (const name of names) places.push((await placeRepo.create(trip.id, { name })).place)
  seedStore(useTripStore, { trip, days: [day], places })
  return { trip, day, places }
}

describe('placesSlice', () => {
  it('keeps image upload as an online-only enhancement', async () => {
    const place = buildPlace({ id: 10, trip_id: 1, image_url: null })
    const assignment = buildAssignment({ id: 100, day_id: 3, assignment_time: '09:00', assignment_end_time: '10:30', place: { ...place, place_time: '09:00', end_time: '10:30' } })
    seedStore(useTripStore, { places: [place], assignments: { '3': [assignment] } })
    const uploaded: Place = { ...place, image_url: '/uploads/places/pic.jpg' }
    vi.spyOn(placesApi, 'uploadImage').mockResolvedValue({ place: uploaded })
    await useTripStore.getState().uploadPlaceImage(1, 10, new File(['x'], 'pic.jpg'))
    expect(useTripStore.getState().places[0].image_url).toBe('/uploads/places/pic.jpg')
    expect(useTripStore.getState().assignments['3'][0].place.place_time).toBe('09:00')
  })

  it('stores collaborative ratings locally and queues the place for sync', async () => {
    const { trip, places: [place] } = await localFixture()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await useTripStore.getState().ratePlace(trip.id, place.id, 5)
    const stored = await offlineDb.places.get(place.id)
    expect(useTripStore.getState().places[0]).toMatchObject({ rating_avg: 5, rating_count: 1 })
    expect(stored).toMatchObject({ rating_avg: 5, rating_count: 1 })
    expect(stored?.ratings).toEqual([expect.objectContaining({ rating: 5 })])
    expect(await offlineDb.syncOutbox.get(`place:${place.sync_id}`)).toMatchObject({ operation: 'upsert' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('creates and updates a Place through IndexedDB without fetch', async () => {
    const { trip } = await localFixture([])
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const created = await useTripStore.getState().addPlace(trip.id, { name: 'Louvre' })
    const updated = await useTripStore.getState().updatePlace(trip.id, created.id, { name: 'Orsay' })
    expect(updated.name).toBe('Orsay')
    expect((await offlineDb.places.get(created.id))?.name).toBe('Orsay')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('updates the pool and embedded assignment projection together', async () => {
    const { trip, day, places } = await localFixture(['Museum'])
    const assignment = (await assignmentRepo.create(trip.id, day.id, places[0].id)).assignment
    seedStore(useTripStore, { assignments: { [String(day.id)]: [assignment] } })
    await useTripStore.getState().updatePlace(trip.id, places[0].id, { name: 'New museum' })
    expect(useTripStore.getState().assignments[String(day.id)][0].place.name).toBe('New museum')
  })

  it('bulk updates locally and leaves unrelated assignment maps intact', async () => {
    const { trip, places } = await localFixture(['A', 'B'])
    const before = { untouched: [buildAssignment()] }
    seedStore(useTripStore, { assignments: before })
    await useTripStore.getState().updatePlacesMany(trip.id, [places[0].id], { currency: 'JPY' })
    expect(useTripStore.getState().places.find(place => place.id === places[0].id)?.currency).toBe('JPY')
    expect(useTripStore.getState().assignments).toBe(before)
  })

  it('deletes Places locally and prunes their visible Assignments', async () => {
    const { trip, day, places } = await localFixture(['A', 'B'])
    const assignment = (await assignmentRepo.create(trip.id, day.id, places[0].id)).assignment
    seedStore(useTripStore, { assignments: { [String(day.id)]: [assignment] } })
    await useTripStore.getState().deletePlace(trip.id, places[0].id)
    expect(useTripStore.getState().places.map(place => place.name)).toEqual(['B'])
    expect(useTripStore.getState().assignments[String(day.id)]).toEqual([])
    expect((await offlineDb.places.get(places[0].id))?.deleted_at).toBeTruthy()
  })

  it('refreshes from IndexedDB and does not contact the Server', async () => {
    const { trip, places } = await localFixture(['Cached'])
    seedStore(useTripStore, { places: [] })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await useTripStore.getState().refreshPlaces(trip.id)
    expect(useTripStore.getState().places.map(place => place.id)).toEqual([places[0].id])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
