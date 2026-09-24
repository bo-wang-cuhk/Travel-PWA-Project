import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, offlineDb } from '../db/offlineDb'
import { journeyRepo } from './journeyRepo'
import { tripRepo } from './tripRepo'
import { placeRepo } from './placeRepo'
import { workspaceMembersApi } from '../auth/workspaceMembersApi'

beforeEach(async () => { await clearAll(); localStorage.removeItem('trek_auth_snapshot') })

describe('journeyRepo', () => {
  it('creates a text journey, links a trip place and stores edits locally', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { trip } = await tripRepo.create({ title: 'Kyoto', day_count: 1 })
    const { place } = await placeRepo.create(trip.id, { name: 'Kiyomizu-dera', lat: 34.9949, lng: 135.785 })
    const journey = await journeyRepo.create({ title: 'Autumn', trip_ids: [trip.id] })
    const entry = await journeyRepo.createEntry(journey.id, {
      title: 'First day', story: 'Walked to the temple', entry_date: '2026-10-01',
      source_trip_id: trip.id, source_place_id: place.id, location_name: place.name,
    })
    await journeyRepo.updateEntry(entry.id, { story: 'Walked there at sunrise' })
    const detail = await journeyRepo.get(journey.id)
    expect(detail.trips[0].title).toBe('Kyoto')
    expect(detail.entries[0]).toMatchObject({ story: 'Walked there at sunrise', source_place_id: place.id })
    expect(await offlineDb.syncOutbox.count()).toBeGreaterThanOrEqual(4)
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('soft deletes a journey and its entries for cross-device sync', async () => {
    const journey = await journeyRepo.create({ title: 'Archive' })
    const entry = await journeyRepo.createEntry(journey.id, { title: 'Day one', entry_date: '2026-10-01' })
    await journeyRepo.delete(journey.id)
    expect((await journeyRepo.list()).journeys).toEqual([])
    expect((await offlineDb.journeyEntries.get(entry.id))?.deleted_at).not.toBeNull()
    expect((await offlineDb.syncOutbox.where('entityType').equals('journeyEntry').first())?.operation).toBe('delete')
  })

  it('only selects contributors from current workspace members and keeps their role', async () => {
    const journey = await journeyRepo.create({ title: 'Shared notes' })
    vi.spyOn(workspaceMembersApi, 'context').mockResolvedValue({
      workspace: { id: 'workspace', kind: 'shared', name: 'Friends', owner_id: 'owner' },
      can_manage: true,
      members: [{ id: 42, auth_id: '00000000-0000-4000-8000-000000000042', username: 'Lin', display_name: 'Lin' }],
      candidates: [],
    })
    await journeyRepo.addContributor(journey.id, 42, 'viewer')
    expect((await journeyRepo.get(journey.id)).contributors).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: 42, username: 'Lin', role: 'viewer' }),
    ]))
    await expect(journeyRepo.addContributor(journey.id, 99, 'editor')).rejects.toThrow('existing workspace member')
    await journeyRepo.addContributor(journey.id, 42, 'editor')
    expect((await journeyRepo.get(journey.id)).contributors.find(member => member.user_id === 42)?.role).toBe('editor')
    vi.restoreAllMocks()
  })
})
