import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, offlineDb } from '../db/offlineDb'
import { assignmentRepo } from './assignmentRepo'
import { dayRepo } from './dayRepo'
import { placeRepo } from './placeRepo'
import { tripRepo } from './tripRepo'
import { reservationRepo } from './reservationRepo'

beforeEach(async () => { await clearAll() })
afterEach(() => { vi.restoreAllMocks() })

async function fixture() {
  const { trip } = await tripRepo.create({ title: 'Kyoto', day_count: 2 })
  const days = (await dayRepo.list(trip.id)).days
  const a = await placeRepo.create(trip.id, { name: 'Fushimi Inari' })
  const b = await placeRepo.create(trip.id, { name: 'Kiyomizu-dera' })
  return { trip, days, a: a.place, b: b.place }
}

describe('assignmentRepo local IndexedDB data source', () => {
  it('creates an Assignment with UUID-only sync relations', async () => {
    const { trip, days, a } = await fixture()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { assignment } = await assignmentRepo.create(trip.id, days[0].id, a.id)
    const stored = await offlineDb.assignments.get(assignment.id)
    expect(stored).toMatchObject({ trip_id: trip.id, day_id: days[0].id, place_id: a.id, order_index: 0, deleted_at: null })
    expect(stored?.sync_id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(stored?.day_sync_id).toBe((await offlineDb.days.get(days[0].id))?.sync_id)
    expect(stored?.place_sync_id).toBe((await offlineDb.places.get(a.id))?.sync_id)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('updates time, note and both leg modes locally', async () => {
    const { trip, days, a } = await fixture()
    const { assignment } = await assignmentRepo.create(trip.id, days[0].id, a.id)
    await assignmentRepo.updateTime(trip.id, assignment.id, { place_time: '09:00', end_time: '10:30' })
    await assignmentRepo.updateNotes(trip.id, assignment.id, 'Arrive early')
    await assignmentRepo.updateTransport(trip.id, assignment.id, 'walking')
    await assignmentRepo.updateTransport(trip.id, assignment.id, 'driving', 'incoming')
    expect(await offlineDb.assignments.get(assignment.id)).toMatchObject({
      assignment_time: '09:00', assignment_end_time: '10:30', notes: 'Arrive early',
      leg_transport_mode: 'walking', incoming_leg_transport_mode: 'driving',
    })
  })

  it('inserts, reorders and joins the current Place projection', async () => {
    const { trip, days, a, b } = await fixture()
    const first = await assignmentRepo.create(trip.id, days[0].id, a.id)
    const inserted = await assignmentRepo.create(trip.id, days[0].id, b.id, 0)
    expect((await assignmentRepo.listByDay(days[0].id)).map(item => item.id)).toEqual([inserted.assignment.id, first.assignment.id])
    await placeRepo.update(trip.id, a.id, { name: 'Updated shrine' })
    const reordered = await assignmentRepo.reorder(trip.id, days[0].id, [first.assignment.id, inserted.assignment.id])
    expect(reordered.map(item => item.place.name)).toEqual(['Updated shrine', 'Kiyomizu-dera'])
  })

  it('moves an Assignment between Days and reindexes both lists', async () => {
    const { trip, days, a, b } = await fixture()
    const moving = await assignmentRepo.create(trip.id, days[0].id, a.id)
    await assignmentRepo.create(trip.id, days[1].id, b.id)
    await assignmentRepo.move(trip.id, moving.assignment.id, days[0].id, days[1].id, 0)
    expect(await assignmentRepo.listByDay(days[0].id)).toEqual([])
    expect((await assignmentRepo.listByDay(days[1].id)).map(item => item.place_id)).toEqual([a.id, b.id])
    expect((await offlineDb.assignments.get(moving.assignment.id))?.day_sync_id).toBe((await offlineDb.days.get(days[1].id))?.sync_id)
  })

  it('delete keeps a tombstone and reindexes remaining rows', async () => {
    const { trip, days, a, b } = await fixture()
    const first = await assignmentRepo.create(trip.id, days[0].id, a.id)
    const second = await assignmentRepo.create(trip.id, days[0].id, b.id)
    await assignmentRepo.delete(trip.id, days[0].id, first.assignment.id)
    expect((await offlineDb.assignments.get(first.assignment.id))?.deleted_at).toBeTruthy()
    expect((await assignmentRepo.listByDay(days[0].id))[0]).toMatchObject({ id: second.assignment.id, order_index: 0 })
    expect(await offlineDb.syncOutbox.get(`assignment:${(await offlineDb.assignments.get(first.assignment.id))?.sync_id}`)).toMatchObject({ operation: 'delete' })
  })

  it('deleting an Assignment unlinks its Reservation without deleting the booking', async () => {
    const { trip, days, a } = await fixture()
    const { assignment } = await assignmentRepo.create(trip.id, days[0].id, a.id)
    const { reservation } = await reservationRepo.create(trip.id, { title: 'Museum ticket', assignment_id: assignment.id })
    await assignmentRepo.delete(trip.id, days[0].id, assignment.id)
    expect(await offlineDb.reservations.get(reservation.id)).toMatchObject({ assignment_id: null, assignment_sync_id: null, deleted_at: null })
  })

  it('rejects incomplete reorder and cross-Trip relations', async () => {
    const { trip, days, a, b } = await fixture()
    const first = await assignmentRepo.create(trip.id, days[0].id, a.id)
    await assignmentRepo.create(trip.id, days[0].id, b.id)
    await expect(assignmentRepo.reorder(trip.id, days[0].id, [first.assignment.id])).rejects.toThrow('every active assignment')
    const other = await tripRepo.create({ title: 'Other', day_count: 1 })
    await expect(assignmentRepo.create(other.trip.id, days[0].id, a.id)).rejects.toThrow('Day not found')
  })
})
