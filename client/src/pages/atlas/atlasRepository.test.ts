import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, offlineDb } from '../../db/offlineDb'
import { LOCAL_USER } from '../../config/runtimeMode'
import { useAuthStore } from '../../store/authStore'
import { addBucket, atlasRecord, atlasStats, deleteBucket, markCountry, markRegion, unmarkCountry, unmarkRegion, visitedRegions } from './atlasRepository'

vi.mock('./atlasGeo', () => ({
  locatePoint: vi.fn(async () => ({ country_code: 'JP', region_code: 'JP-13', region_name: 'Tokyo' })),
}))

const userId = '22222222-2222-4222-8222-222222222222'

beforeEach(async () => {
  await clearAll()
  useAuthStore.setState({ user: { ...LOCAL_USER, auth_id: userId } })
})

describe('local-first Atlas repository', () => {
  it('keeps manual country/region changes in IndexedDB and queues one personal cloud document', async () => {
    await markCountry('JP')
    await markRegion('JP-13', 'Tokyo', 'JP')
    expect((await atlasRecord()).manualCountries).toEqual(['JP'])
    expect((await visitedRegions()).JP).toMatchObject([{ code: 'JP-13', manuallyMarked: true }])
    expect((await offlineDb.syncOutbox.get(`atlas:${userId}`))?.status).toBe('pending')
    await unmarkRegion('JP-13')
    await unmarkCountry('JP')
    expect((await atlasRecord()).hiddenCountries).toEqual(['JP'])
    expect((await atlasRecord()).hiddenRegions).toEqual(['JP-13'])
  })

  it('saves wish-list additions and deletions immediately', async () => {
    const item = await addBucket({ name: 'Kyoto', lat: 35, lng: 135 })
    expect((await atlasRecord()).bucketItems[0]).toMatchObject({ id: item.id, name: 'Kyoto' })
    await deleteBucket(item.id)
    expect((await atlasRecord()).bucketItems).toEqual([])
  })

  it('derives country counts from local Trips and Places without the TREK Server', async () => {
    await offlineDb.trips.put({ id: -1, sync_id: 'trip-1', user_id: 0, title: 'Tokyo', description: null, start_date: '2020-01-01', end_date: '2020-01-03', currency: 'CNY', cover_image: null, is_archived: 0, reminder_days: 0, day_count: 0, place_count: 1, is_owner: 1, shared_count: 0, created_at: '2020-01-01', updated_at: '2020-01-01', deleted_at: null })
    await offlineDb.places.put({ id: -1, sync_id: 'place-1', trip_id: -1, trip_sync_id: 'trip-1', name: 'Tokyo Tower', lat: 35.6, lng: 139.7, created_at: '2020-01-01', updated_at: '2020-01-01', deleted_at: null } as any)
    const data = await atlasStats()
    expect(data.countries).toMatchObject([{ code: 'JP', placeCount: 1, tripCount: 1, status: 'visited' }])
    expect(data.stats).toMatchObject({ totalTrips: 1, totalPlaces: 1, totalCountries: 1, totalDays: 3 })
  })
})
