import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPlaceDetails, PLACE_DETAILS_TTL_MS } from './placeDetails'

const rows = new Map<string, Record<string, unknown>>()
const invoke = vi.fn()
vi.mock('../db/offlineDb', () => ({
  offlineDb: { placeDetailsCache: {
    get: (key: string) => Promise.resolve(rows.get(key)),
    put: (row: { placeId: string }) => { rows.set(row.placeId, row); return Promise.resolve() },
  } },
}))
vi.mock('../auth/supabaseClient', () => ({ getSupabaseClient: () => ({ functions: { invoke } }) }))

const identity = { placeId: '42', provider: 'baidu' as const, providerPlaceId: 'baidu-uid' }

beforeEach(() => {
  rows.clear()
  invoke.mockReset()
})

describe('place details local cache', () => {
  it('uses fresh IndexedDB data without calling the provider', async () => {
    rows.set('42', { ...identity, rating: 4.5, fetchedAt: new Date().toISOString() })
    const updates: unknown[] = []
    const result = await loadPlaceDetails(identity, 'zh', value => updates.push(value))
    expect(result?.rating).toBe(4.5)
    expect(updates).toHaveLength(1)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('shows stale data first, then replaces it after a provider refresh', async () => {
    rows.set('42', { ...identity, rating: 3, fetchedAt: new Date(Date.now() - PLACE_DETAILS_TTL_MS - 1).toISOString() })
    invoke.mockResolvedValue({ data: { provider: 'baidu', providerPlaceId: 'baidu-uid', rating: 4.7 }, error: null })
    const updates: number[] = []
    const result = await loadPlaceDetails(identity, 'zh', value => updates.push(value.rating || 0))
    expect(updates).toEqual([3, 4.7])
    expect(result?.rating).toBe(4.7)
    expect(rows.get('42')?.rating).toBe(4.7)
    expect(invoke).toHaveBeenCalledWith('place-search', { body: {
      action: 'details', provider: 'baidu', providerPlaceId: 'baidu-uid', lang: 'zh',
    } })
  })

  it('keeps stale data when refresh fails and rejects another provider ID', async () => {
    rows.set('42', { ...identity, rating: 3, fetchedAt: '2020-01-01T00:00:00.000Z' })
    invoke.mockResolvedValueOnce({ data: null, error: new Error('offline') })
    expect((await loadPlaceDetails(identity))?.rating).toBe(3)
    invoke.mockResolvedValueOnce({ data: { provider: 'baidu', providerPlaceId: 'other', rating: 5 }, error: null })
    expect(await loadPlaceDetails({ ...identity, providerPlaceId: 'new-id' })).toBeNull()
    expect(rows.get('42')?.rating).toBe(3)
  })
})
