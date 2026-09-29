import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, offlineDb } from '../db/offlineDb'
import { tripRepo } from './tripRepo'
import { dayRepo } from './dayRepo'
import { placeRepo } from './placeRepo'
import { assignmentRepo } from './assignmentRepo'
import { toSyncedTrip, applySyncedTrip } from '../domain/tripSyncModel'
import { atlasStats, countryDetail, visitedRegions } from '../pages/atlas/atlasRepository'

vi.mock('../pages/atlas/atlasGeo', () => ({
  locatePoint: vi.fn(async () => ({ country_code: 'CN', region_code: 'CN-SH', region_name: 'Shanghai' })),
}))

beforeEach(async () => { await clearAll() })

describe('outing lifecycle and explicit footprints', () => {
  it('creates exactly one undated day and persists the mode through sync', async () => {
    const { trip } = await tripRepo.create({ title: 'Science museum', type: 'outing', day_count: 7 })
    expect(trip).toMatchObject({ type: 'outing', start_date: null, end_date: null, day_count: 1 })
    expect((await dayRepo.list(trip.id)).days).toMatchObject([{ date: null, day_number: 1 }])
    expect(applySyncedTrip(toSyncedTrip(trip), -100)).toMatchObject({ type: 'outing', day_count: 1 })
    const legacy = { ...toSyncedTrip(trip), type: undefined }
    expect(applySyncedTrip(legacy, -100).type).toBe('trip')
  })

  it('normalizes the date range and rejects adding or deleting its only day', async () => {
    const { trip } = await tripRepo.create({ title: 'Park', type: 'outing', start_date: '2026-09-27', end_date: '2026-10-01' })
    expect(trip.end_date).toBe('2026-09-27')
    const [day] = (await dayRepo.list(trip.id)).days
    await expect(dayRepo.create(trip.id)).rejects.toThrow('exactly one day')
    await expect(dayRepo.delete(trip.id, day.id)).rejects.toThrow('cannot be deleted')
    expect((await dayRepo.list(trip.id)).days).toHaveLength(1)
  })

  it('retains day identity, notes and place assignments when setting, shifting and clearing a date', async () => {
    const { trip } = await tripRepo.create({ title: 'Museum', type: 'outing' })
    const [day] = (await dayRepo.list(trip.id)).days
    await dayRepo.update(trip.id, day.id, { notes: 'Bring tickets' })
    const { place } = await placeRepo.create(trip.id, { name: 'Museum' })
    await assignmentRepo.create(trip.id, day.id, place.id)
    for (const date of ['2026-09-27', '2026-10-01', null]) {
      const updated = await tripRepo.update(trip.id, { start_date: date })
      expect(updated.trip).toMatchObject({ start_date: date, end_date: date, day_count: 1 })
      expect((await dayRepo.list(trip.id)).days).toMatchObject([{ id: day.id, date, notes: 'Bring tickets' }])
      expect((await offlineDb.assignments.where('day_id').equals(day.id).toArray()).filter(a => !a.deleted_at)).toHaveLength(1)
    }
  })

  it('upgrades to a multi-day trip and refuses a lossy conversion back', async () => {
    const { trip } = await tripRepo.create({ title: 'Weekend', type: 'outing', start_date: '2026-10-01' })
    const [day] = (await dayRepo.list(trip.id)).days
    await tripRepo.update(trip.id, { type: 'trip', end_date: '2026-10-03' })
    expect((await dayRepo.list(trip.id)).days).toHaveLength(3)
    await expect(tripRepo.update(trip.id, { type: 'outing', title: 'Should not save' })).rejects.toThrow('one day')
    expect((await tripRepo.get(trip.id)).trip).toMatchObject({ type: 'trip', title: 'Weekend', day_count: 3 })
    expect((await dayRepo.list(trip.id)).days[0].id).toBe(day.id)
  })

  it('converts a one-day trip explicitly and keeps existing content', async () => {
    const { trip } = await tripRepo.create({ title: 'One-day trip', day_count: 1 })
    const [day] = (await dayRepo.list(trip.id)).days
    expect(trip.type).toBe('trip')
    await tripRepo.update(trip.id, { type: 'outing' })
    expect((await dayRepo.list(trip.id)).days[0].id).toBe(day.id)
    expect((await tripRepo.get(trip.id)).trip.type).toBe('outing')
  })

  it('requires an explicit visited state, regardless of trip dates or type', async () => {
    const { trip: past } = await tripRepo.create({ title: 'Past', start_date: '2020-01-01', end_date: '2020-01-01' })
    const { trip: outing } = await tripRepo.create({ title: 'Someday', type: 'outing' })
    await placeRepo.create(past.id, { name: 'Planned', lat: 31, lng: 121 })
    await placeRepo.create(past.id, { name: 'Skipped', lat: 31, lng: 121, visit_status: 'skipped' })
    const { place } = await placeRepo.create(outing.id, { name: 'Visited', lat: 31, lng: 121, visit_status: 'visited' })
    expect((await atlasStats()).footprintPlaces).toHaveLength(1)
    expect((await countryDetail('CN')).places.map(p => p.name)).toEqual(['Visited'])
    expect((await visitedRegions())['CN']).toMatchObject([{ status: 'visited', placeCount: 1 }])
    await placeRepo.update(outing.id, place.id, { visit_status: 'planned' })
    expect((await atlasStats()).footprintPlaces).toEqual([])
    expect((await visitedRegions())['CN']).toBeUndefined()
  })

  it('keeps archived footprints and removes deleted places or trips', async () => {
    const { trip } = await tripRepo.create({ title: 'Zoo', type: 'outing' })
    await placeRepo.create(trip.id, { name: 'Zoo', lat: 31, lng: 121, visit_status: 'visited' })
    await tripRepo.archive(trip.id)
    expect((await atlasStats()).footprintPlaces).toHaveLength(1)
    await tripRepo.delete(trip.id)
    expect((await atlasStats()).footprintPlaces).toEqual([])
  })

  it('counts visited places without coordinates and merges map points while retaining sources', async () => {
    const { trip } = await tripRepo.create({ title: 'Walk', type: 'outing' })
    await placeRepo.create(trip.id, { name: 'No coordinates', visit_status: 'visited' })
    await placeRepo.create(trip.id, { name: 'First visit', lat: 31, lng: 121, visit_status: 'visited' })
    await placeRepo.create(trip.id, { name: 'Second visit', lat: 31, lng: 121, visit_status: 'visited' })
    const atlas = await atlasStats()
    expect(atlas.stats.totalPlaces).toBe(3)
    expect(atlas.footprintPlaces).toHaveLength(1)
    expect((await countryDetail('CN')).places).toHaveLength(2)
  })
})
