import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SyncedTrip } from '../../../domain/tripSyncModel'
import type { SyncedDay } from '../../../domain/daySyncModel'
import { EMPTY_MANIFEST, type GitHubManifest } from './githubTypes'
import { GitHubSyncProvider, RemoteAdvancedError } from './GitHubSyncProvider'

const config = { owner: 'me', repository: 'travel-data', branch: 'main', enabled: true }
const trip: SyncedTrip = {
  schemaVersion: 1,
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Tokyo',
  description: null,
  startDate: null,
  endDate: null,
  currency: 'JPY',
  coverImage: null,
  archived: false,
  reminderDays: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
}
const day: SyncedDay = {
  schemaVersion: 1,
  id: '22222222-2222-4222-8222-222222222222',
  tripId: trip.id,
  dayNumber: 1,
  date: '2026-01-02',
  title: 'Arrival',
  notes: null,
  defaultTransportMode: 'walking',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  deletedAt: null,
}

function response(value: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function file(value: unknown, sha = 'blob-sha'): unknown {
  return { encoding: 'base64', sha, content: btoa(JSON.stringify(value)) }
}

afterEach(() => vi.restoreAllMocks())

describe('GitHubSyncProvider', () => {
  it('initializes manifest.json when the private data repository has no branch yet', async () => {
    let refReads = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
      const url = String(input)
      if (url.endsWith('/repos/me/travel-data')) return response({ default_branch: 'main', permissions: { push: true } })
      if (url.includes('/git/ref/heads/main')) {
        refReads++
        return refReads === 1 ? response({ message: 'Not Found' }, 404) : response({ object: { sha: 'initial-head' } })
      }
      if (url.endsWith('/contents/manifest.json') && init.method === 'PUT') return response({ commit: { sha: 'initial-head' } }, 201)
      throw new Error(`Unexpected request: ${url}`)
    })

    await new GitHubSyncProvider(config, 'secret').connect()

    const initialize = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/contents/manifest.json') && init?.method === 'PUT')
    expect(initialize).toBeTruthy()
    expect(JSON.parse(String(initialize?.[1]?.body))).not.toHaveProperty('branch')
  })

  it('pulls manifest-indexed Trip data and uses the commit as opaque cursor', async () => {
    const manifest: GitHubManifest = {
      schemaVersion: 1,
      updatedAt: trip.updatedAt,
      trips: { [trip.id]: { path: `trips/${trip.id}/trip.json`, updatedAt: trip.updatedAt, deletedAt: null, contentHash: 'trip-blob' } },
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/repos/me/travel-data')) return response({ default_branch: 'main', permissions: { push: true } })
      if (url.includes('/git/ref/heads/main')) return response({ object: { sha: 'head-1' } })
      if (url.includes('/contents/manifest.json')) return response(file(manifest, 'manifest-blob'))
      if (url.includes(`/contents/trips/${trip.id}/trip.json`)) return response(file(trip, 'trip-blob'))
      throw new Error(`Unexpected request: ${url}`)
    })
    const provider = new GitHubSyncProvider(config, 'secret')
    await provider.connect()

    const result = await provider.pull()
    expect(result.cursor).toBe('head-1')
    expect(result.changes).toEqual([{ entityType: 'trip', entityId: trip.id, operation: 'upsert', remoteVersion: 'trip-blob', payload: trip }])
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer secret' })
  })

  it('pushes Trip and manifest in one tree commit and advances the ref without force', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    let blob = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith('/repos/me/travel-data')) return response({ default_branch: 'main', permissions: { push: true } })
      if (url.includes('/git/ref/heads/main')) return response({ object: { sha: 'head-1' } })
      if (url.includes('/git/commits/head-1')) return response({ tree: { sha: 'tree-1' } })
      if (url.includes('/contents/manifest.json')) return response(file({ schemaVersion: 1, updatedAt: trip.updatedAt, trips: {} }))
      if (url.endsWith('/git/blobs')) return response({ sha: `blob-${++blob}` })
      if (url.endsWith('/git/trees')) return response({ sha: 'tree-2' })
      if (url.endsWith('/git/commits')) return response({ sha: 'commit-2' })
      if (url.includes('/git/refs/heads/main')) return response({})
      throw new Error(`Unexpected request: ${url}`)
    })
    const provider = new GitHubSyncProvider(config, 'secret')
    await provider.connect()
    const result = await provider.push([{ entityType: 'trip', entityId: trip.id, operation: 'upsert', payload: trip }], 'head-1')

    expect(result).toEqual({ cursor: 'commit-2', versions: { [trip.id]: 'blob-1' } })
    const treeRequest = requests.find(r => r.url.endsWith('/git/trees'))!
    const treeBody = JSON.parse(String(treeRequest.init.body))
    expect(treeBody.tree.map((entry: { path: string }) => entry.path)).toEqual([`trips/${trip.id}/trip.json`, 'manifest.json'])
    const refRequest = requests.find(r => r.url.includes('/git/refs/heads/main'))!
    expect(JSON.parse(String(refRequest.init.body))).toEqual({ sha: 'commit-2', force: false })
  })

  it('rejects a push when the remote cursor advanced', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/repos/me/travel-data')) return response({ default_branch: 'main', permissions: { push: true } })
      if (url.includes('/git/ref/heads/main')) return response({ object: { sha: 'new-head' } })
      throw new Error(`Unexpected request: ${url}`)
    })
    const provider = new GitHubSyncProvider(config, 'secret')
    await provider.connect()
    await expect(provider.push([{ entityType: 'trip', entityId: trip.id, operation: 'upsert', payload: trip }], 'old-head')).rejects.toBeInstanceOf(RemoteAdvancedError)
  })

  it('pulls a grouped days.json after the parent Trip change', async () => {
    const path = `trips/${trip.id}/days.json`
    const manifest: GitHubManifest = {
      schemaVersion: 1,
      updatedAt: day.updatedAt,
      trips: { [trip.id]: { path: `trips/${trip.id}/trip.json`, updatedAt: trip.updatedAt, deletedAt: null, contentHash: 'trip-v1' } },
      days: { [day.id]: { path, tripId: trip.id, updatedAt: day.updatedAt, deletedAt: null, contentHash: 'day-v1' } },
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/repos/me/travel-data')) return response({ permissions: { push: true } })
      if (url.includes('/git/ref/heads/main')) return response({ object: { sha: 'head-days' } })
      if (url.includes('/contents/manifest.json')) return response(file(manifest))
      if (url.includes(`/contents/trips/${trip.id}/trip.json`)) return response(file(trip))
      if (url.includes(`/contents/${path}`)) return response(file({ schemaVersion: 1, tripId: trip.id, updatedAt: day.updatedAt, days: [day] }))
      throw new Error(`Unexpected request: ${url}`)
    })
    const provider = new GitHubSyncProvider(config, 'secret')
    await provider.connect()

    const result = await provider.pull()
    expect(result.changes.map(change => change.entityType)).toEqual(['trip', 'day'])
    expect(result.changes[1]).toMatchObject({ entityId: day.id, remoteVersion: 'day-v1', payload: day })
  })

  it('patches a Trip-scoped days.json and commits it with the manifest', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    let blob = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith('/repos/me/travel-data')) return response({ permissions: { push: true } })
      if (url.includes('/git/ref/heads/main')) return response({ object: { sha: 'head-1' } })
      if (url.includes('/git/commits/head-1')) return response({ tree: { sha: 'tree-1' } })
      if (url.includes('/contents/manifest.json')) return response(file({ ...EMPTY_MANIFEST }))
      if (url.includes(`/contents/trips/${trip.id}/days.json`)) return response({ message: 'Not Found' }, 404)
      if (url.endsWith('/git/blobs')) return response({ sha: `blob-${++blob}` })
      if (url.endsWith('/git/trees')) return response({ sha: 'tree-2' })
      if (url.endsWith('/git/commits')) return response({ sha: 'commit-2' })
      if (url.includes('/git/refs/heads/main')) return response({})
      throw new Error(`Unexpected request: ${url}`)
    })
    const provider = new GitHubSyncProvider(config, 'secret')
    await provider.connect()
    const result = await provider.push([{ entityType: 'day', entityId: day.id, operation: 'upsert', payload: day }], 'head-1')

    expect(result.versions[day.id]).toBe(`${day.updatedAt}:active`)
    const treeRequest = requests.find(request => request.url.endsWith('/git/trees'))!
    expect(JSON.parse(String(treeRequest.init.body)).tree.map((entry: { path: string }) => entry.path)).toEqual([
      `trips/${trip.id}/days.json`, 'manifest.json',
    ])
  })
})
