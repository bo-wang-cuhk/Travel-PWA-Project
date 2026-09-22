import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { hydrate, loadTrip, sync, realtime } = vi.hoisted(() => ({
  hydrate: vi.fn(async (_id: number) => {}),
  loadTrip: vi.fn(async (_id: number) => {}),
  sync: vi.fn(async () => ({ pushed: 1, pulled: 1, conflicts: 0, cursor: '5' })),
  realtime: { onChange: null as null | ((payload: { new: { cursor: number } }) => void) },
}))

vi.mock('../../../src/auth/supabaseClient', () => ({
  SUPABASE_AUTH_ENABLED: true,
  getSupabaseClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: {} } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    rpc: async () => ({ data: 'workspace-1', error: null }),
    channel: () => ({
      on(_type: string, _filter: unknown, callback: typeof realtime.onChange) { realtime.onChange = callback; return this },
      subscribe() { return this },
    }),
    removeChannel: async () => {},
  }),
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

import { registerLocalFirstSyncTriggers, syncNow, unregisterLocalFirstSyncTriggers } from '../../../src/sync/syncScheduler'

beforeEach(() => {
  hydrate.mockClear()
  loadTrip.mockClear()
  sync.mockReset()
  sync.mockResolvedValue({ pushed: 1, pulled: 1, conflicts: 0, cursor: '5' })
  realtime.onChange = null
})

afterEach(() => {
  unregisterLocalFirstSyncTriggers()
  vi.useRealTimers()
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
    sync.mockResolvedValueOnce({ pushed: 1, pulled: 0, conflicts: 0, cursor: '5' })
    expect((await syncNow()).status).toBe('done')
    expect(hydrate).not.toHaveBeenCalled()
    expect(loadTrip).not.toHaveBeenCalled()
  })

  it('ignores the realtime echo of its own push but syncs a newer change', async () => {
    vi.useFakeTimers()
    registerLocalFirstSyncTriggers()
    await syncNow()
    expect(realtime.onChange).toBeTypeOf('function')
    realtime.onChange!({ new: { cursor: 5 } })
    await vi.advanceTimersByTimeAsync(200)
    expect(sync).toHaveBeenCalledTimes(1)

    realtime.onChange!({ new: { cursor: 6 } })
    await vi.advanceTimersByTimeAsync(200)
    expect(sync).toHaveBeenCalledTimes(2)
  })

  it('does not schedule a second pass when an in-flight pull includes the realtime event', async () => {
    vi.useFakeTimers()
    registerLocalFirstSyncTriggers()
    await syncNow()

    let finish!: (value: { pushed: number; pulled: number; conflicts: number; cursor: string }) => void
    sync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const active = syncNow()
    await Promise.resolve()
    realtime.onChange!({ new: { cursor: 6 } })
    finish({ pushed: 1, pulled: 0, conflicts: 0, cursor: '6' })
    await active
    await vi.advanceTimersByTimeAsync(200)
    expect(sync).toHaveBeenCalledTimes(2)
  })
})
