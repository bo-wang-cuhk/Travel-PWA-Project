import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearAll, offlineDb } from '../db/offlineDb'
import { tripRepo } from '../repo/tripRepo'
import type { LocalChange, ProviderStatus, PushResult, RemoteChanges, SyncProvider } from './types'
import { SyncManager } from './SyncManager'

class MemoryProvider implements SyncProvider {
  readonly id = 'memory'
  connected = false
  fail = false
  cursor = 0
  remote = new Map<string, { version: string; deleted: boolean; payload?: unknown }>()

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
        entityType: 'trip',
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
      this.remote.set(change.entityId, { version, deleted: change.operation === 'delete', payload: change.payload })
    }
    return { cursor: `c${this.cursor}`, versions }
  }
  editRemote(entityId: string, payload: unknown): void {
    const version = `v${++this.cursor}`
    this.remote.set(entityId, { version, deleted: false, payload })
  }
  deleteRemote(entityId: string): void {
    const version = `v${++this.cursor}`
    this.remote.set(entityId, { version, deleted: true })
  }
}

beforeEach(async () => { await clearAll() })

describe('local-first SyncManager', () => {
  it('Scenario A: local Trip is pushed after IndexedDB has already accepted it', async () => {
    const provider = new MemoryProvider()
    const created = await tripRepo.create({ title: 'Tokyo' })
    expect((await tripRepo.list()).trips[0].title).toBe('Tokyo')

    const result = await new SyncManager(provider).sync()
    expect(result.pushed).toBe(1)
    expect(provider.remote.get(created.trip.sync_id)?.payload).toMatchObject({ title: 'Tokyo' })
    expect(await offlineDb.syncOutbox.count()).toBe(0)
  })

  it('Scenario B: an empty device pulls a Trip and assigns only a local compatibility id', async () => {
    const provider = new MemoryProvider()
    const first = await tripRepo.create({ title: 'Lisbon' })
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
    const created = await tripRepo.create({ title: 'Before' })
    await new SyncManager(provider).sync()
    await tripRepo.update(created.trip.id, { title: 'Offline edit' })
    expect((await tripRepo.get(created.trip.id)).trip.title).toBe('Offline edit')

    await new SyncManager(provider).sync()
    expect(provider.remote.get(created.trip.sync_id)?.payload).toMatchObject({ title: 'Offline edit' })
  })

  it('Scenario D: provider failure cannot roll back a local create', async () => {
    const provider = new MemoryProvider()
    provider.fail = true
    const created = await tripRepo.create({ title: 'Safe locally' })

    await expect(new SyncManager(provider).sync()).rejects.toThrow('provider unavailable')
    expect((await tripRepo.get(created.trip.id)).trip.title).toBe('Safe locally')
    expect(await offlineDb.syncOutbox.count()).toBe(1)
    expect((await offlineDb.syncState.get('memory'))?.status).toBe('error')
  })

  it('Scenario E: concurrent local and remote edits are retained as a conflict', async () => {
    const provider = new MemoryProvider()
    const created = await tripRepo.create({ title: 'Base' })
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
    const created = await tripRepo.create({ title: 'Temporary' })
    await new SyncManager(provider).sync()
    provider.deleteRemote(created.trip.sync_id)

    await new SyncManager(provider).sync()

    expect((await tripRepo.list()).trips).toEqual([])
    expect((await offlineDb.trips.get(created.trip.id))?.deleted_at).toBeTruthy()
  })
})
