import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearAll, offlineDb } from '../db/offlineDb'
import { tripRepo } from '../repo/tripRepo'
import { dayRepo } from '../repo/dayRepo'
import type { LocalChange, ProviderStatus, PushResult, RemoteChanges, SyncProvider } from './types'
import { SyncManager } from './SyncManager'

class MemoryProvider implements SyncProvider {
  readonly id = 'memory'
  connected = false
  fail = false
  cursor = 0
  remote = new Map<string, { entityType: 'trip' | 'day'; version: string; deleted: boolean; payload?: unknown }>()

  async connect(): Promise<ProviderStatus> {
    if (this.fail) throw new Error('provider unavailable')
    this.connected = true
    return { connected: true }
  }
  async disconnect(): Promise<void> { this.connected = false }
  async getStatus(): Promise<ProviderStatus> { return { connected: this.connected } }
  async pull(cursor?: string | null): Promise<RemoteChanges> {
    if (this.fail) throw new Error('provider unavailable')
    const current = `c${this.cursor}`
    if (cursor === current) return { cursor: current, changes: [] }
    return {
      cursor: current,
      changes: [...this.remote.entries()].map(([entityId, row]) => ({
        entityType: row.entityType,
        entityId,
        operation: row.deleted ? 'delete' : 'upsert',
        remoteVersion: row.version,
        payload: row.payload,
      })),
    }
  }
  async push(changes: LocalChange[]): Promise<PushResult> {
    if (this.fail) throw new Error('provider unavailable')
    const versions: Record<string, string> = {}
    for (const change of changes) {
      const version = `v${++this.cursor}`
      versions[change.entityId] = version
      this.remote.set(change.entityId, { entityType: change.entityType, version, deleted: change.operation === 'delete', payload: change.payload })
    }
    return { cursor: `c${this.cursor}`, versions }
  }
  editRemote(entityId: string, payload: unknown, entityType: 'trip' | 'day' = 'trip'): void {
    const version = `v${++this.cursor}`
    this.remote.set(entityId, { entityType, version, deleted: false, payload })
  }
  deleteRemote(entityId: string): void {
    const version = `v${++this.cursor}`
    const current = this.remote.get(entityId)
    this.remote.set(entityId, { entityType: current?.entityType ?? 'trip', version, deleted: true, payload: current?.payload })
  }
}

beforeEach(async () => { await clearAll() })

describe('local-first SyncManager', () => {
  it('Scenario A: local Trip is pushed after IndexedDB has already accepted it', async () => {
    const provider = new MemoryProvider()
    const created = await tripRepo.create({ title: 'Tokyo', day_count: 0 })
    expect((await tripRepo.list()).trips[0].title).toBe('Tokyo')

    const result = await new SyncManager(provider).sync()
    expect(result.pushed).toBe(1)
    expect(provider.remote.get(created.trip.sync_id)?.payload).toMatchObject({ title: 'Tokyo' })
    expect(await offlineDb.syncOutbox.count()).toBe(0)
  })

  it('Scenario B: an empty device pulls a Trip and assigns only a local compatibility id', async () => {
    const provider = new MemoryProvider()
    const first = await tripRepo.create({ title: 'Lisbon', day_count: 0 })
    await new SyncManager(provider).sync()
    const syncId = first.trip.sync_id

    await clearAll()
    const result = await new SyncManager(provider).sync()
    const rows = (await tripRepo.list()).trips
    expect(result.pulled).toBe(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Lisbon', sync_id: syncId })
    expect(rows[0].id).toBeLessThan(0)
  })

  it('Scenario C: an offline edit remains local and is pushed by a later sync', async () => {
    const provider = new MemoryProvider()
    const created = await tripRepo.create({ title: 'Before', day_count: 0 })
    await new SyncManager(provider).sync()
    await tripRepo.update(created.trip.id, { title: 'Offline edit' })
    expect((await tripRepo.get(created.trip.id)).trip.title).toBe('Offline edit')

    await new SyncManager(provider).sync()
    expect(provider.remote.get(created.trip.sync_id)?.payload).toMatchObject({ title: 'Offline edit' })
  })

  it('Scenario D: provider failure cannot roll back a local create', async () => {
    const provider = new MemoryProvider()
    provider.fail = true
    const created = await tripRepo.create({ title: 'Safe locally', day_count: 0 })

    await expect(new SyncManager(provider).sync()).rejects.toThrow('provider unavailable')
    expect((await tripRepo.get(created.trip.id)).trip.title).toBe('Safe locally')
    expect(await offlineDb.syncOutbox.count()).toBe(1)
    expect((await offlineDb.syncState.get('memory'))?.status).toBe('error')
  })

  it('Scenario E: concurrent local and remote edits are retained as a conflict', async () => {
    const provider = new MemoryProvider()
    const created = await tripRepo.create({ title: 'Base', day_count: 0 })
    await new SyncManager(provider).sync()
    await tripRepo.update(created.trip.id, { title: 'Local' })
    const remote = provider.remote.get(created.trip.sync_id)!.payload as Record<string, unknown>
    provider.editRemote(created.trip.sync_id, { ...remote, title: 'Remote', updatedAt: new Date().toISOString() })

    const result = await new SyncManager(provider).sync()
    const conflict = await offlineDb.syncConflicts.get(`trip:${created.trip.sync_id}`)
    expect(result.conflicts).toBe(1)
    expect(conflict?.localSnapshot).toMatchObject({ title: 'Local' })
    expect(conflict?.remoteSnapshot).toMatchObject({ title: 'Remote' })
    expect((await tripRepo.get(created.trip.id)).trip.title).toBe('Local')
    expect(provider.remote.get(created.trip.sync_id)?.payload).toMatchObject({ title: 'Remote' })
  })

  it('propagates a remote tombstone without physically deleting the local row', async () => {
    const provider = new MemoryProvider()
    const created = await tripRepo.create({ title: 'Temporary', day_count: 0 })
    await new SyncManager(provider).sync()
    provider.deleteRemote(created.trip.sync_id)

    await new SyncManager(provider).sync()

    expect((await tripRepo.list()).trips).toEqual([])
    expect((await offlineDb.trips.get(created.trip.id))?.deleted_at).toBeTruthy()
  })

  it('pushes and pulls a Day after its parent Trip using stable UUID references', async () => {
    const provider = new MemoryProvider()
    const trip = await tripRepo.create({ title: 'Osaka', day_count: 0 })
    const day = await dayRepo.create(trip.trip.id, { notes: 'Food tour' })

    await new SyncManager(provider).sync()
    expect(provider.remote.get(day.day.sync_id)?.payload).toMatchObject({
      id: day.day.sync_id,
      tripId: trip.trip.sync_id,
      notes: 'Food tour',
    })

    await clearAll()
    await new SyncManager(provider).sync()
    const pulledTrip = (await tripRepo.list()).trips[0]
    const pulledDays = (await dayRepo.list(pulledTrip.id)).days
    expect(pulledDays).toHaveLength(1)
    expect(pulledDays[0]).toMatchObject({ sync_id: day.day.sync_id, trip_sync_id: trip.trip.sync_id, notes: 'Food tour' })
    expect(pulledDays[0].id).toBeLessThan(0)
  })

  it('retains both versions when the same Day changes locally and remotely', async () => {
    const provider = new MemoryProvider()
    const trip = await tripRepo.create({ title: 'Seoul', day_count: 0 })
    const day = await dayRepo.create(trip.trip.id)
    await new SyncManager(provider).sync()
    await dayRepo.update(trip.trip.id, day.day.id, { title: 'Local day' })
    const remote = provider.remote.get(day.day.sync_id)!.payload as Record<string, unknown>
    provider.editRemote(day.day.sync_id, { ...remote, title: 'Remote day', updatedAt: new Date().toISOString() }, 'day')

    const result = await new SyncManager(provider).sync()
    expect(result.conflicts).toBe(1)
    expect(await offlineDb.syncConflicts.get(`day:${day.day.sync_id}`)).toMatchObject({
      localSnapshot: { title: 'Local day' },
      remoteSnapshot: { title: 'Remote day' },
    })
    expect((await dayRepo.get(day.day.id)).day.title).toBe('Local day')
  })
})
