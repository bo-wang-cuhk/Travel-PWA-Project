// FE-REPO-DAY-001 to FE-REPO-DAY-008
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { clearAll, offlineDb } from '../db/offlineDb'
import { tripRepo } from './tripRepo'
import { dayRepo } from './dayRepo'
import { placeRepo } from './placeRepo'
import { accommodationRepo } from './accommodationRepo'
import { reservationRepo } from './reservationRepo'

beforeEach(async () => { await clearAll() })
afterEach(() => { vi.restoreAllMocks() })

async function trip(): Promise<number> {
  const created = await tripRepo.create({ title: 'Japan', day_count: 0, currency: 'JPY' })
  await offlineDb.trips.update(created.trip.id, { start_date: '2026-11-01', end_date: '2026-11-03' })
  return created.trip.id
}

describe('dayRepo local IndexedDB data source', () => {
  it('FE-REPO-DAY-001: creates and lists a Day without calling fetch', async () => {
    const tripId = await trip()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const created = await dayRepo.create(tripId)

    expect(created.day).toMatchObject({ trip_id: tripId, day_number: 1, date: '2026-11-01', deleted_at: null })
    expect(created.day.sync_id).toMatch(/^[0-9a-f-]{36}$/i)
    expect((await dayRepo.list(tripId)).days).toHaveLength(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('FE-REPO-DAY-002: inserts into a dated slot and re-pins following dates', async () => {
    const tripId = await trip()
    const first = await dayRepo.create(tripId)
    const third = await dayRepo.create(tripId)
    const inserted = await dayRepo.create(tripId, { position: 2, notes: 'middle' })

    const days = (await dayRepo.list(tripId)).days
    expect(days.map(day => day.id)).toEqual([first.day.id, inserted.day.id, third.day.id])
    expect(days.map(day => day.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03'])
    expect((await offlineDb.trips.get(tripId))?.day_count).toBe(3)
  })

  it('FE-REPO-DAY-003: updates title, notes and transport locally', async () => {
    const tripId = await trip()
    const created = await dayRepo.create(tripId)
    await dayRepo.update(tripId, created.day.id, { title: 'Kyoto', notes: 'Temples' })
    await dayRepo.updateTransport(tripId, created.day.id, 'walking')

    expect((await dayRepo.get(created.day.id)).day).toMatchObject({ title: 'Kyoto', notes: 'Temples', default_transport_mode: 'walking' })
  })

  it('FE-REPO-DAY-004: reorders complete Day content while dates remain pinned', async () => {
    const tripId = await trip()
    const a = await dayRepo.create(tripId)
    await dayRepo.update(tripId, a.day.id, { title: 'Arrival' })
    const b = await dayRepo.create(tripId)
    await dayRepo.update(tripId, b.day.id, { title: 'Departure' })

    const result = await dayRepo.reorder(tripId, [b.day.id, a.day.id])
    expect(result.days.map(day => day.title)).toEqual(['Departure', 'Arrival'])
    expect(result.days.map(day => day.date)).toEqual(['2026-11-01', '2026-11-02'])
  })

  it('FE-REPO-DAY-005: rejects an incomplete or duplicate reorder', async () => {
    const tripId = await trip()
    const a = await dayRepo.create(tripId)
    await dayRepo.create(tripId)
    await expect(dayRepo.reorder(tripId, [a.day.id])).rejects.toThrow('every active day')
    await expect(dayRepo.reorder(tripId, [a.day.id, a.day.id])).rejects.toThrow('every active day')
  })

  it('FE-REPO-DAY-006: delete writes a tombstone and queues it', async () => {
    const tripId = await trip()
    const a = await dayRepo.create(tripId)
    const b = await dayRepo.create(tripId)
    await dayRepo.delete(tripId, a.day.id)

    expect((await dayRepo.list(tripId)).days.map(day => day.id)).toEqual([b.day.id])
    const tombstone = await offlineDb.days.get(a.day.id)
    expect(tombstone?.deleted_at).toBeTruthy()
    expect(await offlineDb.syncOutbox.get(`day:${a.day.sync_id}`)).toMatchObject({ operation: 'delete', status: 'pending' })
  })

  it('FE-REPO-DAY-006b: deleting a Day tombstones its stay and safely unlinks its Reservation', async () => {
    const tripId = await trip()
    const a = await dayRepo.create(tripId)
    const b = await dayRepo.create(tripId)
    const { place } = await placeRepo.create(tripId, { name: 'Local hotel' })
    const { accommodation } = await accommodationRepo.create(tripId, { place_id: place.id, start_day_id: a.day.id, end_day_id: b.day.id })
    const { reservation } = await reservationRepo.create(tripId, { title: 'Stay', day_id: a.day.id, accommodation_id: accommodation.id })
    await dayRepo.delete(tripId, a.day.id)
    expect((await offlineDb.accommodations.get(accommodation.id))?.deleted_at).toBeTruthy()
    expect(await offlineDb.reservations.get(reservation.id)).toMatchObject({ day_id: null, accommodation_id: null, deleted_at: null })
  })

  it('FE-REPO-DAY-007: rejects a Day belonging to another Trip', async () => {
    const tripA = await trip()
    const tripB = await trip()
    const day = await dayRepo.create(tripA)
    await expect(dayRepo.update(tripB, day.day.id, { title: 'Wrong parent' })).rejects.toThrow('Day not found')
  })

  it('FE-REPO-DAY-008: data survives closing and reopening IndexedDB', async () => {
    const tripId = await trip()
    const created = await dayRepo.create(tripId, { notes: 'persistent' })
    offlineDb.close()
    await offlineDb.open()
    expect((await dayRepo.get(created.day.id)).day.notes).toBe('persistent')
  })
})
