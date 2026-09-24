import { applySyncedPlace, toSyncedPlace } from './placeSyncModel'
import type { LocalPlaceRecord } from './placeSyncModel'

describe('Place visit status sync', () => {
  const local = {
    id: -1, sync_id: 'place-id', trip_id: -2, trip_sync_id: 'trip-id',
    name: '山边边咖啡', created_at: '2026-09-24T00:00:00Z', updated_at: '2026-09-24T00:00:00Z', deleted_at: null,
  } as LocalPlaceRecord

  it('defaults legacy places to planned', () => {
    const remote = toSyncedPlace(local)
    expect(remote.visitStatus).toBe('planned')
    expect(applySyncedPlace({ ...remote, visitStatus: undefined }, -1, -2).visit_status).toBe('planned')
  })

  it('preserves visited and skipped between devices', () => {
    for (const visit_status of ['visited', 'skipped'] as const) {
      const remote = toSyncedPlace({ ...local, visit_status })
      expect(remote.visitStatus).toBe(visit_status)
      expect(applySyncedPlace(remote, -1, -2).visit_status).toBe(visit_status)
    }
  })
})
