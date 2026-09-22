import { beforeEach, describe, expect, it, vi } from 'vitest'

const { hydrate, loadTrip, sync } = vi.hoisted(() => ({
  hydrate: vi.fn(async (_id: number) => {}),
  loadTrip: vi.fn(async (_id: number) => {}),
  sync: vi.fn(async () => ({ pushed: 1, pulled: 1 })),
}))

vi.mock('../../../src/auth/supabaseClient', () => ({
  SUPABASE_AUTH_ENABLED: true,
  getSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: {} } }) } }),
}))
vi.mock('../../../src/sync/providers/supabase/SupabaseSyncProvider', () => ({
  SupabaseSyncProvider: class {},
}))
vi.mock('../../../src/sync/SyncManager', () => ({
  SyncManager: class { sync = sync },
}))
vi.mock('../../../src/store/tripStore', () => ({
  useTripStore: { getState: () => ({ trip: { id: 7 }, hydrateActiveTrip: hydrate, loadTrip }) },
}))

import { syncNow } from '../../../src/sync/syncScheduler'

beforeEach(() => {
  hydrate.mockClear()
  loadTrip.mockClear()
  sync.mockReset()
  sync.mockResolvedValue({ pushed: 1, pulled: 1 })
})

describe('sync scheduler', () => {
  it('reconciles a local edit without resetting the visible trip', async () => {
    const onComplete = vi.fn()
    window.addEventListener('travel-sync-complete', onComplete)
    try {
      expect((await syncNow()).status).toBe('done')
      expect(hydrate).toHaveBeenCalledExactlyOnceWith(7)
      expect(loadTrip).not.toHaveBeenCalled()
      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(hydrate.mock.invocationCallOrder[0]).toBeLessThan(onComplete.mock.invocationCallOrder[0])
    } finally {
      window.removeEventListener('travel-sync-complete', onComplete)
    }
  })

  it('keeps the planner store untouched when only local changes were pushed', async () => {
    sync.mockResolvedValueOnce({ pushed: 1, pulled: 0 })
    expect((await syncNow()).status).toBe('done')
    expect(hydrate).not.toHaveBeenCalled()
    expect(loadTrip).not.toHaveBeenCalled()
  })
})
