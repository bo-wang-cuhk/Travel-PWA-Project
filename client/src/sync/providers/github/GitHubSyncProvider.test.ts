import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SyncedTrip } from '../../../domain/tripSyncModel'
import type { SyncedDay } from '../../../domain/daySyncModel'
import type { SyncedPlace } from '../../../domain/placeSyncModel'
import type { SyncedAssignment } from '../../../domain/assignmentSyncModel'
import type { SyncedAccommodation } from '../../../domain/accommodationSyncModel'
import type { SyncedReservation } from '../../../domain/reservationSyncModel'
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
const place: SyncedPlace = {
  schemaVersion: 1, id: '33333333-3333-4333-8333-333333333333', tripId: trip.id,
  name: 'Senso-ji', description: null, lat: 35.7148, lng: 139.7967, address: null,
  price: null, currency: null, reservationStatus: null, reservationNotes: null,
  reservationDatetime: null, placeTime: null, endTime: null, durationMinutes: 60,
  notes: null, imageUrl: null, googlePlaceId: null, googleFtid: null, osmId: null,
  routeGeometry: null, routeColor: null, website: null, phone: null, transportMode: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z', deletedAt: null,
}
const assignment: SyncedAssignment = {
  schemaVersion: 1, id: '44444444-4444-4444-8444-444444444444', tripId: trip.id,
  dayId: day.id, placeId: place.id, orderIndex: 0, notes: 'Morning', assignmentTime: '09:00',
  assignmentEndTime: null, legTransportMode: 'walking', incomingLegTransportMode: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-04T00:00:00.000Z', deletedAt: null,
}
const accommodation: SyncedAccommodation = {
  schemaVersion: 1, id: '55555555-5555-4555-8555-555555555555', tripId: trip.id, placeId: place.id,
  startDayId: day.id, endDayId: day.id, checkIn: '15:00', checkInEnd: null, checkOut: '11:00',
  confirmation: 'ABC', notes: null, createdAt: day.createdAt, updatedAt: '2026-01-05T00:00:00.000Z', deletedAt: null,
}
const reservation: SyncedReservation = {
  schemaVersion: 1, id: '66666666-6666-4666-8666-666666666666', tripId: trip.id, dayId: day.id,
  endDayId: day.id, placeId: place.id, assignmentId: assignment.id, accommodationId: accommodation.id,
  title: 'Hotel booking', reservationTime: null, reservationEndTime: null, location: null,
  confirmationNumber: 'ABC', notes: null, url: null, status: 'confirmed', type: 'hotel', metadata: null,
  needsReview: 0, ingestState: 'live', dayPlanPosition: null, dayPositions: null, endpoints: [],
  createdAt: day.createdAt, updatedAt: '2026-01-06T00:00:00.000Z', deletedAt: null,
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

  it('pulls all Trip child files in dependency order', async () => {
    const placesPath = `trips/${trip.id}/places.json`
    const assignmentsPath = `trips/${trip.id}/assignments.json`
    const manifest: GitHubManifest = {
      schemaVersion: 1, updatedAt: assignment.updatedAt,
      trips: { [trip.id]: { path: `trips/${trip.id}/trip.json`, updatedAt: trip.updatedAt, deletedAt: null, contentHash: 'trip-v1' } },
      days: { [day.id]: { path: `trips/${trip.id}/days.json`, tripId: trip.id, updatedAt: day.updatedAt, deletedAt: null, contentHash: 'day-v1' } },
      places: { [place.id]: { path: placesPath, tripId: trip.id, updatedAt: place.updatedAt, deletedAt: null, contentHash: 'place-v1' } },
      assignments: { [assignment.id]: { path: assignmentsPath, tripId: trip.id, dayId: day.id, placeId: place.id, updatedAt: assignment.updatedAt, deletedAt: null, contentHash: 'assignment-v1' } },
      accommodations: { [accommodation.id]: { path: `trips/${trip.id}/accommodations.json`, tripId: trip.id, placeId: place.id, startDayId: day.id, endDayId: day.id, updatedAt: accommodation.updatedAt, deletedAt: null, contentHash: 'accommodation-v1' } },
      reservations: { [reservation.id]: { path: `trips/${trip.id}/reservations.json`, tripId: trip.id, dayId: day.id, accommodationId: accommodation.id, updatedAt: reservation.updatedAt, deletedAt: null, contentHash: 'reservation-v1' } },
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/repos/me/travel-data')) return response({ permissions: { push: true } })
      if (url.includes('/git/ref/heads/main')) return response({ object: { sha: 'head-all' } })
      if (url.includes('/contents/manifest.json')) return response(file(manifest))
      if (url.includes(`/contents/trips/${trip.id}/trip.json`)) return response(file(trip))
      if (url.includes(`/contents/trips/${trip.id}/days.json`)) return response(file({ schemaVersion: 1, tripId: trip.id, updatedAt: day.updatedAt, days: [day] }))
      if (url.includes(`/contents/${placesPath}`)) return response(file({ schemaVersion: 1, tripId: trip.id, updatedAt: place.updatedAt, places: [place] }))
      if (url.includes(`/contents/${assignmentsPath}`)) return response(file({ schemaVersion: 1, tripId: trip.id, updatedAt: assignment.updatedAt, assignments: [assignment] }))
      if (url.includes(`/contents/trips/${trip.id}/accommodations.json`)) return response(file({ schemaVersion: 1, tripId: trip.id, updatedAt: accommodation.updatedAt, accommodations: [accommodation] }))
      if (url.includes(`/contents/trips/${trip.id}/reservations.json`)) return response(file({ schemaVersion: 1, tripId: trip.id, updatedAt: reservation.updatedAt, reservations: [reservation] }))
      throw new Error(`Unexpected request: ${url}`)
    })
    const provider = new GitHubSyncProvider(config, 'secret')
    await provider.connect()
    const result = await provider.pull()
    expect(result.changes.map(change => change.entityType)).toEqual(['trip', 'day', 'place', 'assignment', 'accommodation', 'reservation'])
    expect(result.changes[3]).toMatchObject({ entityId: assignment.id, payload: assignment })
  })

  it('patches Trip-scoped Place and Assignment files in one commit', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    let blob = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith('/repos/me/travel-data')) return response({ permissions: { push: true } })
      if (url.includes('/git/ref/heads/main')) return response({ object: { sha: 'head-1' } })
      if (url.includes('/git/commits/head-1')) return response({ tree: { sha: 'tree-1' } })
      if (url.includes('/contents/manifest.json')) return response(file({ ...EMPTY_MANIFEST }))
      if (url.includes(`/contents/trips/${trip.id}/places.json`) || url.includes(`/contents/trips/${trip.id}/assignments.json`)) return response({ message: 'Not Found' }, 404)
      if (url.endsWith('/git/blobs')) return response({ sha: `blob-${++blob}` })
      if (url.endsWith('/git/trees')) return response({ sha: 'tree-2' })
      if (url.endsWith('/git/commits')) return response({ sha: 'commit-2' })
      if (url.includes('/git/refs/heads/main')) return response({})
      throw new Error(`Unexpected request: ${url}`)
    })
    const provider = new GitHubSyncProvider(config, 'secret')
    await provider.connect()
    const result = await provider.push([
      { entityType: 'place', entityId: place.id, operation: 'upsert', payload: place },
      { entityType: 'assignment', entityId: assignment.id, operation: 'upsert', payload: assignment },
    ], 'head-1')
    expect(result.versions).toMatchObject({ [place.id]: `${place.updatedAt}:active`, [assignment.id]: `${assignment.updatedAt}:active` })
    const treeRequest = requests.find(request => request.url.endsWith('/git/trees'))!
    expect(JSON.parse(String(treeRequest.init.body)).tree.map((entry: { path: string }) => entry.path)).toEqual([
      `trips/${trip.id}/places.json`, `trips/${trip.id}/assignments.json`, 'manifest.json',
    ])
  })

  it('patches Trip-scoped Accommodation and Reservation files', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []; let blob = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
      const url = String(input); requests.push({ url, init })
      if (url.endsWith('/repos/me/travel-data')) return response({ permissions: { push: true } })
      if (url.includes('/git/ref/heads/main')) return response({ object: { sha: 'head-1' } })
      if (url.includes('/git/commits/head-1')) return response({ tree: { sha: 'tree-1' } })
      if (url.includes('/contents/manifest.json')) return response(file({ ...EMPTY_MANIFEST }))
      if (url.includes('/accommodations.json') || url.includes('/reservations.json')) return response({ message: 'Not Found' }, 404)
      if (url.endsWith('/git/blobs')) return response({ sha: `blob-${++blob}` })
      if (url.endsWith('/git/trees')) return response({ sha: 'tree-2' })
      if (url.endsWith('/git/commits')) return response({ sha: 'commit-2' })
      if (url.includes('/git/refs/heads/main')) return response({})
      throw new Error(`Unexpected request: ${url}`)
    })
    const provider = new GitHubSyncProvider(config, 'secret'); await provider.connect()
    const result = await provider.push([
      { entityType: 'accommodation', entityId: accommodation.id, operation: 'upsert', payload: accommodation },
      { entityType: 'reservation', entityId: reservation.id, operation: 'upsert', payload: reservation },
    ], 'head-1')
    expect(result.versions).toMatchObject({ [accommodation.id]: `${accommodation.updatedAt}:active`, [reservation.id]: `${reservation.updatedAt}:active` })
    const tree = JSON.parse(String(requests.find(item => item.url.endsWith('/git/trees'))!.init.body)).tree
    expect(tree.map((entry: { path: string }) => entry.path)).toEqual([`trips/${trip.id}/accommodations.json`, `trips/${trip.id}/reservations.json`, 'manifest.json'])
  })
})
